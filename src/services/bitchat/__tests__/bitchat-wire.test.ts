/** @jest-environment node */
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { BitchatFragments, fragmentPacket } from '../bitchat-fragments';
import { BitchatType, bytes, decodePacket, decodeTlv, encodePacket, encodeTlv,
  signPacket, verifyPacket, type BitchatPacket } from '../bitchat-wire';
const seed = new Uint8Array(32).fill(9);
const publicKey = ed25519.getPublicKey(seed);
const packet: BitchatPacket = { version: 1, type: BitchatType.message, ttl: 7,
  timestamp: 1000, sender: '0102030405060708', payload: bytes('hi') };
const inflate = async (data: Uint8Array, size: number) => Uint8Array.from(inflateRawSync(data, { maxOutputLength: size }));

it('matches the documented v1 network-order byte layout independently of round trips', async () => {
  const expected = '01020700000000000003e800000201020304050607086869';
  expect(bytesToHex(encodePacket(packet))).toBe(expected);
  expect(await decodePacket(hexToBytes(expected))).toMatchObject(packet);
});
it('preserves v2 route and recipient fields', async () => {
  const value = { ...packet, version: 2 as const, recipient: '1111111111111111', route: ['2222222222222222'] };
  expect(await decodePacket(encodePacket(value))).toMatchObject(value);
});
it('authenticates content and sender while allowing TTL decrement', async () => {
  const signed = signPacket(packet, seed);
  expect(verifyPacket(await decodePacket(encodePacket({ ...signed, ttl: 3 })), publicKey)).toBe(true);
  expect(verifyPacket({ ...signed, payload: bytes('changed') }, publicKey)).toBe(false);
  expect(verifyPacket({ ...signed, sender: '9999999999999999' }, publicKey)).toBe(false);
  expect(verifyPacket({ ...signed, timestamp: 1001 }, publicKey)).toBe(false);
});
it('reads bounded raw DEFLATE and retains bytes needed to authenticate compressed packets', async () => {
  const payload = bytes('message '.repeat(80)), compressed = deflateRawSync(payload);
  const prefix = new Uint8Array(2); new DataView(prefix.buffer).setUint16(0, payload.length);
  const value = signPacket({ ...packet, payload, compressed: true,
    wirePayload: Uint8Array.from([...prefix, ...compressed]) }, seed);
  const decoded = await decodePacket(encodePacket(value), inflate);
  expect(decoded.payload).toEqual(payload);
  expect(verifyPacket(decoded, publicKey)).toBe(true);
  expect(encodePacket(decoded)).toEqual(encodePacket(value));
});
it('rejects a declared decompression bomb before invoking the decompressor', async () => {
  const decode = jest.fn(inflate);
  const value = encodePacket({ ...packet, version: 2, type: BitchatType.announce, compressed: true,
    wirePayload: Uint8Array.of(0, 2, 0, 0, 1) });
  await expect(decodePacket(value, decode)).rejects.toThrow('decompression limit');
  expect(decode).not.toHaveBeenCalled();
});
it.each([0, 1, 21])('rejects truncated headers of %i bytes', async (size) => {
  await expect(decodePacket(encodePacket(packet).slice(0, size))).rejects.toThrow();
});
it('rejects bad versions, unknown flags, inconsistent lengths, padding and unsafe timestamps', async () => {
  for (const [offset, value] of [[0, 3], [2, 8], [11, 128], [13, 255], [3, 255]]) {
    const wire = encodePacket(packet); wire[offset] = value;
    await expect(decodePacket(wire)).rejects.toThrow();
  }
  await expect(decodePacket(Uint8Array.from([...encodePacket(packet), 1, 2]))).rejects.toThrow('padding');
});
it('decodes arbitrary TLV order, skips future tags, and rejects duplicates and invalid UTF-8', () => {
  const data = encodeTlv([[2, Uint8Array.of(2)], [99, bytes('future')], [1, bytes('name')]]);
  expect(decodeTlv(data).get(1)).toEqual(bytes('name'));
  expect(() => decodeTlv(Uint8Array.of(1, 0, 1, 0))).toThrow();
  expect(() => decodeTlv(Uint8Array.of(1, 4, 1))).toThrow();
});
it('reassembles reordered and duplicate link-sized shards and authenticates the complete packet', async () => {
  const signed = signPacket({ ...packet, payload: bytes('long message '.repeat(50)) }, seed);
  const shards = fragmentPacket(signed, 185, new Uint8Array(8).fill(1));
  expect(shards.every((shard) => shard.length <= 185)).toBe(true);
  const assembly = new BitchatFragments();
  const last = await decodePacket(shards.at(-1)!);
  expect(await assembly.accept(last, 1000)).toBeNull();
  expect(await assembly.accept(last, 1000)).toBeNull();
  let result: BitchatPacket | null = null;
  for (const shard of shards.slice(0, -1)) result = await assembly.accept(await decodePacket(shard), 1000);
  expect(result?.payload).toEqual(signed.payload);
  expect(verifyPacket(result!, publicKey)).toBe(true);
});
it('rejects fragment sender substitution and conflicting fragment bytes', async () => {
  const shards = fragmentPacket(signPacket(packet, seed), 64, new Uint8Array(8).fill(2));
  const assembly = new BitchatFragments();
  const first = await decodePacket(shards[0]);
  await assembly.accept(first, 0);
  const changed = first.payload.slice(); changed[13] ^= 1;
  await expect(assembly.accept({ ...first, payload: changed }, 0)).rejects.toThrow('Conflicting');
  const forged = new BitchatFragments();
  let promise: Promise<unknown> = Promise.resolve();
  for (const shard of shards.slice(0, -1)) await forged.accept({ ...await decodePacket(shard), sender: '9999999999999999' }, 0);
  promise = forged.accept({ ...await decodePacket(shards.at(-1)!), sender: '9999999999999999' }, 0);
  await expect(promise).rejects.toThrow('identity mismatch');
});
