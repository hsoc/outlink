/** @jest-environment node */
import * as crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { decodeGroupState, encodeGroupState, groupMessageSigningBytes, groupStateSigningBytes, openGroupMessage, rosterBytes, sealGroupMessage, type GroupState } from '../compatibility/group-protocol';
import { fields16, required, tlv16 } from '../compatibility/binary';
const seed = new Uint8Array(32).fill(1), signer = bytesToHex(ed25519.getPublicKey(seed));
const state: GroupState = { id: '11'.repeat(16), key: '22'.repeat(32), name: 'Hikers', epoch: 1, creator: '33'.repeat(32),
  members: [{ fingerprint: '33'.repeat(32), signingKey: signer, nickname: 'Alice' }] };
it('round-trips creator state, signs its name, and ignores unknown TLVs', () => {
  const data = encodeGroupState(state, seed);
  expect(decodeGroupState(data)).toEqual(state);
  expect(decodeGroupState(new Uint8Array([...data, 99, 0, 1, 7]))).toEqual(state);
  const fields = fields16(data); fields.set(2, new TextEncoder().encode('Forged'));
  expect(() => decodeGroupState(tlv16([...fields]))).toThrow('signature');
  fields.set(1, new Uint8Array(16).fill(7)); expect(() => decodeGroupState(tlv16([...fields]))).toThrow();
});
it('accepts more than 16 members up to the one-byte wire count, rejects overflow and ambiguous identities', () => {
  const members = Array.from({ length: 255 }, (_, i) => ({ fingerprint: i.toString(16).padStart(64, '0'), signingKey: bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(i))), nickname: `Member${i}` }));
  const larger = { ...state, creator: members[1].fingerprint, members };
  expect(decodeGroupState(encodeGroupState(larger, seed)).members).toHaveLength(255);
  expect(() => rosterBytes([...members, state.members[0]])).toThrow();
  expect(() => rosterBytes([state.members[0], state.members[0]])).toThrow();
});
it('binds group, epoch, author and ciphertext and uses creator-authenticated display names', () => {
  const data = sealGroupMessage(state, seed, 'Unsigned display label', 'secret', 'message1', Date.now());
  expect(openGroupMessage(state, data)).toMatchObject({ id: 'message1', content: 'secret', member: { nickname: 'Alice' } });
  expect(() => openGroupMessage({ ...state, epoch: 2 }, data)).toThrow();
  expect(() => openGroupMessage({ ...state, key: '55'.repeat(32) }, data)).toThrow();
  expect(() => openGroupMessage({ ...state, id: '66'.repeat(16) }, data)).toThrow();
  const fields = fields16(data), ciphertext = required(fields, 4).slice(); ciphertext[0] ^= 1; fields.set(4, ciphertext);
  expect(() => openGroupMessage(state, tlv16([...fields]))).toThrow();
  expect(() => openGroupMessage({ ...state, members: [{ ...state.members[0], signingKey: '00'.repeat(32) }] }, data)).toThrow();
});
it('rejects duplicate fields, malformed rosters and unrepresentable text', () => {
  const data = encodeGroupState(state, seed);
  expect(() => decodeGroupState(new Uint8Array([...data, 1, 0, 16, ...new Uint8Array(16)]))).toThrow();
  expect(() => encodeGroupState({ ...state, members: [{ ...state.members[0], nickname: '😀'.repeat(17) }] }, seed)).toThrow();
  expect(() => sealGroupMessage(state, seed, 'Alice', 'x'.repeat(65001), 'id', Date.now())).toThrow();
  expect(() => decodeGroupState(data.subarray(0, -1))).toThrow();
});
it('matches independently generated pinned-protocol signing bytes', () => {
  // Domains, BE integers and SHA-256 bindings from GroupProtocol.swift at 5e9287f.
  const digest = (data: Uint8Array) => crypto.createHash('sha256').update(data).digest();
  const epoch = Buffer.alloc(4); epoch.writeUInt32BE(1);
  const expected = Buffer.concat([Buffer.from('bitchat-group-v1'), Buffer.from(state.id, 'hex'), epoch,
    digest(Buffer.from(state.key, 'hex')), digest(rosterBytes(state.members)), digest(Buffer.from('Hikers'))]);
  expect(Buffer.from(groupStateSigningBytes(state))).toEqual(expected);
  const stamp = Buffer.alloc(8); stamp.writeBigUInt64BE(123456789n);
  expect(Buffer.from(groupMessageSigningBytes(state.id, 1, 'id', 123456789, 'hello'))).toEqual(Buffer.concat([
    Buffer.from('bitchat-group-msg-v1'), Buffer.from(state.id, 'hex'), epoch, Buffer.from('id'), stamp, Buffer.from('hello')]));
});

it('opens an independent OpenSSL ChaCha20-Poly1305 / Ed25519 protocol envelope', () => {
  // Independently construct wire bytes without the application's TLV/sign/encrypt helpers.
  const pack = (entries: [number, Buffer][]) => Buffer.concat(entries.map(([kind, value]) => {
    const header = Buffer.alloc(3); header[0] = kind; header.writeUInt16BE(value.length, 1); return Buffer.concat([header, value]);
  }));
  const rawSeed = Buffer.from(seed), key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), rawSeed]), format: 'der', type: 'pkcs8' });
  const id = Buffer.from(state.id, 'hex'), epoch = Buffer.from([0, 0, 0, 1]), nonce = Buffer.alloc(12, 7), timestamp = Buffer.alloc(8); timestamp.writeBigUInt64BE(1700000000123n);
  const messageId = Buffer.from('independent-vector'), content = Buffer.from('interoperable group text');
  const signature = crypto.sign(null, Buffer.concat([Buffer.from('bitchat-group-msg-v1'), id, epoch, messageId, timestamp, content]), key);
  const inner = pack([[1, messageId], [2, Buffer.from(signer, 'hex')], [3, Buffer.from('Alice')], [4, timestamp], [5, content], [6, signature]]);
  const cipher = crypto.createCipheriv('chacha20-poly1305', Buffer.from(state.key, 'hex'), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([id, epoch]), { plaintextLength: inner.length });
  const ciphertext = Buffer.concat([cipher.update(inner), cipher.final(), cipher.getAuthTag()]);
  const payload = pack([[1, id], [2, epoch], [3, nonce], [4, ciphertext]]);
  expect(openGroupMessage(state, payload)).toMatchObject({ id: 'independent-vector', timestamp: 1700000000123, content: 'interoperable group text' });
  const bad = Buffer.from(payload); bad[25] ^= 1; expect(() => openGroupMessage(state, bad)).toThrow();
});
