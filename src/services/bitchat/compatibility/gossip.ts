import { isBroadcast } from '../bitchat-wire';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { join, type BitchatPacket } from '../bitchat-wire';
import { fields16, number, required, tlv16, unsigned } from './binary';
const bitTypes = [1, 2, 3, 16, 17, 32, 33, 34, 35, 36, 37];
export type SyncRequest = { p: number; m: number; data: Uint8Array; types?: number; since?: number; fragmentIds?: string[] };
export function gossipId(packet: BitchatPacket): Uint8Array {
  return sha256(join(Uint8Array.of(packet.type), hexToBytes(packet.sender), unsigned(packet.timestamp, 8), packet.payload)).slice(0, 16);
}
export function bucket(id: Uint8Array, modulus: number): number {
  if (modulus <= 1) return 0;
  const hash = sha256(id), view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
  return Math.max(1, Number((view.getBigUint64(0) & 0x7fffffffffffffffn) % BigInt(modulus)));
}
function encodeSet(values: number[], p: number): Uint8Array {
  const output: number[] = []; let byte = 0, count = 0, previous = 0;
  const bit = (n: number) => { byte = byte * 2 + n; if (++count === 8) { output.push(byte); count = byte = 0; } };
  for (const value of values) {
    const delta = BigInt(value - previous - 1); previous = value;
    const q = delta >> BigInt(p), r = delta & ((1n << BigInt(p)) - 1n);
    if (q > 8192n) throw new Error('GCS unary budget exceeded');
    for (let i = 0n; i < q; ++i) bit(1); bit(0);
    for (let i = p - 1; i >= 0; --i) bit(Number(r >> BigInt(i) & 1n));
  }
  if (count) output.push(byte * 2 ** (8 - count));
  return Uint8Array.from(output);
}
export function buildFilter(ids: Uint8Array[], maximumBytes = 400, fpr = 0.01) {
  if (maximumBytes < 1 || maximumBytes > 1024) throw new Error('Invalid GCS budget');
  const p = Math.max(1, Math.ceil(Math.log2(1 / Math.max(0.000001, Math.min(0.25, fpr)))));
  const capacity = Math.max(1, Math.floor(Math.max(8, maximumBytes * 8) / Math.max(3, p + 2)));
  let included = Math.min(ids.length, capacity);
  const m = included ? Math.min(0xffffffff, included * 2 ** p) : 1;
  let data: Uint8Array = new Uint8Array();
  while (included) {
    const values = [...new Set(ids.slice(0, included).map(id => bucket(id, m)))].sort((a, b) => a - b);
    data = encodeSet(values, p);
    if (data.length <= maximumBytes) return { p, m, data, included };
    if (included === 1) break;
    included = Math.max(1, Math.floor(included * 0.9));
  }
  return { p, m, data: new Uint8Array(), included: 0 };
}
export function decodeFilter(p: number, m: number, data: Uint8Array): number[] {
  if (!Number.isInteger(p) || p < 1 || p > 32 || m <= 1 || data.length > 1024) return [];
  let offset = 0, value = 0; const values: number[] = [];
  const bit = () => offset < data.length * 8 ? data[Math.floor(offset / 8)] >> (7 - offset++ % 8) & 1 : undefined;
  while (offset < data.length * 8) {
    let q = 0, n = bit();
    while (n === 1) { ++q; n = bit(); }
    if (n === undefined) break;
    let r = 0n, complete = true;
    for (let i = 0; i < p; ++i) { const next = bit(); if (next === undefined) { complete = false; break; } r = r * 2n + BigInt(next); }
    if (!complete) break;
    value += Number((BigInt(q) << BigInt(p)) + r + 1n);
    if (value >= m) break;
    values.push(value);
  }
  return values;
}
export function encodeSync(request: SyncRequest): Uint8Array {
  const fields: [number, Uint8Array][] = [[1, Uint8Array.of(request.p)], [2, unsigned(request.m, 4)], [3, request.data]];
  if (request.types !== undefined) fields.push([4, request.types > 255 ? Uint8Array.of(request.types & 255, request.types >> 8) : Uint8Array.of(request.types)]);
  if (request.since !== undefined) fields.push([5, unsigned(request.since, 8)]);
  if (request.fragmentIds?.length) fields.push([6, new TextEncoder().encode(request.fragmentIds.slice(0, 60).join(','))]);
  return tlv16(fields);
}
export function decodeSync(data: Uint8Array): SyncRequest {
  const f = fields16(data, 4096), p = required(f, 1, 1)[0], m = number(required(f, 2), 4), filter = required(f, 3);
  if (p < 1 || p > 32 || m < 1 || filter.length > 1024) throw new Error('Invalid sync parameters');
  let types: number | undefined;
  const flags = f.get(4);
  if (flags && flags.length && flags.length <= 8) types = (flags[0] | (flags[1] ?? 0) << 8) & 0x7ff;
  const fragmentIds = f.get(6);
  return { p, m, data: filter, types, since: f.has(5) ? number(required(f, 5), 8) : undefined,
    fragmentIds: fragmentIds && fragmentIds.length <= 1024 ? new TextDecoder().decode(fragmentIds).split(',').slice(0, 60).filter(id => /^[0-9a-fA-F]{16}$/.test(id)).map(id => id.toLowerCase()) : undefined };
}
export function syncIncludes(flags: number | undefined, type: number): boolean {
  const bit = bitTypes.indexOf(type); return bit >= 0 && ((flags ?? 3) & 1 << bit) !== 0;
}
/** Only public cacheable packets belong here, never private envelopes or handshakes. */
export class GossipCache {
  private readonly packets = new Map<string, BitchatPacket>();
  private total = 0;
  constructor(private readonly onChange?: (id: string, packet?: BitchatPacket) => void) {}
  entries(now = Date.now()): BitchatPacket[] {
    for (const [id, packet] of this.packets) {
      const age = packet.type === 2 ? 21600000 : packet.type === 36 ? 86400000 : 900000;
      if (now - packet.timestamp > age || packet.timestamp > now + 60000) this.remove(id);
    }
    return [...this.packets.values()];
  }
  private remove(id: string) { const old = this.packets.get(id); if (old) { this.total -= old.payload.length; this.packets.delete(id); this.onChange?.(id); } }
  add(packet: BitchatPacket, persist = true) {
    if (!isBroadcast(packet) || ![1, 2, 32, 34, 35, 36, 37].includes(packet.type) || packet.payload.length > 8 * 1024 * 1024) return;
    const id = bytesToHex(gossipId(packet));
    if (this.packets.has(id)) return;
    if (packet.type === 1) for (const [key, old] of this.packets) if (old.type === 1 && old.sender === packet.sender) this.remove(key);
    this.packets.set(id, packet); this.total += packet.payload.length;
    if (persist) this.onChange?.(id, packet);
    while (this.packets.size > 1000 || this.total > 8 * 1024 * 1024) this.remove(this.packets.keys().next().value!);
  }
  request(now = Date.now()): Uint8Array {
    const packets = this.entries(now).filter(packet => [1, 2].includes(packet.type)).sort((a, b) => b.timestamp - a.timestamp);
    const filter = buildFilter(packets.map(gossipId));
    return encodeSync({ ...filter, types: 3, since: filter.included ? packets[filter.included - 1].timestamp : undefined });
  }
  missing(request: SyncRequest, now = Date.now()): BitchatPacket[] {
    const known = new Set(decodeFilter(request.p, request.m, request.data));
    return this.entries(now).filter(packet => syncIncludes(request.types, packet.type) &&
      (packet.type === 1 || request.since === undefined || packet.timestamp >= request.since) && !known.has(bucket(gossipId(packet), request.m)))
      .sort((a, b) => (a.type === 1 ? 0 : 1) - (b.type === 1 ? 0 : 1) || a.timestamp - b.timestamp);
  }
}
