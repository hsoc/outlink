import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const BITCHAT_SERVICE_UUID = 'F47B5E2D-4A9E-4C5A-9B3F-8E1D2C3A4B5C';
export const BITCHAT_CHARACTERISTIC_UUID = 'A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D';
export const BITCHAT_TTL = 7;
export const BITCHAT_MAX_PACKET = 128 * 1024;
export const BitchatType = { announce: 1, message: 2, leave: 3, courier: 4, handshake: 16, encrypted: 17, fragment: 32, sync: 33, file: 34, board: 35, prekeys: 36, group: 37, ping: 38, pong: 39, carrier: 40, voice: 41 } as const;
export type BitchatPacket = {
  version: 1 | 2; type: number; ttl: number; timestamp: number; sender: string;
  recipient?: string; route?: string[]; payload: Uint8Array; signature?: Uint8Array;
  /** Retain original compression bytes for forwarding and signature validation. */
  wirePayload?: Uint8Array; compressed?: boolean; rsr?: boolean;
};
export const isBroadcast = (packet: Pick<BitchatPacket, 'recipient'>): boolean => !packet.recipient || packet.recipient === 'ffffffffffffffff';
export type InflateRaw = (bytes: Uint8Array, size: number) => Promise<Uint8Array>;
const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export function text(value: Uint8Array): string { return decoder.decode(value); }
export function bytes(value: string): Uint8Array { return utf8.encode(value); }
export function join(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((sum, v) => sum + v.length, 0));
  let offset = 0;
  for (const v of values) { output.set(v, offset); offset += v.length; }
  return output;
}
function id(value: string): Uint8Array {
  if (!/^[0-9a-f]{16}$/.test(value)) throw new Error('Invalid Bitchat peer ID');
  return hexToBytes(value);
}
export function peerId(noisePublicKey: Uint8Array): string {
  if (noisePublicKey.length !== 32) throw new Error('Invalid Noise public key');
  return bytesToHex(sha256(noisePublicKey).subarray(0, 8));
}
export function padPacket(value: Uint8Array): Uint8Array {
  const target = [256, 512, 1024, 2048].find((n) => value.length + 16 <= n);
  const count = target == null ? 0 : target - value.length;
  return count > 0 && count <= 255 ? join(value, new Uint8Array(count).fill(count)) : value;
}
export function encodePacket(packet: BitchatPacket, padding = false): Uint8Array {
  const payload = packet.wirePayload ?? packet.payload;
  if (![1, 2].includes(packet.version) || !Number.isSafeInteger(packet.timestamp) || packet.timestamp < 0 ||
      !Number.isInteger(packet.ttl) || packet.ttl < 0 || packet.ttl > BITCHAT_TTL ||
      !Number.isInteger(packet.type) || packet.type < 0 || packet.type > 255 ||
      payload.length > BITCHAT_MAX_PACKET || (packet.version === 1 && payload.length > 65535) ||
      (packet.signature && packet.signature.length !== 64)) throw new Error('Invalid Bitchat packet');
  const route = packet.route ?? [];
  if (route.length > 10 || (route.length && packet.version !== 2)) throw new Error('Invalid Bitchat route');
  const header = new Uint8Array(packet.version === 1 ? 14 : 16);
  header.set([packet.version, packet.type, packet.ttl]);
  const view = new DataView(header.buffer);
  view.setBigUint64(3, BigInt(packet.timestamp));
  header[11] = (packet.recipient ? 1 : 0) | (packet.signature ? 2 : 0) | (packet.compressed ? 4 : 0) |
    (route.length ? 8 : 0) | (packet.rsr ? 16 : 0);
  if (packet.version === 1) view.setUint16(12, payload.length); else view.setUint32(12, payload.length);
  const output = join(header, id(packet.sender), packet.recipient ? id(packet.recipient) : new Uint8Array(),
    route.length ? join(Uint8Array.of(route.length), ...route.map(id)) : new Uint8Array(),
    payload, packet.signature ?? new Uint8Array());
  return padding ? padPacket(output) : output;
}
export function signingBytes(packet: BitchatPacket): Uint8Array {
  return encodePacket({ ...packet, signature: undefined, ttl: 0, rsr: false }, true);
}
export function signPacket(packet: BitchatPacket, seed: Uint8Array): BitchatPacket {
  return { ...packet, signature: ed25519.sign(signingBytes(packet), seed) };
}
export function verifyPacket(packet: BitchatPacket, publicKey: Uint8Array): boolean {
  try { return !!packet.signature && ed25519.verify(packet.signature, signingBytes(packet), publicKey); }
  catch { return false; }
}
export async function decodePacket(data: Uint8Array, inflate?: InflateRaw): Promise<BitchatPacket> {
  if (data.length < 22 || data.length > BITCHAT_MAX_PACKET + 512 || (data[0] !== 1 && data[0] !== 2))
    throw new Error('Invalid Bitchat frame');
  const version = data[0] as 1 | 2;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const timestamp = Number(view.getBigUint64(3));
  const flags = data[11];
  if (!Number.isSafeInteger(timestamp) || flags & ~31 || (version === 1 && flags & 8) || data[2] > BITCHAT_TTL)
    throw new Error('Invalid Bitchat header');
  const length = version === 1 ? view.getUint16(12) : view.getUint32(12);
  let offset = version === 1 ? 14 : 16;
  const take = (size: number) => {
    if (offset + size > data.length) throw new Error('Truncated Bitchat frame');
    const value = data.slice(offset, offset + size); offset += size; return value;
  };
  const sender = bytesToHex(take(8));
  const recipient = flags & 1 ? bytesToHex(take(8)) : undefined;
  let route: string[] | undefined;
  if (flags & 8) {
    const count = take(1)[0];
    if (count > 10) throw new Error('Bitchat route too long');
    route = Array.from({ length: count }, () => bytesToHex(take(8)));
  }
  const cap = data[1] === BitchatType.fragment ? 1280 :
    (data[1] === BitchatType.announce || data[1] === BitchatType.handshake || data[1] === BitchatType.leave) ? 4096 : BITCHAT_MAX_PACKET;
  if (length > cap + 4) throw new Error('Bitchat payload too large');
  const wirePayload = take(length);
  let payload: Uint8Array = wirePayload;
  if (flags & 4) {
    const prefix = version === 1 ? 2 : 4;
    if (!inflate || length <= prefix) throw new Error('Invalid compressed Bitchat payload');
    const sizeView = new DataView(wirePayload.buffer, wirePayload.byteOffset, wirePayload.byteLength);
    const size = prefix === 2 ? sizeView.getUint16(0) : sizeView.getUint32(0);
    if (size > cap || size > (length - prefix) * 1032) throw new Error('Bitchat decompression limit');
    payload = await inflate(wirePayload.subarray(prefix), size);
    if (payload.length !== size) throw new Error('Invalid decompressed length');
  } else if (length > cap) throw new Error('Bitchat payload too large');
  const signature = flags & 2 ? take(64) : undefined;
  const remainder = data.subarray(offset);
  if (remainder.length && (remainder.length > 255 || !remainder.every((v) => v === remainder.length)))
    throw new Error('Invalid Bitchat padding');
  return { version, type: data[1], ttl: data[2], timestamp, sender, recipient, route, payload, signature,
    wirePayload: flags & 4 ? wirePayload : undefined, compressed: !!(flags & 4), rsr: !!(flags & 16) };
}
export function encodeTlv(fields: [number, Uint8Array][]): Uint8Array {
  return join(...fields.map(([type, value]) => {
    if (value.length > 255) throw new Error('Bitchat text must fit 255 UTF-8 bytes');
    return join(Uint8Array.of(type, value.length), value);
  }));
}
export function decodeTlv(payload: Uint8Array): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>();
  for (let offset = 0; offset < payload.length;) {
    if (offset + 2 > payload.length) throw new Error('Truncated Bitchat TLV');
    const type = payload[offset++], size = payload[offset++];
    if (offset + size > payload.length || fields.has(type)) throw new Error('Invalid Bitchat TLV');
    fields.set(type, payload.slice(offset, offset + size)); offset += size;
  }
  return fields;
}
export function packetId(packet: BitchatPacket): string {
  // TTL and relay flags are mutable; they must not make a forwarded packet new.
  return bytesToHex(sha256(encodePacket({ ...packet, ttl: 0, rsr: false })));
}
