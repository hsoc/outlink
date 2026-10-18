import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { normalizeGeohash } from './geohash';
export const CHANNEL_ROTATION_MS = 86400000;
export const CHANNEL_GRACE_MS = 2 * CHANNEL_ROTATION_MS;
export type ChannelIdentity = { pubkey: string; key: Uint8Array; created: number; expires?: number };
export type ChannelIdentitySet = { current: ChannelIdentity; retired: ChannelIdentity[]; rotateAt: number; legacyPubkey?: string };
type SecretStore = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; deleteItem(key: string): Promise<void> };
type Entry = { secret: string; created: number; expires?: number };
type Ring = { version: 1; current: Entry; retired: Entry[]; legacyPubkey?: string };
const queues = new WeakMap<SecretStore, Map<string, Promise<void>>>();
const indexKey = (root: string) => `outlink.channel-keys.index.${root}`;
const ringKey = (root: string, hash: string) => `outlink.channel-keys.${root}.${hash}`;
function validate(entry: Entry) {
  if (!entry || !/^[0-9a-f]{64}$/.test(entry.secret) || !secp256k1.utils.isValidSecretKey(hexToBytes(entry.secret)) || !Number.isSafeInteger(entry.created) || entry.created < 0 || entry.expires !== undefined && (!Number.isSafeInteger(entry.expires) || entry.expires < entry.created)) throw new Error('Invalid channel identity');
}
/** Random persisted keys, not historical keys reproducible from the permanent root. */
export class ChannelIdentities {
  private pending = Promise.resolve();
  constructor(private readonly store: SecretStore, private readonly root: string, private readonly now = Date.now) {
    if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('Invalid identity root');
  }
  load(hash: string, legacy?: Uint8Array): Promise<ChannelIdentitySet> {
    hash = normalizeGeohash(hash);
    // Snapshot and clear the caller's legacy buffer even if another operation is queued.
    const old = legacy?.slice(); legacy?.fill(0);
    let owners = queues.get(this.store); if (!owners) { owners = new Map(); queues.set(this.store, owners); }
    const task = (owners.get(this.root) ?? Promise.resolve()).then(() => this.update(hash, old)).finally(() => old?.fill(0));
    this.pending = task.then(() => {}, () => {}); owners.set(this.root, this.pending);
    const settled = this.pending; void settled.then(() => { if (owners!.get(this.root) === settled) owners!.delete(this.root); });
    return task;
  }
  private async update(hash: string, legacy?: Uint8Array): Promise<ChannelIdentitySet> {
    const savedIndex = await this.store.getItem(indexKey(this.root)), index: string[] = savedIndex ? JSON.parse(savedIndex) : [];
    if (!Array.isArray(index) || index.length > 32 || new Set(index).size !== index.length || index.some(h => typeof h !== 'string' || normalizeGeohash(h) !== h)) throw new Error('Invalid channel key index');
    if (!index.includes(hash)) {
      if (index.length >= 32) throw new Error('Channel identity limit reached');
      // Reserve the index first so panic can find an interrupted first key write.
      await this.store.setItem(indexKey(this.root), JSON.stringify([...index, hash]));
    }
    const now = this.now(); if (!Number.isSafeInteger(now) || now < 0 || now + CHANNEL_GRACE_MS > Number.MAX_SAFE_INTEGER) throw new Error('Invalid identity clock');
    const saved = await this.store.getItem(ringKey(this.root, hash));
    let ring: Ring;
    if (saved) {
      ring = JSON.parse(saved); validate(ring.current);
      if (ring.legacyPubkey !== undefined && !/^[0-9a-f]{64}$/.test(ring.legacyPubkey)) throw new Error('Invalid legacy identity');
      if (ring.version !== 1 || ring.current.expires !== undefined || !Array.isArray(ring.retired) || ring.retired.length > 2) throw new Error('Invalid channel key ring');
      for (const old of ring.retired) { validate(old); if (old.expires === undefined) throw new Error('Invalid retired identity'); }
      if (new Set([ring.current.secret, ...ring.retired.map(e => e.secret)]).size !== ring.retired.length + 1) throw new Error('Repeated channel identity');
      ring.retired = ring.retired.filter(e => e.expires! > now);
      if (now >= ring.current.created + CHANNEL_ROTATION_MS) {
        const expires = now + CHANNEL_GRACE_MS;
        ring.retired.unshift({ ...ring.current, expires });
        ring.current = { secret: bytesToHex(secp256k1.utils.randomSecretKey()), created: now };
      }
    } else {
      ring = { version: 1, current: { secret: bytesToHex(secp256k1.utils.randomSecretKey()), created: now }, retired: [] };
      // One bounded compatibility window for the pre-rotation deterministic key.
      if (legacy) { ring.legacyPubkey = getPublicKey(legacy); ring.retired.push({ secret: bytesToHex(legacy), created: now, expires: now + CHANNEL_GRACE_MS }); }
    }
    if (ring.retired.length > 2) throw new Error('Channel grace key limit exceeded');
    const encoded = JSON.stringify(ring); if (encoded !== saved) await this.store.setItem(ringKey(this.root, hash), encoded);
    const materialize = (entry: Entry): ChannelIdentity => { const key = hexToBytes(entry.secret); return { key, pubkey: getPublicKey(key), created: entry.created, expires: entry.expires }; };
    return { current: materialize(ring.current), retired: ring.retired.map(materialize), rotateAt: ring.current.created + CHANNEL_ROTATION_MS, legacyPubkey: ring.legacyPubkey };
  }
  idle() { return this.pending; }
}
export async function eraseChannelIdentities(store: SecretStore, root: string) {
  const saved = await store.getItem(indexKey(root)); if (!saved) return;
  const index: unknown = JSON.parse(saved);
  if (!Array.isArray(index) || index.length > 32 || index.some(h => typeof h !== 'string' || normalizeGeohash(h) !== h)) throw new Error('Invalid channel key index');
  for (const hash of index) await store.deleteItem(ringKey(root, hash));
  await store.deleteItem(indexKey(root));
}
export function clearIdentitySet(value?: ChannelIdentitySet) { value?.current.key.fill(0); value?.retired.forEach(entry => entry.key.fill(0)); }
