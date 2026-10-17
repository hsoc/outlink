import { SymmetricState } from '@libp2p/noise/protocol';
import { wrapCrypto } from '@libp2p/noise/crypto';
import { pureJsCrypto } from '@libp2p/noise/crypto/js';
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { bytes, join } from '../bitchat-wire';
import { fields16, number, required, tlv16, unsigned, label } from './binary';
export type CourierEnvelope = { tag: Uint8Array; expiry: number; ciphertext: Uint8Array; copies: number; prekeyId?: number };
export const COURIER_TTL = 86400000;
export function courierTag(key: Uint8Array, day: number): Uint8Array {
  if (key.length !== 32) throw new Error('Invalid recipient key');
  return hmac(sha256, key, join(bytes('bitchat-courier-tag-v1'), unsigned(day, 4))).slice(0, 16);
}
export function courierTags(key: Uint8Array, now = Date.now()): Uint8Array[] {
  const day = Math.floor(now / COURIER_TTL);
  return [Math.max(0, day - 1), day, day + 1].map(day => courierTag(key, day));
}
export function encodeCourier(value: CourierEnvelope): Uint8Array {
  if (value.tag.length !== 16 || !value.ciphertext.length || value.ciphertext.length > 16384) throw new Error('Invalid courier envelope');
  const fields: [number, Uint8Array][] = [[1, value.tag], [2, unsigned(value.expiry, 8)], [3, value.ciphertext]];
  const copies = Math.max(1, Math.min(8, Math.trunc(value.copies)));
  if (!Number.isFinite(copies)) throw new Error('Invalid courier copy budget');
  if (copies > 1) fields.push([4, Uint8Array.of(copies)]);
  if (value.prekeyId !== undefined) fields.push([5, unsigned(value.prekeyId, 4)]);
  return tlv16(fields);
}
export function decodeCourier(data: Uint8Array): CourierEnvelope {
  const f = fields16(data, 16500), ciphertext = required(f, 3);
  if (!ciphertext.length || ciphertext.length > 16384) throw new Error('Invalid courier size');
  return { tag: required(f, 1, 16), expiry: number(required(f, 2), 8), ciphertext,
    copies: f.has(4) ? Math.max(1, Math.min(8, required(f, 4, 1)[0])) : 1,
    prekeyId: f.has(5) ? number(required(f, 5), 4) : undefined };
}
const asBytes = (value: Uint8Array | { subarray(): Uint8Array }) => value instanceof Uint8Array ? value : value.subarray();
function symmetric(recipient: Uint8Array, prekeyId?: number) {
  const state = new SymmetricState(wrapCrypto(pureJsCrypto), 'Noise_X_25519_ChaChaPoly_SHA256');
  state.mixHash(prekeyId === undefined ? bytes('bitchat-courier-v1') : join(bytes('bitchat-prekey-v1'), unsigned(prekeyId, 4)));
  state.mixHash(recipient); return state;
}
const destroy = (state: SymmetricState) => { state.ck.fill(0); state.cs.k?.fill(0); };
/** Independent Noise X transcript using the same primitives as the existing XX implementation. */
export function sealCourier(plain: Uint8Array, senderSeed: Uint8Array, recipientKey: Uint8Array, prekeyId?: number,
  ephemeralSeed = randomBytes(32)): Uint8Array {
  if (senderSeed.length !== 32 || recipientKey.length !== 32 || plain.length > 16288) throw new Error('Invalid courier seal');
  const ephemeral = ephemeralSeed.slice(), state = symmetric(recipientKey, prekeyId);
  try {
    const e = x25519.getPublicKey(ephemeral); state.mixHash(e);
    let dh = x25519.getSharedSecret(ephemeral, recipientKey); state.mixKey(dh); dh.fill(0);
    const s = asBytes(state.encryptAndHash(x25519.getPublicKey(senderSeed)));
    dh = x25519.getSharedSecret(senderSeed, recipientKey); state.mixKey(dh); dh.fill(0);
    return join(e, s, asBytes(state.encryptAndHash(plain)));
  } finally { ephemeral.fill(0); destroy(state); }
}
export function openCourier(ciphertext: Uint8Array, recipientSeed: Uint8Array, prekeyId?: number) {
  if (recipientSeed.length !== 32 || ciphertext.length < 96 || ciphertext.length > 16384) throw new Error('Invalid courier ciphertext');
  const state = symmetric(x25519.getPublicKey(recipientSeed), prekeyId);
  try {
    const e = ciphertext.subarray(0, 32); state.mixHash(e);
    let dh = x25519.getSharedSecret(recipientSeed, e); state.mixKey(dh); dh.fill(0);
    const sender = asBytes(state.decryptAndHash(ciphertext.subarray(32, 80)));
    dh = x25519.getSharedSecret(recipientSeed, sender); state.mixKey(dh); dh.fill(0);
    return { sender: sender.slice(), payload: asBytes(state.decryptAndHash(ciphertext.subarray(80))).slice() };
  } finally { destroy(state); }
}
export type PrekeyBundle = { owner: Uint8Array; prekeys: { id: number; publicKey: Uint8Array }[]; generatedAt: number; signature: Uint8Array };
export function prekeySigningBytes(bundle: Omit<PrekeyBundle, 'signature'>): Uint8Array {
  if (bundle.owner.length !== 32 || !bundle.prekeys.length || bundle.prekeys.length > 8 ||
      new Set(bundle.prekeys.map(p => p.id)).size !== bundle.prekeys.length || bundle.prekeys.some(p => p.publicKey.length !== 32)) throw new Error('Invalid prekey bundle');
  return join(label('bitchat-prekey-bundle-v1'), bundle.owner, Uint8Array.of(bundle.prekeys.length),
    ...bundle.prekeys.map(p => join(unsigned(p.id, 4), p.publicKey)), unsigned(bundle.generatedAt, 8));
}
export function encodePrekeys(bundle: PrekeyBundle): Uint8Array {
  prekeySigningBytes(bundle);
  if (bundle.signature.length !== 64) throw new Error('Invalid prekey signature');
  return tlv16([[1, bundle.owner], [2, join(...bundle.prekeys.map(p => join(unsigned(p.id, 4), p.publicKey)))], [3, unsigned(bundle.generatedAt, 8)], [4, bundle.signature]]);
}
export function decodePrekeys(data: Uint8Array, signingKey: Uint8Array): PrekeyBundle {
  const f = fields16(data, 1024), entries = required(f, 2);
  if (!entries.length || entries.length % 36 || entries.length > 8 * 36) throw new Error('Invalid prekeys');
  const prekeys = Array.from({ length: entries.length / 36 }, (_, i) => ({ id: number(entries.slice(i * 36, i * 36 + 4), 4), publicKey: entries.slice(i * 36 + 4, (i + 1) * 36) }));
  const bundle = { owner: required(f, 1, 32), prekeys, generatedAt: number(required(f, 3), 8), signature: required(f, 4, 64) };
  if (!ed25519.verify(bundle.signature, prekeySigningBytes(bundle), signingKey)) throw new Error('Invalid prekey signature');
  return bundle;
}
