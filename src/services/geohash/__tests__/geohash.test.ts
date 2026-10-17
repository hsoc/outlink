/** @jest-environment node */
import { encodeGeohash, geohashBounds, normalizeGeohash } from '../geohash';
import { channelKey, createGeohashEvent, normalizeGeoRelays, validateGeohashEvent } from '../geohash-protocol';
import { getPublicKey } from 'nostr-tools/pure';
const key = new Uint8Array(32).fill(1), now = 1_800_000_000;
it('matches standard geohash vectors and round-trips region bounds', () => {
  expect(encodeGeohash(42.6, -5.6, 5)).toBe('ezs42');
  expect(encodeGeohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
  const b = geohashBounds('ezs42');
  expect(b.south).toBeLessThanOrEqual(42.6); expect(b.north).toBeGreaterThan(42.6);
  expect(b.west).toBeLessThanOrEqual(-5.6); expect(b.east).toBeGreaterThan(-5.6);
  expect(normalizeGeohash(' #EZS42 ')).toBe('ezs42');
  for (const input of ['', 'abc!', 'i', 'a'.repeat(13)]) expect(() => normalizeGeohash(input)).toThrow();
  expect(() => encodeGeohash(NaN, 0)).toThrow(); expect(() => encodeGeohash(91, 0)).toThrow();
});
it('uses distinct deterministic per-channel keys and standard Bitchat public event tags', () => {
  const a = channelKey(key, 'ezs42'), b = channelKey(key, 'u4pru');
  expect(a).toEqual(channelKey(key, 'ezs42')); expect(getPublicKey(a)).not.toBe(getPublicKey(b));
  const event = createGeohashEvent(a, 'ezs42', 'Alice', 'hello', false, now);
  expect(event.kind).toBe(20000); expect(event.tags).toContainEqual(['g', 'ezs42']);
  expect(event.tags).toContainEqual(['n', 'Alice']); expect(validateGeohashEvent(event, 'ezs42', now)).toEqual(event);
  expect(createGeohashEvent(a, 'ezs42', 'Alice', 'hello', false, now).id).not.toBe(event.id);
  const presence = createGeohashEvent(a, 'ezs42', 'Alice', '', true, now);
  expect(presence.kind).toBe(20001); expect(presence.tags).toEqual([['g', 'ezs42']]);
  expect(validateGeohashEvent(presence, 'ezs42', now)).not.toBeNull();
});
it('rejects wrong channels, tampering, expiry, malformed bounds, and oversized content', () => {
  const event = createGeohashEvent(key, 'ezs42', 'Alice', 'hello', false, now);
  expect(validateGeohashEvent(event, 'ezs4', now)).toBeNull();
  expect(validateGeohashEvent({ ...event, content: 'forged' }, 'ezs42', now)).toBeNull();
  expect(validateGeohashEvent(event, 'ezs42', now + 901)).toBeNull();
  expect(validateGeohashEvent(event, 'ezs42', now - 61)).toBeNull();
  expect(validateGeohashEvent({ ...event, tags: [...event.tags, ['g','ezs42']] }, 'ezs42', now)).toBeNull();
  expect(() => createGeohashEvent(key, 'ezs42', 'Alice', '💬'.repeat(1025))).toThrow();
  expect(normalizeGeoRelays(['wss://example.org', 'wss://example.org/'])).toEqual(['wss://example.org/']);
  for (const relay of ['ws://example.org','https://example.org','wss://user:pass@example.org']) expect(() => normalizeGeoRelays([relay])).toThrow();
});
it('rejects signed malformed presence and expired messages without trusting relay labels', () => {
  const { finalizeEvent } = jest.requireActual('nostr-tools/pure');
  const expired = finalizeEvent({kind:20000,created_at:now,tags:[['g','ezs42'],['expiration',String(now-1)]],content:'old'},key);
  expect(validateGeohashEvent(expired,'ezs42',now)).toBeNull();
  const presence = finalizeEvent({kind:20001,created_at:now,tags:[['g','ezs42'],['n','Bob']],content:''},key);
  expect(validateGeohashEvent(presence,'ezs42',now)).toBeNull();
});
