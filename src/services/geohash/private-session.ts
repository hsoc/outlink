import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { PrivateMailbox, type InternetPayload, type RotationPayload } from '@/services/bitchat/compatibility/private-mailbox';
import { MessageOutbox, type OutboxStorage } from '@/services/bitchat/compatibility/outbox';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { GeoSocket } from './geohash-session';
import type { ProtocolStorage } from '@/services/bitchat/compatibility/prekey-runtime';
import { bytes } from '@/services/bitchat/bitchat-wire';
import { migrationProof, validMigration } from './identity-migration';
import type { ChannelIdentitySet } from './channel-identities';
type Ack = { peer: string; own?: string; id: string; status: 'delivered' | 'read'; expires: number };
export type GeoThread = { peer: string; head: string; keys: string[]; local: string; migrationAt?: number; retired?: { key: string; expires: number }[] };
type Notice = { root: string; own: string; target: string; payload: RotationPayload; expires: number; lastAttempt: number; attempts: number };
export type PrivateDependencies = {
  records: ProtocolStorage; outbox: OutboxStorage; hash?: string; legacyPubkey?: string;
  get(id: string): Promise<BitchatMessage | null>;
  save(message: BitchatMessage): Promise<void>;
  changed(message: BitchatMessage): void; connection(count: number): void; error(): void;
  threads?(threads: (GeoThread & { blocked: boolean; migrating: boolean })[]): void;
};
const publicKey = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
/** Full authenticated keys own receipts; conversation roots remain stable across proven migration. */
export class GeoPrivateSession {
  pubkey: string;
  private readonly mailbox: PrivateMailbox;
  private readonly outbox: MessageOutbox;
  private connected = 0;
  private stopped = true;
  private timer?: ReturnType<typeof setInterval>;
  private pending = Promise.resolve();
  private flushing?: Promise<void>;
  private drainAgain = false;
  private readonly operations = new Set<Promise<unknown>>();
  private readonly own = new Map<string, { expires?: number; key: Uint8Array }>();
  private threads?: GeoThread[];
  private loadingThreads?: Promise<GeoThread[]>;
  constructor(key: Uint8Array, relays: string[], private readonly deps: PrivateDependencies, socket?: (url: string) => GeoSocket, identities?: ChannelIdentitySet) {
    this.pubkey = getPublicKey(key); this.own.set(this.pubkey, { key });
    const retired = (identities?.retired ?? []).map(entry => { const key = entry.key.slice(); this.own.set(entry.pubkey, { key, expires: entry.expires }); return key; });
    this.outbox = new MessageOutbox(deps.outbox, message => {
      void this.serial(async () => {
        const previous = await deps.get(message.id + message.peer);
        if (previous?.delivery === 'read' || previous?.delivery === 'delivered' && !['read', 'delivered'].includes(message.delivery)) return;
        await deps.save(message); deps.changed(message);
      }).catch(deps.error);
    });
    this.mailbox = new PrivateMailbox(key, relays, {
      message: (sender, payload, recipient) => this.serial(() => this.receive(sender, payload, recipient ?? this.pubkey)),
      connection: count => { this.connected = count; deps.connection(count); if (count) void this.flush().catch(deps.error); }, error: deps.error,
    }, socket, true, retired);
  }
  private serial<T>(task: () => Promise<T>): Promise<T> { const work = this.pending.then(task); this.pending = work.then(() => {}, () => {}); return work; }
  private hasOwn(key: string) { const entry = this.own.get(key); return !!entry && (entry.expires === undefined || entry.expires > Date.now()); }
  private publishThreads() { this.deps.threads?.((this.threads ?? []).map(thread => ({ ...thread, keys: [...thread.keys], blocked: !this.hasOwn(thread.local), migrating: thread.local !== this.pubkey }))); }
  private async roster(): Promise<GeoThread[]> {
    if (this.threads) return this.threads;
    if (this.loadingThreads) return this.loadingThreads;
    const operation = this.loadRoster().finally(() => { if (this.loadingThreads === operation) this.loadingThreads = undefined; });
    this.loadingThreads = operation; return operation;
  }
  private async loadRoster(): Promise<GeoThread[]> {
    const records = await this.deps.records.list<Partial<GeoThread> & { peer: string }>('geo-peers', 100);
    const result: GeoThread[] = records.map(entry => {
      const thread: GeoThread = { peer: entry.peer, head: entry.head ?? entry.peer, keys: entry.keys ?? [entry.peer], local: entry.local ?? this.deps.legacyPubkey ?? this.pubkey, migrationAt: entry.migrationAt, retired: entry.retired ?? [] };
      if (!publicKey(thread.peer) || !publicKey(thread.head) || !publicKey(thread.local) || !Array.isArray(thread.keys) || thread.keys.length > 4 || !thread.keys.every(publicKey) || !thread.keys.includes(thread.head)) throw new Error('Invalid private conversation');
      if (!Array.isArray(thread.retired) || thread.retired.length > 3 || thread.retired.some(e => !publicKey(e.key) || !Number.isSafeInteger(e.expires))) throw new Error('Invalid remote grace identities');
      return thread;
    });
    this.threads = result; this.publishThreads(); return result;
  }
  private async thread(key: string, own?: string): Promise<GeoThread | undefined> {
    const threads = await this.roster(), existing = threads.find(t => t.peer === key || t.head === key || t.keys.includes(key));
    if (existing || !own) return existing;
    if (threads.length >= 100) throw new Error('Private conversation quota exceeded');
    const created = { peer: key, head: key, keys: [key], local: own };
    await this.deps.records.put('geo-peers', key, created); threads.push(created); this.publishThreads(); return created;
  }
  private acceptsSender(thread: GeoThread, sender: string) { return thread.head === sender || !!thread.retired?.some(entry => entry.key === sender && entry.expires > Date.now()); }
  private async saveThread(thread: GeoThread, next: GeoThread) {
    await this.deps.records.put('geo-peers', thread.peer, next); Object.assign(thread, next); this.publishThreads();
  }
  async refreshThreads() { await this.serial(async () => { await this.roster(); this.publishThreads(); }); }
  start() { this.stopped = false; this.mailbox.start(); this.timer = setInterval(() => { void this.flush().catch(this.deps.error); }, 30000); }
  updateRelays(relays: string[]) { this.mailbox.updateRelays(relays); }
  async replaceIdentities(identities: ChannelIdentitySet) {
    await this.serial(async () => {
      if (this.stopped) return;
      const primary = identities.current.key.slice(), retired = identities.retired.map(e => e.key.slice());
      this.mailbox.replaceIdentities(primary, retired); this.own.clear();
      this.pubkey = identities.current.pubkey; this.own.set(this.pubkey, { key: primary });
      identities.retired.forEach((entry, i) => this.own.set(entry.pubkey, { key: retired[i], expires: entry.expires }));
      await this.prepareMigrations(); this.publishThreads();
    });
    if (!this.stopped) void this.flush().catch(this.deps.error);
  }
  async useCurrentIdentity(peer: string) {
    await this.serial(async () => {
      const thread = await this.thread(peer); if (this.stopped || !thread || this.hasOwn(thread.local)) throw new Error('Conversation recovery unavailable');
      await this.saveThread(thread, { ...thread, local: this.pubkey });
    });
  }
  send(peer: string, content: string) {
    const work = this.sendInternal(peer, content); this.operations.add(work);
    void work.finally(() => this.operations.delete(work)).catch(() => {}); return work;
  }
  private async sendInternal(peer: string, content: string) {
    if (this.stopped || !publicKey(peer) || this.own.has(peer) || !content.trim() || bytes(content).length > 4096) throw new Error('Invalid private message');
    const thread = await this.serial(() => this.thread(peer, this.pubkey));
    if (this.stopped) throw new Error('Private channel stopped');
    if (!thread || !this.hasOwn(thread.local)) throw new Error('Private identity expired; recover the conversation explicitly');
    const message: BitchatMessage = { id: bytesToHex(randomBytes(16)), peer: thread.local, recipient: thread.head, channelThread: thread.peer,
      name: thread.local.slice(0, 8), content, timestamp: Date.now(), outgoing: true, delivery: 'queued' };
    await this.outbox.enqueue(thread.peer, message); await this.pending;
    if (!this.stopped) void this.flush().catch(this.deps.error);
  }
  private async ack(peer: string, own: string, id: string, status: 'delivered' | 'read') {
    const key = `${peer}:${id}`, previous = await this.deps.records.get<Ack>('geo-acks', key);
    const all = await this.deps.records.list<Ack>('geo-acks', 201);
    for (const entry of all) if (entry.expires <= Date.now()) await this.deps.records.remove('geo-acks', `${entry.peer}:${entry.id}`);
    if (!previous && all.filter(entry => entry.expires > Date.now()).length >= 200) throw new Error('Private receipt quota exceeded');
    await this.deps.records.put('geo-acks', key, { peer, own, id, status: previous?.status === 'read' ? 'read' : status, expires: Date.now() + 86400000 });
  }
  private async receive(sender: string, payload: InternetPayload, own: string) {
    if (this.stopped || !this.hasOwn(own) || !publicKey(sender) || !payload.id || bytes(payload.id).length > 255 ||
        !!payload.recipientId || payload.timestamp < Date.now() - 86400000 || payload.timestamp > Date.now() + 300000) return;
    if (payload.kind === 'rotation' || payload.kind === 'rotation-ack') { await this.migrate(sender, own, payload); return; }
    if (payload.kind === 'receipt') {
      const related = await this.thread(sender); if (related && !this.acceptsSender(related, sender)) return;
      const queued = related ? await this.deps.outbox.get(related.peer, payload.id) : null;
      const previous = await this.deps.get(payload.id + own) ?? queued?.message;
      if (previous?.peer !== own) return;
      // A migration does not authorize a new key to acknowledge old-key-addressed mail.
      if (!previous?.outgoing || previous.recipient !== sender) return;
      const thread = await this.thread(previous.channelThread ?? sender); if (!thread) return;
      await this.outbox.acknowledge(thread.peer, payload.id, payload.delivery, sender);
      if (previous.delivery !== 'read') { const next = { ...previous, delivery: payload.delivery }; await this.deps.save(next); this.deps.changed(next); }
      return;
    }
    if (bytes(payload.content).length > 4096 || !payload.content.trim()) return;
    const thread = (await this.thread(sender, own))!;
    if (!this.acceptsSender(thread, sender)) return;
    // A known peer explicitly reaching the new inbox can renew an expired pair.
    if (!this.hasOwn(thread.local) && own === this.pubkey && sender === thread.head) await this.saveThread(thread, { ...thread, local: own });
    const previous = await this.deps.get(payload.id + sender);
    if (!previous) {
      const message: BitchatMessage = { id: payload.id, peer: sender, recipient: own, channelThread: thread.peer, name: sender.slice(0, 8), content: payload.content,
        timestamp: payload.timestamp, outgoing: false, delivery: 'delivered' };
      await this.deps.save(message); this.deps.changed(message);
    }
    await this.ack(sender, own, payload.id, previous?.delivery === 'read' ? 'read' : 'delivered');
    void this.flush().catch(this.deps.error);
  }
  async read(peer: string, id: string, sender?: string) {
    await this.serial(async () => {
      const thread = await this.thread(peer); if (!thread) return;
      let previous: BitchatMessage | null = null;
      for (const key of new Set(sender ? [sender] : [thread.peer, ...thread.keys])) { previous = await this.deps.get(id + key); if (previous) break; }
      if (!previous || previous.outgoing || previous.delivery === 'read' || !previous.recipient ||
          (previous.channelThread ?? previous.peer) !== thread.peer && !thread.keys.includes(previous.peer)) return;
      if (this.hasOwn(previous.recipient)) await this.ack(previous.peer, previous.recipient, id, 'read');
      const message = { ...previous, delivery: 'read' as const }; await this.deps.save(message); this.deps.changed(message);
    });
    if (!this.stopped) void this.flush().catch(this.deps.error);
  }
  private async prepareMigrations() {
    if (!this.deps.hash) return;
    for (const thread of await this.roster()) {
      if (thread.local === this.pubkey || !this.hasOwn(thread.local)) continue;
      const existing = await this.deps.records.get<Notice>('geo-migrations', `proof:${thread.peer}`);
      if (existing?.payload.kind === 'rotation' && existing.payload.proof.pubkey === this.pubkey && existing.own === thread.local && existing.expires > Date.now()) {
        if (existing.target !== thread.head) await this.deps.records.put('geo-migrations', `proof:${thread.peer}`, { ...existing, target: thread.head, lastAttempt: 0 });
        continue;
      }
      const expires = Math.min(this.own.get(thread.local)!.expires ?? Date.now() + 172800000, Date.now() + 172800000);
      const proof = migrationProof(this.deps.hash, thread.local, this.own.get(this.pubkey)!.key, Date.now(), expires);
      await this.deps.records.put('geo-migrations', `proof:${thread.peer}`, { root: thread.peer, own: thread.local, target: thread.head,
        payload: { kind: 'rotation', id: proof.id, proof, senderId: '', timestamp: Date.now() }, expires, attempts: 0, lastAttempt: 0 } satisfies Notice);
    }
  }
  private async migrate(sender: string, own: string, payload: RotationPayload) {
    if (!this.deps.hash) return;
    const thread = await this.thread(sender); if (!thread || !this.acceptsSender(thread, sender)) return;
    if (payload.kind === 'rotation') {
      const proof = validMigration(payload.proof, this.deps.hash, sender); if (!proof || payload.id !== proof.id || this.own.has(proof.pubkey)) return;
      // Only the current head may extend a chain; exact retries of its latest edge are idempotent.
      if (thread.head !== sender && thread.head !== proof.pubkey) return;
      const collision = await this.thread(proof.pubkey); if (collision && collision !== thread) return;
      if (thread.head === sender && thread.migrationAt && Date.now() - thread.migrationAt < 3600000) return;
      const keys = [...new Set([proof.pubkey, sender, ...thread.keys])].slice(0, 4);
      const retired = thread.head === sender ? [{ key: sender, expires: Math.min(JSON.parse(proof.content).expires, Date.now() + 172800000) }, ...(thread.retired ?? []).filter(e => e.key !== sender && e.expires > Date.now())].slice(0, 3) : thread.retired;
      await this.saveThread(thread, { ...thread, head: proof.pubkey, keys, retired, migrationAt: thread.head === sender ? Date.now() : thread.migrationAt });
      // Acknowledge from the identity the remote already knows, addressed to its proven new key.
      const payloadAck: RotationPayload = { kind: 'rotation-ack', id: proof.id, previous: sender, next: proof.pubkey, senderId: '', timestamp: Date.now() };
      await this.deps.records.put('geo-migrations', `ack:${thread.peer}`, { root: thread.peer, own, target: proof.pubkey, payload: payloadAck,
        expires: Math.min(JSON.parse(proof.content).expires, Date.now() + 86400000), attempts: 0, lastAttempt: 0 } satisfies Notice);
    } else {
      const pending = await this.deps.records.get<Notice>('geo-migrations', `proof:${thread.peer}`);
      if (!pending || pending.expires <= Date.now() || pending.payload.id !== payload.id || pending.payload.kind !== 'rotation' ||
          payload.previous !== pending.own || payload.next !== pending.payload.proof.pubkey || own !== payload.next ||
          !thread.keys.includes(sender) || !this.hasOwn(own)) return;
      await this.saveThread(thread, { ...thread, local: own });
      await this.deps.records.remove('geo-migrations', `proof:${thread.peer}`);
    }
    void this.flush().catch(this.deps.error);
  }
  flush(): Promise<void> {
    if (this.flushing) { this.drainAgain = true; return this.flushing; }
    const work = (async () => { do { this.drainAgain = false; await this.drain(); } while (this.drainAgain && !this.stopped); })().finally(() => { if (this.flushing === work) this.flushing = undefined; }); this.flushing = work; return work;
  }
  private async drain() {
    if (this.stopped || !this.connected) return;
    await this.serial(() => this.prepareMigrations());
    for (const thread of await this.roster()) {
      if (this.stopped) return;
      await this.outbox.flush(thread.peer, async entry => {
        if (this.stopped || !this.hasOwn(entry.message.peer)) throw new Error('Private identity unavailable');
        await this.mailbox.sendFrom(entry.message.peer, entry.message.recipient!, { kind: 'message', id: entry.message.id, content: entry.message.content, senderId: '', timestamp: entry.message.timestamp });
      }, entry => !this.stopped && this.connected > 0 && this.hasOwn(entry.message.peer));
    }
    for (const ack of await this.deps.records.list<Ack>('geo-acks', 200)) {
      if (this.stopped) return;
      const own = ack.own ?? this.deps.legacyPubkey ?? this.pubkey;
      if (ack.expires <= Date.now()) { await this.deps.records.remove('geo-acks', `${ack.peer}:${ack.id}`); continue; }
      if (!this.hasOwn(own)) continue;
      await this.mailbox.sendFrom(own, ack.peer, { kind: 'receipt', id: ack.id, delivery: ack.status, senderId: '', timestamp: Date.now() });
      await this.serial(async () => {
        const key = `${ack.peer}:${ack.id}`, current = await this.deps.records.get<Ack>('geo-acks', key);
        if (current?.status === ack.status && current.own === ack.own) await this.deps.records.remove('geo-acks', key);
      });
    }
    for (const notice of await this.deps.records.list<Notice>('geo-migrations', 200)) {
      if (this.stopped) return;
      const key = `${notice.payload.kind === 'rotation' ? 'proof' : 'ack'}:${notice.root}`;
      if (notice.expires <= Date.now()) {
        await this.serial(async () => { const current = await this.deps.records.get<Notice>('geo-migrations', key); if (current?.payload.id === notice.payload.id) await this.deps.records.remove('geo-migrations', key); });
        continue;
      }
      if (!this.hasOwn(notice.own) || notice.attempts >= 48 || notice.lastAttempt && Date.now() - notice.lastAttempt < 3600000) continue;
      // Reserve attempt before ambiguous publication; relay acceptance never confirms a migration.
      const reserved = await this.serial(async () => {
        const current = await this.deps.records.get<Notice>('geo-migrations', key);
        if (!current || current.payload.id !== notice.payload.id) return false;
        await this.deps.records.put('geo-migrations', key, { ...current, attempts: current.attempts + 1, lastAttempt: Date.now() }); return true;
      });
      if (!reserved || this.stopped) continue;
      await this.mailbox.sendFrom(notice.own, notice.target, { ...notice.payload, timestamp: Date.now() });
      if (notice.payload.kind === 'rotation-ack') await this.serial(async () => {
        const current = await this.deps.records.get<Notice>('geo-migrations', key);
        if (current?.payload.id === notice.payload.id) await this.deps.records.remove('geo-migrations', key);
      });
    }
    this.publishThreads();
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.outbox.cancelFlushes(); this.mailbox.stop(); this.own.clear(); }
  async idle() { await Promise.allSettled([...this.operations, this.mailbox.settled(), this.flushing]); await this.outbox.idle(); await this.pending; }
}
