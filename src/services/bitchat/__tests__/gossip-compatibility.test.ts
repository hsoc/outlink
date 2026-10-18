/** @jest-environment node */
import { createHash } from 'node:crypto';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { buildFilter, decodeFilter, bucket, GossipCache, gossipId, encodeSync, decodeSync } from '../compatibility/gossip';
import { bytes, type BitchatPacket } from '../bitchat-wire';
const packet = (timestamp: number, content = 'hello'): BitchatPacket => ({ version: 1, type: 2, ttl: 7, timestamp, sender: '0102030405060708', payload: bytes(content) });
it('matches the documented MSB-first Golomb-Rice bitstream and canonical packet ID', () => {
  expect(decodeFilter(3, 100, hexToBytes('0180'))).toEqual([1, 3, 12]);
  const value = packet(123456), timestamp = Buffer.alloc(8); timestamp.writeBigUInt64BE(123456n);
  const independent = createHash('sha256').update(Buffer.concat([Buffer.from([2]), Buffer.from(value.sender, 'hex'), timestamp, Buffer.from('hello')])).digest().subarray(0, 16);
  expect(bytesToHex(gossipId(value))).toBe(independent.toString('hex'));
});
it('keeps the complete newest input prefix inside a bounded filter without false negatives', () => {
  const ids = Array.from({ length: 1000 }, (_, i) => gossipId(packet(i)));
  const filter = buildFilter(ids, 64);
  expect(filter.data.length).toBeLessThanOrEqual(64);
  expect(filter.included).toBeLessThan(ids.length);
  const values = new Set(decodeFilter(filter.p, filter.m, filter.data));
  for (const id of ids.slice(0, filter.included)) expect(values.has(bucket(id, filter.m))).toBe(true);
});
it('round trips sync flags/cursors and rejects invalid or oversized filters', () => {
  const request = { p: 7, m: 1024, data: hexToBytes('0180'), types: 0x703, since: 123456, fragmentIds: ['0123456789abcdef'] };
  expect(decodeSync(encodeSync(request))).toEqual(request);
  expect(() => decodeSync(encodeSync({ ...request, p: 33 }))).toThrow();
  expect(() => decodeSync(encodeSync({ ...request, data: new Uint8Array(1025) }))).toThrow();
  expect(decodeFilter(33, 10, new Uint8Array(4))).toEqual([]);
});
it('serves only missing public packets and expires history without persisting private traffic', () => {
  const changes = jest.fn(), cache = new GossipCache(changes), now = Date.now();
  cache.add(packet(now - 10)); cache.add(packet(now - 20, 'older'));
  cache.add({ ...packet(now), type: 17, recipient: '1111111111111111' });
  expect(cache.entries(now)).toHaveLength(2);
  const request = decodeSync(cache.request(now));
  expect(cache.missing(request, now)).toHaveLength(0);
  expect(cache.missing({ p: 7, m: 1, data: new Uint8Array(), types: 3 }, now)).toHaveLength(2);
  expect(cache.entries(now + 21600001)).toHaveLength(0);
  expect(changes).toHaveBeenCalledTimes(4);
});

it('does not advertise an announcement-only time cursor that would exclude all earlier public history', () => {
  const cache = new GossipCache(), now = Date.now();
  cache.add({ version: 2, type: 1, ttl: 7, timestamp: now, sender: '01'.repeat(8), payload: new Uint8Array([1]) });
  expect(decodeSync(cache.request(now)).since).toBeUndefined();
});

it('keeps the newest signed generation per prekey owner and caps the prekey gossip cache', () => {
  const cache = new GossipCache(), now = Date.now();
  const payload = (generated: number) => { const body = new Uint8Array(11); body.set([3, 0, 8]); new DataView(body.buffer).setBigUint64(3, BigInt(generated)); return body; };
  for (let i = 0; i < 205; ++i) cache.add({ version: 1, type: 36, ttl: 7, timestamp: now, sender: i.toString(16).padStart(16, '0'), payload: payload(now) });
  expect(cache.entries(now)).toHaveLength(200);
  const latest = { version: 1 as const, type: 36, ttl: 7, timestamp: now, sender: '00'.repeat(8), payload: payload(now + 1) };
  cache.add(latest); cache.add({ ...latest, timestamp: now + 10, payload: payload(now) });
  expect(cache.entries(now).find(packet => packet.sender === latest.sender)?.payload).toEqual(latest.payload);
});
