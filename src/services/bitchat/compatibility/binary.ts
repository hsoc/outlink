import { bytes, join } from '../bitchat-wire';
export function unsigned(value: number | bigint, size: 2 | 4 | 8): Uint8Array {
  const n = BigInt(value);
  if (n < 0n || n >= 1n << BigInt(size * 8)) throw new Error('Integer outside wire range');
  const data = new Uint8Array(size), view = new DataView(data.buffer);
  if (size === 8) view.setBigUint64(0, n); else if (size === 4) view.setUint32(0, Number(n)); else view.setUint16(0, Number(n));
  return data;
}
export function number(value: Uint8Array, size: 2 | 4 | 8): number {
  if (value.length !== size) throw new Error('Invalid integer length');
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const n = size === 8 ? Number(view.getBigUint64(0)) : size === 4 ? view.getUint32(0) : view.getUint16(0);
  if (!Number.isSafeInteger(n)) throw new Error('Unsafe wire integer');
  return n;
}
export function tlv16(fields: [number, Uint8Array][]): Uint8Array {
  return join(...fields.map(([type, value]) => {
    if (!Number.isInteger(type) || type < 0 || type > 255 || value.length > 65535) throw new Error('Invalid TLV field');
    return join(Uint8Array.of(type), unsigned(value.length, 2), value);
  }));
}
export function fields16(data: Uint8Array, limit = 1024 * 1024 + 131200): Map<number, Uint8Array> {
  if (data.length > limit) throw new Error('Payload exceeds limit');
  const fields = new Map<number, Uint8Array>();
  for (let offset = 0; offset < data.length;) {
    if (offset + 3 > data.length) throw new Error('Truncated TLV');
    const type = data[offset], length = number(data.subarray(offset + 1, offset + 3), 2); offset += 3;
    if (offset + length > data.length || fields.has(type)) throw new Error('Invalid or duplicate TLV');
    fields.set(type, data.slice(offset, offset + length)); offset += length;
  }
  return fields;
}
export function required(fields: Map<number, Uint8Array>, type: number, size?: number): Uint8Array {
  const value = fields.get(type);
  if (!value || (size !== undefined && value.length !== size)) throw new Error('Missing or invalid field');
  return value;
}
export function label(value: string): Uint8Array {
  const data = bytes(value); if (data.length > 255) throw new Error('Label exceeds wire range');
  return join(Uint8Array.of(data.length), data);
}
