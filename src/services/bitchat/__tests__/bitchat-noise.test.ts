/** @jest-environment node */
import vector from './noise-c-vector.json';
import { bytesToHex } from '@noble/hashes/utils.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { BitchatHandshake } from '../bitchat-noise';
import { bytes, text } from '../bitchat-wire';
const a = new Uint8Array(32).fill(1), b = new Uint8Array(32).fill(2);
function establish() {
  const alice = new BitchatHandshake(true, a, new Uint8Array(32).fill(3));
  const bob = new BitchatHandshake(false, b, new Uint8Array(32).fill(4));
  const one = alice.write(); expect(bytesToHex(one)).toBe(vector.messageA); expect(one.length).toBe(32); bob.read(one);
  const two = bob.write(); expect(bytesToHex(two)).toBe(vector.messageB); expect(two.length).toBe(96); alice.read(two);
  const three = alice.write(); expect(bytesToHex(three)).toBe(vector.messageC); expect(three.length).toBe(64); bob.read(three);
  return { alice: alice.finish(x25519.getPublicKey(b)), bob: bob.finish(x25519.getPublicKey(a)) };
}
it('uses standard XX without the Outlink prologue and exchanges Bitchat counter-prefixed ciphertext', () => {
  const { alice, bob } = establish();
  const first = alice.seal(bytes('private'));
  expect(bytesToHex(first.subarray(4))).toBe(vector.ciphertext0);
  expect([...first.slice(0, 4)]).toEqual([0, 0, 0, 0]);
  expect(text(bob.open(first))).toBe('private');
  const second = alice.seal(bytes('second'));
  expect([...second.slice(0, 4)]).toEqual([0, 0, 0, 1]);
  expect(text(bob.open(second))).toBe('second');
  expect(text(alice.open(bob.seal(bytes('reply'))))).toBe('reply');
  alice.destroy(); bob.destroy();
});
it('supports out-of-order delivery, rejects replays, and preserves nonce state after forged ciphertext', () => {
  const { alice, bob } = establish();
  const first = alice.seal(bytes('first')), second = alice.seal(bytes('second'));
  expect(text(bob.open(second))).toBe('second');
  const forged = first.slice(); forged[forged.length - 1] ^= 1;
  expect(() => bob.open(forged)).toThrow();
  expect(text(bob.open(first))).toBe('first');
  expect(() => bob.open(first)).toThrow('Replayed');
  alice.destroy(); expect(() => alice.seal(bytes('closed'))).toThrow(); bob.destroy();
});
it('binds the session to the discovered full Noise key', () => {
  const alice = new BitchatHandshake(true, a), bob = new BitchatHandshake(false, b);
  bob.read(alice.write()); alice.read(bob.write()); bob.read(alice.write());
  expect(() => alice.finish(x25519.getPublicKey(new Uint8Array(32).fill(9)))).toThrow('identity mismatch');
  alice.destroy(); bob.destroy();
});
