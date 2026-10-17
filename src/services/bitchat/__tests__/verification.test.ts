/** @jest-environment node */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { verificationLink, verifyLink, verificationResponseBytes } from '../compatibility/verification';
import { bytes, join } from '../bitchat-wire';
const noise = new Uint8Array(32).fill(1), signing = new Uint8Array(32).fill(2), now = 1700000000;
it('signs the exact upstream one-byte-length field sequence, and accepts Unicode names', () => {
  const link = verificationLink(noise, signing, 'Alice 👋', undefined, now), qr = verifyLink(link, now);
  const fields = ['bitchat-verify-v1', '1', bytesToHex(x25519.getPublicKey(noise)), bytesToHex(ed25519.getPublicKey(signing)), '', 'Alice 👋', String(now), qr.nonceB64];
  const canonical = join(...fields.map(value => join(Uint8Array.of(bytes(value).length), bytes(value))));
  expect(qr.sigHex).toBe(bytesToHex(ed25519.sign(canonical, signing)));
  expect(qr.noiseKeyHex).toBe(bytesToHex(x25519.getPublicKey(noise)));
  expect(Buffer.from(verificationResponseBytes(qr.noiseKeyHex, new Uint8Array(16))).toString('hex')).toBe(
    Buffer.concat([Buffer.from('bitchat-verify-resp-v1'), Buffer.from([64]), Buffer.from(qr.noiseKeyHex), Buffer.alloc(16)]).toString('hex'));
});
it('rejects tampering, ambiguous fields, future/expired codes and wrong URI destinations', () => {
  const link = verificationLink(noise, signing, 'Alice', undefined, now);
  expect(() => verifyLink(link.replace('nick=Alice', 'nick=Mallory'), now)).toThrow();
  expect(() => verifyLink(link + '&noise=' + '00'.repeat(32), now)).toThrow();
  expect(() => verifyLink(link + '&npub=x&npub=y', now)).toThrow();
  expect(() => verifyLink(link, now + 301)).toThrow(); expect(() => verifyLink(link, now - 301)).toThrow();
  expect(() => verifyLink(link.replace('bitchat://verify?', 'bitchat://verify/path?'), now)).toThrow();
  expect(() => verifyLink(link.replace('bitchat:', 'https:'), now)).toThrow();
});
