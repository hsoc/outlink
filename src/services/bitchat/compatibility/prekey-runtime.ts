import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { decodePrekeys, encodePrekeys, openCourier, prekeySigningBytes, type PrekeyBundle } from './courier';
import type { BitchatIdentity } from '../bitchat-session';
export interface ProtocolStorage {
  get<T>(scope: string, id: string): Promise<T | null>;
  list<T>(scope: string, maximum: number): Promise<T[]>;
  put(scope: string, id: string, value: unknown): Promise<void>;
  remove(scope: string, id: string): Promise<void>;
}
type PrivateRecord = { id: number; seed: string; created: number; consumed?: number };
type PrivateState = { next: number; generated: number; records: PrivateRecord[] };
type RemoteBundle = { owner: string; wire: string; signing: string; used: number[]; assignments: Record<string, number>; at: number };
/** Serialized secure-key updates commit before publication, consumption or delivery. */
export class PrekeyRuntime {
  private pending = Promise.resolve();
  constructor(private readonly identity: BitchatIdentity, private readonly storage: ProtocolStorage,
    private readonly secrets: { get(): Promise<string | null>; set(value: string): Promise<void> }, private readonly now = Date.now) {}
  private serial<T>(task: () => Promise<T>): Promise<T> { const work = this.pending.catch(() => {}).then(task); this.pending = work.then(() => {}, () => {}); return work; }
  async idle() { await this.pending.catch(() => {}); }
  private async state(): Promise<PrivateState> {
    const saved = await this.secrets.get(), state: PrivateState = saved ? JSON.parse(saved) : { next: 1, generated: 0, records: [] };
    if (!Number.isSafeInteger(state.next) || state.next < 1 || state.next > 0x100000000 || state.records.length > 264 ||
      state.records.some(record => !/^[0-9a-f]{64}$/.test(record.seed) || !Number.isSafeInteger(record.id) || record.id < 1 || record.id >= state.next) || new Set(state.records.map(record => record.id)).size !== state.records.length) throw new Error('Invalid local prekeys');
    return state;
  }
  private maintain(state: PrivateState): boolean {
    const now = this.now(), old = state.records.length;
    state.records = state.records.filter(record => record.consumed === undefined ? now - record.created < 30 * 86400000 : now - record.consumed < 2 * 86400000);
    let changed = old !== state.records.length;
    const unused = state.records.filter(record => record.consumed === undefined).length;
    if (unused < 3) for (let i = unused; i < 8; ++i) {
      if (state.next > 0xffffffff) throw new Error('Prekey IDs exhausted');
      state.records.push({ id: state.next++, seed: bytesToHex(randomBytes(32)), created: now }); changed = true;
    }
    if (changed || !state.generated) state.generated = Math.max(now, state.generated + 1);
    return changed;
  }
  bundle(): Promise<Uint8Array> {
    return this.serial(async () => {
      const state = await this.state(); this.maintain(state); await this.secrets.set(JSON.stringify(state));
      const bundle = { owner: this.identity.noisePublicKey, generatedAt: state.generated, prekeys: state.records.filter(record => record.consumed === undefined).map(record => {
        const seed = hexToBytes(record.seed); try { return { id: record.id, publicKey: x25519.getPublicKey(seed) }; } finally { seed.fill(0); }
      }) };
      return encodePrekeys({ ...bundle, signature: ed25519.sign(prekeySigningBytes(bundle), this.identity.signingSeed) });
    });
  }
  open(ciphertext: Uint8Array, id?: number) {
    return this.serial(async () => {
      if (id === undefined) return { ...openCourier(ciphertext, this.identity.noiseSeed), changed: false };
      const state = await this.state(); this.maintain(state);
      const record = state.records.find(record => record.id === id); if (!record) throw new Error('Prekey unavailable');
      const seed = hexToBytes(record.seed);
      try {
        const opened = openCourier(ciphertext, seed, id), changed = record.consumed === undefined;
        if (changed) {
          if (state.records.filter(record => record.consumed !== undefined).length >= 256) throw new Error('Prekey grace capacity reached');
          record.consumed = this.now(); state.generated = Math.max(this.now(), state.generated + 1);
          this.maintain(state); await this.secrets.set(JSON.stringify(state));
        }
        return { ...opened, changed };
      } finally { seed.fill(0); }
    });
  }
  ingest(wire: Uint8Array, signing: Uint8Array): Promise<boolean> {
    return this.serial(async () => {
      const bundle = decodePrekeys(wire, signing), owner = bytesToHex(bundle.owner);
      if (bundle.generatedAt > this.now() + 60000 || this.now() - bundle.generatedAt > 7 * 86400000) return false;
      const previous = await this.storage.get<RemoteBundle>('prekey-bundles', owner);
      if (previous && previous.signing !== bytesToHex(signing)) throw new Error('Prekey signer changed');
      if (previous && previous.at >= bundle.generatedAt) return false;
      const ids = new Set(bundle.prekeys.map(key => key.id));
      const entry: RemoteBundle = { owner, signing: bytesToHex(signing), wire: base64.encode(wire), at: bundle.generatedAt,
        used: (previous?.used ?? []).filter(id => ids.has(id)), assignments: Object.fromEntries(Object.entries(previous?.assignments ?? {}).filter(([, id]) => ids.has(id))) };
      const all = await this.storage.list<RemoteBundle>('prekey-bundles', 200);
      if (!previous && all.length >= 200) { const oldest = all.sort((a, b) => a.at - b.at)[0]; await this.storage.remove('prekey-bundles', oldest.owner); }
      await this.storage.put('prekey-bundles', owner, entry); return true;
    });
  }
  assign(owner: Uint8Array, message: string): Promise<PrekeyBundle['prekeys'][number] | undefined> {
    return this.serial(async () => {
      const id = bytesToHex(owner), saved = await this.storage.get<RemoteBundle>('prekey-bundles', id);
      if (!saved || this.now() - saved.at > 7 * 86400000 || saved.at > this.now() + 60000) return;
      const bundle = decodePrekeys(base64.decode(saved.wire), hexToBytes(saved.signing));
      const assigned = saved.assignments[message]; if (assigned !== undefined) return bundle.prekeys.find(key => key.id === assigned);
      const next = bundle.prekeys.filter(key => !saved.used.includes(key.id)).sort((a, b) => a.id - b.id)[0]; if (!next) return;
      saved.used.push(next.id); saved.assignments[message] = next.id;
      await this.storage.put('prekey-bundles', id, saved); return next;
    });
  }
}
