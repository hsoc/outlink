import { finalizeEvent, getEventHash, verifyEvent, type Event } from 'nostr-tools/pure';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { bytes, text } from '../bitchat-wire';
import { fields16, required, tlv16 } from './binary';
import { decodeCourier, encodeCourier, type CourierEnvelope } from './courier';
export type Carrier = { direction: 1 | 2 | 3 | 4; hash: string; event: Event };
export const validHash = (hash: string) => /^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(hash);
export function validEvent(value: unknown, maximum = 16384): value is Event {
  if (!value || typeof value !== 'object') return false;
  const e = value as Event;
  if (!/^[0-9a-f]{64}$/.test(e.id ?? '') || !/^[0-9a-f]{64}$/.test(e.pubkey ?? '') || !/^[0-9a-f]{128}$/.test(e.sig ?? '') ||
    !Number.isSafeInteger(e.kind) || !Number.isSafeInteger(e.created_at) || typeof e.content !== 'string' || bytes(e.content).length > maximum ||
    !Array.isArray(e.tags) || e.tags.length > 64 || !e.tags.every(tag => Array.isArray(tag) && tag.length <= 8 && tag.every(v => typeof v === 'string' && bytes(v).length <= 512))) return false;
  try { return bytes(JSON.stringify(e)).length <= maximum && getEventHash(e) === e.id && verifyEvent(e); } catch { return false; }
}
export function channelEvent(event: Event, hash: string, bridge: boolean, now = Date.now()): boolean {
  const key = bridge ? 'r' : 'g', tags = event.tags.filter(tag => tag[0] === key);
  return validHash(hash) && tags.length === 1 && tags[0].length === 2 && tags[0][1] === hash &&
    [20000, 20001].includes(event.kind) && Math.abs(event.created_at * 1000 - now) <= 900000 && event.created_at * 1000 <= now + 60000 &&
    (event.kind === 20001 ? !event.content : !!event.content.trim() && bytes(event.content).length <= 16000) &&
    event.tags.every(tag => tag[0] !== 'expiration' || /^\d{1,12}$/.test(tag[1] ?? '') && Number(tag[1]) * 1000 > now);
}
export function encodeCarrier(carrier: Carrier): Uint8Array {
  if (!validHash(carrier.hash) || ![1, 2, 3, 4].includes(carrier.direction) || !validEvent(carrier.event)) throw new Error('Invalid Nostr carrier');
  return tlv16([[1, Uint8Array.of(carrier.direction)], [2, bytes(carrier.hash)], [3, bytes(JSON.stringify(carrier.event))]]);
}
export function decodeCarrier(data: Uint8Array): Carrier {
  const fields = fields16(data, 16500), direction = required(fields, 1, 1)[0], hash = text(required(fields, 2)), json = required(fields, 3);
  if (![1, 2, 3, 4].includes(direction) || !validHash(hash) || json.length > 16384) throw new Error('Invalid Nostr carrier');
  const event: unknown = JSON.parse(text(json)); if (!validEvent(event)) throw new Error('Invalid carried signature');
  if (!channelEvent(event, hash, direction >= 3)) throw new Error('Invalid carried channel');
  return { direction: direction as Carrier['direction'], hash, event };
}
export function meshStableId(sender: string, timestamp: number, content: string): string {
  return bytesToHex(sha256(bytes(`${sender.toLowerCase()}|${timestamp}|${content.trim()}`))).slice(0, 32);
}
export function bridgeEvent(key: Uint8Array, cell: string, name: string, content: string, sender?: string, timestamp = Date.now()): Event {
  if (!validHash(cell) || cell.length !== 6 || bytes(content).length > 16000 || bytes(name).length > 64) throw new Error('Invalid bridge message');
  return finalizeEvent({ kind: content ? 20000 : 20001, created_at: Math.floor(timestamp / 1000), content,
    tags: [['r', cell], ...(content && name.trim() ? [['n', name.trim()]] : []), ...(content && sender ? [['m', meshStableId(sender, timestamp, content), sender, String(timestamp)]] : [])] }, key);
}
export function bridgeHint(event: Event): string | undefined {
  const tag = event.tags.find(tag => tag[0] === 'm');
  if (!tag || tag.length < 4 || !/^[0-9a-fA-F]{16}$/.test(tag[2]) || !/^\d{1,16}$/.test(tag[3]) || !Number.isSafeInteger(Number(tag[3]))) return;
  return meshStableId(tag[2], Number(tag[3]), event.content);
}
export function courierDrop(envelope: CourierEnvelope): Event {
  const key = randomBytes(32);
  try { return finalizeEvent({ kind: 1401, created_at: Math.floor(Date.now() / 1000), content: base64.encode(encodeCourier(envelope)),
    tags: [['x', bytesToHex(envelope.tag)], ['expiration', String(Math.floor(envelope.expiry / 1000))]] }, key); } finally { key.fill(0); }
}
export function decodeDrop(event: Event, now = Date.now()): CourierEnvelope {
  if (event.kind !== 1401 || event.content.length > 27500 || !validEvent(event, 30000)) throw new Error('Invalid courier drop');
  const envelope = decodeCourier(base64.decode(event.content));
  if (envelope.expiry <= now || envelope.expiry > now + 86400000 + 60000 || !event.tags.some(tag => tag[0] === 'x' && tag[1] === bytesToHex(envelope.tag))) throw new Error('Invalid courier drop tag/expiry');
  return envelope;
}
