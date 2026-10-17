/** @jest-environment node */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import vector from './fixtures/courier-test-vectors.json';
import { courierTag, decodeCourier, encodeCourier, sealCourier, openCourier, encodePrekeys, decodePrekeys, prekeySigningBytes } from '../compatibility/courier';
import { bytes, encodePacket, signPacket, signingBytes, verifyPacket, type BitchatPacket } from '../bitchat-wire';
it('matches upstream published courier tag, TLV bytes and packet signing preimage exactly', () => {
  const v = vector.inputs;
  const envelope = { tag: hexToBytes(v.recipientTag), expiry: v.expiryMillis, ciphertext: hexToBytes(v.ciphertext), copies: vector.envelopeTLV.copies, prekeyId: vector.envelopeTLV.prekeyID };
  expect(bytesToHex(encodeCourier(envelope))).toBe(vector.envelopeTLV.encoded);
  expect(decodeCourier(hexToBytes(vector.envelopeTLV.encoded))).toEqual(envelope);
  expect(bytesToHex(courierTag(hexToBytes(v.noiseStaticKey), v.epochDay))).toBe(vector.recipientTagDerivation.expected);
  const packet: BitchatPacket = { version: 1, type: 4, ttl: 7, timestamp: v.timestampMillis, sender: v.senderID, recipient: v.recipientID, payload: encodeCourier(envelope) };
  expect(bytesToHex(encodePacket(packet))).toBe(vector.packetSigning.unsignedUnpadded);
  expect(bytesToHex(signingBytes(packet))).toBe(vector.packetSigning.signingPreimage);
  expect(verifyPacket(signPacket(packet, hexToBytes(v.signingSeed)), hexToBytes(vector.signature.publicKey))).toBe(true);
  for (const c of vector.copiesClamping.cases) expect(decodeCourier(encodeCourier({ ...envelope, copies: c.requested })).copies).toBe(c.stored);
});
it('authenticates Noise X sender and payload, and separates static from prekey transcripts', () => {
  const sender = new Uint8Array(32).fill(1), recipient = new Uint8Array(32).fill(2), ephemeral = new Uint8Array(32).fill(3);
  const packet = sealCourier(bytes('sealed offline mail'), sender, x25519.getPublicKey(recipient), undefined, ephemeral);
  expect(openCourier(packet, recipient)).toEqual({ sender: x25519.getPublicKey(sender), payload: bytes('sealed offline mail') });
  expect(() => openCourier(packet, recipient, 17)).toThrow();
  const prekeyPacket = sealCourier(bytes('prekey mail'), sender, x25519.getPublicKey(recipient), 17, ephemeral);
  expect(openCourier(prekeyPacket, recipient, 17).payload).toEqual(bytes('prekey mail'));
  expect(() => openCourier(prekeyPacket, recipient, 18)).toThrow();
  const changed = packet.slice(); changed[changed.length - 1] ^= 1;
  expect(() => openCourier(changed, recipient)).toThrow();
  expect(() => openCourier(packet, new Uint8Array(32).fill(4))).toThrow();
});
it('validates signed prekey bundles and rejects duplicate IDs and forged signatures', () => {
  const seed = new Uint8Array(32).fill(9), owner = x25519.getPublicKey(seed);
  const content = { owner, prekeys: [{ id: 7, publicKey: x25519.getPublicKey(new Uint8Array(32).fill(8)) }], generatedAt: 123456 };
  const bundle = { ...content, signature: ed25519.sign(prekeySigningBytes(content), seed) };
  expect(decodePrekeys(encodePrekeys(bundle), ed25519.getPublicKey(seed))).toEqual(bundle);
  expect(() => prekeySigningBytes({ ...content, prekeys: [content.prekeys[0], content.prekeys[0]] })).toThrow();
  const changed = encodePrekeys(bundle); changed[changed.length - 1] ^= 1;
  expect(() => decodePrekeys(changed, ed25519.getPublicKey(seed))).toThrow();
});
