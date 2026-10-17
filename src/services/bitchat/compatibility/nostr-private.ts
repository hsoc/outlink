import { secp256k1 } from '@noble/curves/secp256k1.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { finalizeEvent, getPublicKey, verifyEvent, getEventHash, type Event } from 'nostr-tools/pure';
import { bytes, join, text } from '../bitchat-wire';
const MAX = 65536;
function sharedKey(secret: Uint8Array, publicKey: string, parity = 2): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(publicKey)) throw new Error('Invalid Nostr public key');
  const shared = secp256k1.getSharedSecret(secret, join(Uint8Array.of(parity), hexToBytes(publicKey)), true);
  try { return hkdf(sha256, shared, new Uint8Array(), bytes('nip44-v2'), 32); } finally { shared.fill(0); }
}
export function encryptPrivateContent(plain: string, secret: Uint8Array, recipient: string): string {
  if (bytes(plain).length > MAX) throw new Error('Private content too large');
  const key = sharedKey(secret, recipient), nonce = randomBytes(24), payload = bytes(plain);
  try { return 'v2:' + base64urlnopad.encode(join(nonce, xchacha20poly1305(key, nonce).encrypt(payload))); }
  finally { key.fill(0); payload.fill(0); }
}
export function decryptPrivateContent(value: string, secret: Uint8Array, sender: string): string {
  if (value.length > MAX || !value.startsWith('v2:')) throw new Error('Invalid private content');
  const data = base64urlnopad.decode(value.slice(3));
  if (data.length <= 40) throw new Error('Truncated private content');
  for (const parity of [2, 3]) {
    const key = sharedKey(secret, sender, parity);
    try {
      const plain = xchacha20poly1305(key, data.subarray(0, 24)).decrypt(data.subarray(24));
      try { return text(plain); } finally { plain.fill(0); }
    } catch (error) { if (parity === 3) throw error; } finally { key.fill(0); }
  }
  throw new Error('Invalid private content');
}
function shape(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false;
  const event = value as Event;
  return /^[0-9a-f]{64}$/.test(event.pubkey ?? '') && Number.isSafeInteger(event.created_at) &&
    Number.isSafeInteger(event.kind) && typeof event.content === 'string' && bytes(event.content).length <= MAX &&
    Array.isArray(event.tags) && event.tags.length <= 64 && event.tags.every(tag => Array.isArray(tag) && tag.length <= 16 && tag.every(v => typeof v === 'string' && bytes(v).length <= 1024));
}
function signed(value: unknown): value is Event {
  try { return shape(value) && getEventHash(value) === value.id && verifyEvent(value); } catch { return false; }
}
function decode(value: string): unknown {
  if (bytes(value).length > MAX) throw new Error('Private JSON too large');
  return JSON.parse(value);
}
/** BitChat's historical envelope format is deliberately distinct from standard NIP-44/59. */
export function createPrivateEnvelope(content: string, senderSecret: Uint8Array, recipient: string, now = Math.floor(Date.now() / 1000)): Event {
  const pubkey = getPublicKey(senderSecret);
  const rumor = { id: '', pubkey, created_at: now, kind: 14, tags: [] as string[][], content };
  const jitter = () => now + new DataView(randomBytes(4).buffer).getUint32(0) % 1801 - 900;
  const seal = finalizeEvent({ kind: 13, created_at: jitter(), tags: [], content: encryptPrivateContent(JSON.stringify(rumor), senderSecret, recipient) }, senderSecret);
  const wrapSecret = secp256k1.utils.randomSecretKey();
  try { return finalizeEvent({ kind: 1059, created_at: jitter(), tags: [['p', recipient]], content: encryptPrivateContent(JSON.stringify(seal), wrapSecret, recipient) }, wrapSecret); }
  finally { wrapSecret.fill(0); }
}
export function openPrivateEnvelope(value: unknown, recipientSecret: Uint8Array) {
  const recipient = getPublicKey(recipientSecret);
  if (!signed(value) || value.kind !== 1059 || JSON.stringify(value.tags) !== JSON.stringify([['p', recipient]])) throw new Error('Invalid private envelope');
  const seal = decode(decryptPrivateContent(value.content, recipientSecret, value.pubkey));
  if (!signed(seal) || seal.kind !== 13 || seal.tags.length) throw new Error('Invalid private seal');
  const rumor = decode(decryptPrivateContent(seal.content, recipientSecret, seal.pubkey));
  if (!shape(rumor) || rumor.kind !== 14 || rumor.pubkey !== seal.pubkey || rumor.sig != null ||
      (rumor.tags.length && JSON.stringify(rumor.tags) !== JSON.stringify([['p', recipient]]))) throw new Error('Invalid private message');
  return { content: rumor.content, sender: seal.pubkey, timestamp: rumor.created_at, id: value.id };
}
