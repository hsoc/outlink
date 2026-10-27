/** @jest-environment node */
import { base64urlnopad } from '@scure/base';
import { Amount, getEncodedToken } from '@cashu/cashu-ts';
import { digest, inspectToken, parsePart, tokenParts } from '../token';
import { proof, encoded } from '../test-support/token';
it('inspects a standard JSON token without network verification and normalizes URI/padding', () => {
  expect(inspectToken('cashu:' + encoded() + '=')).toMatchObject({ amount: '2', mint: 'https://mint.example', id: digest(encoded()) });
});
it('supports standard compact CBOR tokens and preserves the original export bytes', () => {
  const wire = getEncodedToken({ mint: 'https://mint.example', unit: 'sat', proofs: [{ ...proof, amount: Amount.from(2) }] });
  expect(wire.startsWith('cashuB')).toBe(true);
  expect(inspectToken(wire)).toMatchObject({ wire, amount: '2' });
});
it('bounds token sizes, validates signatures as points, and rejects unsupported or duplicate proofs', () => {
  for (const input of ['cashuA' + 'a'.repeat(8192), encoded([proof, proof]), encoded([{ ...proof, amount: -1 }]), encoded([{ ...proof, C: '02' + 'ff'.repeat(32) }]), encoded([proof], 'http://mint.example'), encoded([proof], 'https://user:password@mint.example'), encoded([proof], 'https://mint.example', 'usd')]) expect(() => inspectToken(input)).toThrow();
});
it('rejects multi-mint envelopes instead of silently sending only the first mint', () => {
  const wire = 'cashuA' + base64urlnopad.encode(new TextEncoder().encode(JSON.stringify({ token: [{ mint: 'https://one.example', proofs: [proof] }, { mint: 'https://two.example', proofs: [proof] }] })));
  expect(() => inspectToken(wire)).toThrow();
});
it('frames tokens under the existing Bluetooth DM byte limit and rejects invalid bounds', () => {
  const wire = encoded(), frames = tokenParts(wire);
  expect(frames.length).toBeGreaterThan(1);
  expect(frames.every(frame => new TextEncoder().encode(frame).length <= 255)).toBe(true);
  expect(frames.map(frame => parsePart(frame).data).join('')).toBe(wire);
  for (const frame of [`OLC1:${digest(wire)}:0:99:a`, `OLC1:${digest(wire)}:1:1:a`, `OLC1:${digest(wire)}:0:2:a`]) expect(() => parsePart(frame)).toThrow();
});
