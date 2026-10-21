import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import type { BitchatIdentity, BitchatPeer } from '../bitchat-session';
import type { ProtocolStorage } from './prekey-runtime';
import { decodeGroupState, encodeGroupState, groupEnvelope, openGroupMessage, sealGroupMessage, validateGroup, type GroupState, type GroupMember } from './group-protocol';
export type GroupInfo = Omit<GroupState, 'key'> & { status: 'joined' | 'invited' | 'left' };
type Entry = { state: GroupState; status: GroupInfo['status']; revoked?: string[] };
export type GroupMessage = { id: string; group: string; sender: string; name: string; content: string; timestamp: number; outgoing: boolean };
type IO = {
  state(peer: string, data: Uint8Array, invite: boolean): Promise<void>;
  broadcast(data: Uint8Array): Promise<void>;
  changed(groups: GroupInfo[]): void;
  message(message: GroupMessage): Promise<void>;
};
/** Group mutations persist atomically before publication; no network wait holds this queue. */
export class GroupRuntime {
  private entries = new Map<string, Entry>();
  private pending: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private invitationBytes = 0;
  private readonly sent = new Map<string, { token: string; at: number }>();
  private readonly syncing = new Map<string, Promise<void>>();
  readonly self: GroupMember;
  constructor(private readonly identity: BitchatIdentity, private readonly storage: ProtocolStorage, private readonly io: IO) {
    this.self = { fingerprint: bytesToHex(sha256(identity.noisePublicKey)), signingKey: bytesToHex(ed25519.getPublicKey(identity.signingSeed)), nickname: '' };
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const work = this.pending.catch(() => {}).then(() => { if (this.stopped) throw new Error('Groups stopped'); return task(); });
    this.pending = work; return work;
  }
  idle() { return this.pending.catch(() => {}); }
  stop() { this.stopped = true; this.entries.clear(); }
  private publish() {
    this.io.changed([...this.entries.values()].filter(e => e.status !== 'left').map(({ state: { key: _key, ...metadata }, status }) => ({ ...metadata, status })));
  }
  async restore() {
    return this.serial(async () => {
      for (const entry of await this.storage.list<Entry>('mesh-groups', Number.MAX_SAFE_INTEGER)) {
        validateGroup(entry.state);
        if (!['joined', 'invited', 'left'].includes(entry.status)) throw new Error('Invalid saved group');
        this.entries.set(entry.state.id, entry);
        if (entry.status === 'invited') this.invitationBytes += new TextEncoder().encode(JSON.stringify(entry.state)).length;
      }
      this.publish();
    });
  }
  private async put(entry: Entry) {
    const old = this.entries.get(entry.state.id);
    const size = (value?: Entry) => value?.status === 'invited' ? new TextEncoder().encode(JSON.stringify(value.state)).length : 0;
    const invitationBytes = this.invitationBytes - size(old) + size(entry);
    if (entry.status === 'invited' && invitationBytes > 2 * 1024 * 1024) throw new Error('Pending invitation storage budget reached');
    await this.storage.put('mesh-groups', entry.state.id, entry);
    this.invitationBytes = invitationBytes;
    this.entries.set(entry.state.id, entry); this.publish();
  }
  create(name: string, nickname: string) {
    return this.serial(async () => {
      const state: GroupState = { id: bytesToHex(randomBytes(16)), name: name.trim(), key: bytesToHex(randomBytes(32)), epoch: 1,
        creator: this.self.fingerprint, members: [{ ...this.self, nickname }] };
      validateGroup(state); await this.put({ state, status: 'joined' }); return state.id;
    });
  }
  accept(id: string) {
    return this.serial(async () => { const entry = this.get(id); if (entry.status !== 'invited') throw new Error('No invitation'); await this.put({ ...entry, status: 'joined' }); });
  }
  leave(id: string) {
    return this.serial(async () => {
      const entry = this.get(id);
      // Keep creator/epoch high-water metadata to prevent replay from restoring membership.
      await this.put({ state: { ...entry.state, key: '00'.repeat(32) }, status: 'left' });
    });
  }
  private get(id: string) { const entry = this.entries.get(id); if (!entry) throw new Error('Unknown group'); return entry; }
  private owned(id: string) {
    const entry = this.get(id);
    if (entry.status !== 'joined' || entry.state.creator !== this.self.fingerprint) throw new Error('Only the group creator may manage members');
    return entry;
  }
  async invite(id: string, peer: BitchatPeer) {
    await this.serial(async () => {
      const entry = this.owned(id);
      if (!peer.fingerprint || !peer.signingPublicKey || !peer.authenticatedCapabilities || !(peer.capabilities! & 8)) throw new Error('Connect to a group-capable peer first');
      if (entry.state.members.some(m => m.fingerprint === peer.fingerprint)) return;
      if (entry.state.epoch === 0xffffffff) throw new Error('Group epochs exhausted');
      const state = { ...entry.state, epoch: entry.state.epoch + 1, key: bytesToHex(randomBytes(32)), members: [...entry.state.members, { fingerprint: peer.fingerprint, signingKey: peer.signingPublicKey, nickname: peer.name }] };
      validateGroup(state); await this.put({ ...entry, state, revoked: entry.revoked?.filter(fp => fp !== peer.fingerprint) });
    });
  }
  async remove(id: string, fingerprint: string) {
    await this.serial(async () => {
      const entry = this.owned(id);
      if (fingerprint === entry.state.creator || !entry.state.members.some(m => m.fingerprint === fingerprint) || entry.state.epoch === 0xffffffff) throw new Error('Invalid group removal');
      const state = { ...entry.state, epoch: entry.state.epoch + 1, key: bytesToHex(randomBytes(32)), members: entry.state.members.filter(m => m.fingerprint !== fingerprint) };
      await this.put({ ...entry, state, revoked: [...new Set([...(entry.revoked ?? []), fingerprint])] });
    });
  }
  receiveState(peer: BitchatPeer, data: Uint8Array, invite: boolean) {
    return this.serial(async () => {
      const state = decodeGroupState(data), old = this.entries.get(state.id), creator = state.members.find(m => m.fingerprint === state.creator)!;
      if (!peer.authenticatedCapabilities || peer.fingerprint !== state.creator || peer.signingPublicKey !== creator.signingKey ||
          old && (old.state.creator !== state.creator || old.state.members.find(m => m.fingerprint === state.creator)?.signingKey !== creator.signingKey)) throw new Error('Group creator identity mismatch');
      if (!old && !invite) return false;
      if (old && (state.epoch < old.state.epoch || state.epoch === old.state.epoch && old.status !== 'left' && (state.key !== old.state.key || state.name !== old.state.name ||
          old.state.members.some(m => !state.members.some(n => n.fingerprint === m.fingerprint && n.signingKey === m.signingKey))))) throw new Error('Group state rollback');
      const own = state.members.find(m => m.fingerprint === this.self.fingerprint);
      if (own && own.signingKey !== this.self.signingKey) throw new Error('Local group identity mismatch');
      if (old && old.status !== 'left' && state.epoch === old.state.epoch && state.key === old.state.key && state.name === old.state.name && JSON.stringify(state.members) === JSON.stringify(old.state.members)) return false;
      if (!own) {
        if (old) await this.put({ state: { ...state, key: '00'.repeat(32) }, status: 'left' });
        return !!old;
      }
      // Leaving or declining never silently rejoins through a cached state replay.
      if (old?.status === 'left' && (!invite || state.epoch <= old.state.epoch)) return false;
      await this.put({ state, status: old?.status === 'left' ? 'invited' : old?.status ?? 'invited' });
      return true;
    });
  }
  needsConnection(fingerprint: string): boolean {
    return [...this.entries.values()].some(entry => entry.status !== 'left' && (entry.state.creator === fingerprint ||
      entry.state.creator === this.self.fingerprint && (entry.state.members.some(m => m.fingerprint === fingerprint) || entry.revoked?.includes(fingerprint))));
  }
  disconnected(peer: string) { for (const key of this.sent.keys()) if (key.startsWith(peer + ':')) this.sent.delete(key); }
  sync(peer: BitchatPeer): Promise<void> {
    const running = this.syncing.get(peer.id); if (running) return running;
    const work = this.syncInternal(peer).finally(() => this.syncing.delete(peer.id)); this.syncing.set(peer.id, work); return work;
  }
  private async syncInternal(peer: BitchatPeer) {
    await this.idle(); if (this.stopped || !peer.secure || !peer.authenticatedCapabilities || !(peer.capabilities! & 8)) return;
    for (const entry of this.entries.values()) {
      if (this.stopped) return;
      if (entry.status === 'joined' && entry.state.creator === this.self.fingerprint && entry.state.members.some(m => m.fingerprint === peer.fingerprint)) {
        const data = encodeGroupState(entry.state, this.identity.signingSeed), token = bytesToHex(sha256(data)), key = `${peer.id}:${entry.state.id}`;
        if (this.sent.get(key)?.token === token && Date.now() - this.sent.get(key)!.at < 60000) continue;
        await this.io.state(peer.id, data, true); if (!this.stopped) this.sent.set(key, { token, at: Date.now() });
      }
    }
    for (const entry of this.entries.values()) {
      if (this.stopped) return;
      if (entry.status !== 'joined' || entry.state.creator !== this.self.fingerprint || !entry.revoked?.includes(peer.fingerprint)) continue;
      // A removal notice carries a separate dummy key, never the current group key.
      const dummy = bytesToHex(sha256(new TextEncoder().encode(`outlink/group-removal/${entry.state.key}/${peer.fingerprint}`)));
      const data = encodeGroupState({ ...entry.state, key: dummy }, this.identity.signingSeed), token = bytesToHex(sha256(data)), key = `${peer.id}:removed:${entry.state.id}`;
      if (this.sent.get(key)?.token === token && Date.now() - this.sent.get(key)!.at < 60000) continue;
      await this.io.state(peer.id, data, false); if (!this.stopped) this.sent.set(key, { token, at: Date.now() });
    }
  }

