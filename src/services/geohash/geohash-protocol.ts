import { finalizeEvent, getEventHash, verifyEvent, type Event } from 'nostr-tools/pure';
import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { normalizeGeohash } from './geohash';

export const MAX_GEO_CONTENT_BYTES = 16000;
const encoder = new TextEncoder();
export function channelKey(master: Uint8Array, geohash: string): Uint8Array {
  const hash = normalizeGeohash(geohash);
  for (let counter = 0; ; counter++) {
    const key = hkdf(sha256, master, undefined, encoder.encode(`outlink/geohash/v1/${hash}/${counter}`), 32);
    if (secp256k1.utils.isValidSecretKey(key)) return key;
  }
}
export function createGeohashEvent(secret: Uint8Array, geohash: string, nickname: string,
  content: string, presence = false, now = Math.floor(Date.now() / 1000)): Event {
  const hash = normalizeGeohash(geohash);
  if (!presence && (!content.trim() || encoder.encode(content).length > MAX_GEO_CONTENT_BYTES))
    throw new Error('Message must fit 16000 UTF-8 bytes');
  if (!nickname.trim() || encoder.encode(nickname).length > 64) throw new Error('Invalid nickname');
  return finalizeEvent({ kind: presence ? 20001 : 20000, created_at: now,
    tags: presence ? [['g', hash]] : [['g', hash], ['n', nickname.trim()], ['nonce', BigInt('0x' + bytesToHex(randomBytes(8))).toString(), '0']], content: presence ? '' : content }, secret);
}
/** Validate before signature work; channel tags match exactly, never by prefix. */
export function validateGeohashEvent(value: unknown, hash: string, now = Math.floor(Date.now() / 1000)): Event | null {
  if (!value || typeof value !== 'object') return null;
  const e = value as Event;
  if (![20000, 20001].includes(e.kind) || !Number.isSafeInteger(e.created_at) || e.created_at < now - 900 ||
      e.created_at > now + 60 || !/^[0-9a-f]{64}$/.test(e.id ?? '') || !/^[0-9a-f]{64}$/.test(e.pubkey ?? '') ||
      !/^[0-9a-f]{128}$/.test(e.sig ?? '') || typeof e.content !== 'string' ||
      encoder.encode(e.content).length > MAX_GEO_CONTENT_BYTES || !Array.isArray(e.tags) || e.tags.length > 32 ||
      !e.tags.every(t => Array.isArray(t) && t.length <= 8 && t.every(s => typeof s === 'string' && s.length <= 256))) return null;
  const channels = e.tags.filter(t => t[0] === 'g');
  if (channels.length !== 1 || channels[0].length !== 2 || channels[0][1] !== hash) return null;
  if (e.kind === 20001 && (e.content !== '' || e.tags.some(t => t[0] === 'n'))) return null;
  if (e.kind === 20000 && !e.content.trim()) return null;
  for (const tag of e.tags) if (tag[0] === 'expiration' &&
    (tag.length !== 2 || !/^\d{1,12}$/.test(tag[1]) || Number(tag[1]) <= now)) return null;
  try { return getEventHash(e) === e.id && verifyEvent(e) ? e : null; } catch { return null; }
}
export function normalizeGeoRelays(input: readonly string[]): string[] {
  const urls = input.map(raw => {
    const url = new URL(raw.trim());
    if (url.protocol !== 'wss:' || url.username || url.password || url.hash || raw.length > 256)
      throw new Error('Use secure WebSocket relay addresses');
    return url.toString();
  });
  const unique = [...new Set(urls)];
  if (!unique.length || unique.length > 6) throw new Error('Choose between one and six relays');
  return unique;
}
