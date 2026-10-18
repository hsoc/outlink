import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { PrivateMailbox, type InternetPayload } from '@/services/bitchat/compatibility/private-mailbox';
import { MessageOutbox, type OutboxStorage } from '@/services/bitchat/compatibility/outbox';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { GeoSocket } from './geohash-session';
import type { ProtocolStorage } from '@/services/bitchat/compatibility/prekey-runtime';
import { bytes } from '@/services/bitchat/bitchat-wire';
type Ack = { peer: string; id: string; status: 'delivered' | 'read'; expires: number };
export type PrivateDependencies = {
  records: ProtocolStorage; outbox: OutboxStorage;
  get(id: string): Promise<BitchatMessage | null>;
  save(message: BitchatMessage): Promise<void>;
  changed(message: BitchatMessage): void; connection(count: number): void; error(): void;
};
/** Channel-scoped private messaging. Full authenticated Nostr keys own threads and receipts. */
export class GeoPrivateSession {
  readonly pubkey: string;
  private readonly mailbox: PrivateMailbox;
  private readonly outbox: MessageOutbox;
  private connected = 0;
  private stopped = true;
  private timer?: ReturnType<typeof setInterval>;
  private pending = Promise.resolve();
  private flushing?: Promise<void>;
  private readonly operations = new Set<Promise<unknown>>();
  constructor(key: Uint8Array, relays: string[], private readonly deps: PrivateDependencies, socket?: (url: string) => GeoSocket) {
    this.pubkey = getPublicKey(key);
    this.outbox = new MessageOutbox(deps.outbox, message => {
      // Persist every transition before publishing it to the UI.
      void this.serial(async () => {
        const previous = await deps.get(message.id + message.peer);
        if (previous?.delivery === 'read' || previous?.delivery === 'delivered' && !['read', 'delivered'].includes(message.delivery)) return;
        await deps.save(message); deps.changed(message);
      }).catch(deps.error);
    });
    this.mailbox = new PrivateMailbox(key, relays, {
      message: (sender, payload) => this.serial(() => this.receive(sender, payload)),
      connection: count => { this.connected = count; deps.connection(count); if (count) void this.flush().catch(deps.error); }, error: deps.error,
    }, socket);
  }
  private serial<T>(task: () => Promise<T>): Promise<T> { const work = this.pending.then(task); this.pending = work.then(() => {}, () => {}); return work; }
  start() { this.stopped = false; this.mailbox.start(); this.timer = setInterval(() => { void this.flush().catch(this.deps.error); }, 30000); }
  updateRelays(relays: string[]) { this.mailbox.updateRelays(relays); }
  private async remember(peer: string) {
    if (await this.deps.records.get('geo-peers', peer)) return;
    if ((await this.deps.records.list('geo-peers', 100)).length >= 100) throw new Error('Private conversation quota exceeded');
    await this.deps.records.put('geo-peers', peer, { peer });
  }
  send(peer: string, content: string) {
    const work = this.sendInternal(peer, content); this.operations.add(work);
    void work.finally(() => this.operations.delete(work)).catch(() => {}); return work;
  }
  private async sendInternal(peer: string, content: string) {
    if (this.stopped || !/^[0-9a-f]{64}$/.test(peer) || peer === this.pubkey || !content.trim() || bytes(content).length > 4096) throw new Error('Invalid private message');
    const message: BitchatMessage = { id: bytesToHex(randomBytes(16)), peer: this.pubkey, recipient: peer, name: this.pubkey.slice(0, 8), content,
      timestamp: Date.now(), outgoing: true, delivery: 'queued' };
    await this.serial(() => this.remember(peer));
    if (this.stopped) throw new Error('Private channel stopped');
    await this.outbox.enqueue(peer, message); await this.pending;
    if (!this.stopped) void this.flush().catch(this.deps.error);
  }
  private async ack(peer: string, id: string, status: 'delivered' | 'read') {
    const key = `${peer}:${id}`, previous = await this.deps.records.get<Ack>('geo-acks', key);
    const all = await this.deps.records.list<Ack>('geo-acks', 201);
    for (const entry of all) if (entry.expires <= Date.now()) await this.deps.records.remove('geo-acks', `${entry.peer}:${entry.id}`);
    if (!previous && all.filter(entry => entry.expires > Date.now()).length >= 200) throw new Error('Private receipt quota exceeded');
    await this.deps.records.put('geo-acks', key, { peer, id, status: previous?.status === 'read' ? 'read' : status, expires: Date.now() + 86400000 });
  }
  private async receive(sender: string, payload: InternetPayload) {
    if (this.stopped || !/^[0-9a-f]{64}$/.test(sender) || !payload.id || bytes(payload.id).length > 255 ||
        !!payload.recipientId || payload.timestamp < Date.now() - 86400000 || payload.timestamp > Date.now() + 300000) return;
    if (payload.kind === 'receipt') {
      const previous = await this.deps.get(payload.id + this.pubkey);
      if (!previous?.outgoing || previous.recipient !== sender) return;
      await this.outbox.acknowledge(sender, payload.id, payload.delivery);
      if (previous.delivery !== 'read') { const next = { ...previous, delivery: payload.delivery }; await this.deps.save(next); this.deps.changed(next); }
      return;
    }
    await this.remember(sender);
    if (bytes(payload.content).length > 4096 || !payload.content.trim()) return;
    const previous = await this.deps.get(payload.id + sender);
    if (!previous) {
      const message: BitchatMessage = { id: payload.id, peer: sender, recipient: this.pubkey, name: sender.slice(0, 8), content: payload.content,
        timestamp: payload.timestamp, outgoing: false, delivery: 'delivered' };
      await this.deps.save(message); this.deps.changed(message);
    }
    await this.ack(sender, payload.id, previous?.delivery === 'read' ? 'read' : 'delivered');
    // Do not wait for network work from inside the serialized storage queue.
    void this.flush().catch(this.deps.error);
  }
  async read(peer: string, id: string) {
    await this.serial(async () => {
      const previous = await this.deps.get(id + peer);
      if (!previous || previous.outgoing || previous.peer !== peer || previous.delivery === 'read') return;
      await this.ack(peer, id, 'read');
      const message = { ...previous, delivery: 'read' as const }; await this.deps.save(message); this.deps.changed(message);
    });
    if (!this.stopped) void this.flush().catch(this.deps.error);
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const work = this.drain().finally(() => { if (this.flushing === work) this.flushing = undefined; }); this.flushing = work; return work;
  }
  private async drain() {
    if (this.stopped || !this.connected) return;
    const peers = await this.deps.records.list<{ peer: string }>('geo-peers', 100);
    for (const { peer } of peers) {
      if (this.stopped) return;
      await this.outbox.flush(peer, async entry => {
        if (this.stopped) throw new Error('Private channel stopped');
        await this.mailbox.send(peer, { kind: 'message', id: entry.message.id, content: entry.message.content, senderId: '', timestamp: entry.message.timestamp });
      }, () => !this.stopped && this.connected > 0);
    }
    for (const ack of await this.deps.records.list<Ack>('geo-acks', 200)) {
      if (this.stopped) return;
      if (ack.expires <= Date.now()) { await this.deps.records.remove('geo-acks', `${ack.peer}:${ack.id}`); continue; }
      await this.mailbox.send(ack.peer, { kind: 'receipt', id: ack.id, delivery: ack.status, senderId: '', timestamp: Date.now() });
      await this.serial(async () => {
        const key = `${ack.peer}:${ack.id}`, current = await this.deps.records.get<Ack>('geo-acks', key);
        if (current?.status === ack.status) await this.deps.records.remove('geo-acks', key);
      });
    }
  }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.outbox.cancelFlushes(); this.mailbox.stop(); }
  async idle() { await Promise.allSettled([...this.operations, this.mailbox.settled(), this.flushing]); await this.outbox.idle(); await this.pending; }
}
