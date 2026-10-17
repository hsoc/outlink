/** @jest-environment node */
import { localCipher } from '../local-cipher';
const key = '01'.repeat(32);
it('uses fresh nonces and authenticates both ciphertext and context', () => {
  const cipher = localCipher(key);
  const first = cipher.seal('private message 💬', 'room:a'), second = cipher.seal('private message 💬', 'room:a');
  expect(first).not.toEqual(second); expect(first).not.toContain('private message');
  expect(cipher.open(first, 'room:a')).toBe('private message 💬');
  expect(() => cipher.open(first, 'room:b')).toThrow();
  const position = first.length - 8;
  expect(() => cipher.open(first.slice(0, position) + (first[position] === 'A' ? 'B' : 'A') + first.slice(position + 1), 'room:a')).toThrow();
  expect(() => localCipher('02'.repeat(32)).open(first, 'room:a')).toThrow();
});
it('keeps index keys separate and rejects plaintext, truncated and unknown versions', () => {
  const cipher = localCipher(key);
  expect(cipher.index('room:abc')).toEqual(localCipher(key).index('room:abc'));
  expect(cipher.index('room:abc')).not.toEqual(cipher.index('id:abc'));
  for (const value of ['plaintext', 'outlink:v1:AA==', 'outlink:v2:AAAA']) expect(() => cipher.open(value, 'x')).toThrow();
  expect(() => localCipher('invalid')).toThrow();
});