  receiveMessage(data: Uint8Array) {
    return this.serial(async () => {
      const envelope = groupEnvelope(data), entry = this.entries.get(envelope.id);
      if (envelope.ciphertext.length <= 16) throw new Error('Invalid group ciphertext');
      if (!entry || entry.status !== 'joined' || entry.state.epoch !== envelope.epoch) return;
      const message = openGroupMessage(entry.state, data);
      if (message.timestamp < Date.now() - 21600000 || message.timestamp > Date.now() + 60000) throw new Error('Stale group message');
      await this.io.message({ id: message.id, group: entry.state.id, sender: message.member.fingerprint, name: message.member.nickname,
        content: message.content, timestamp: message.timestamp, outgoing: message.member.fingerprint === this.self.fingerprint });
    });
  }
  async send(id: string, name: string, content: string) {
    const prepared = await this.serial(async () => {
      const entry = this.get(id); if (entry.status !== 'joined') throw new Error('Not a group member');
      const timestamp = Date.now(), messageId = bytesToHex(randomBytes(16));
      return { data: sealGroupMessage(entry.state, this.identity.signingSeed, name, content, messageId, timestamp),
        message: { id: messageId, group: id, sender: this.self.fingerprint, name, content, timestamp, outgoing: true } };
    });
    if (this.stopped) throw new Error('Groups stopped');
    await this.io.broadcast(prepared.data);
    await this.io.message(prepared.message);
  }
}
