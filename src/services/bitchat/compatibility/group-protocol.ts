import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { bytes, join, text } from '../bitchat-wire';
import { fields16, number, required, tlv16, unsigned } from './binary';
export type GroupMember = { fingerprint: string; signingKey: string; nickname: string };
export type GroupState = { id: string; name: string; key: string; epoch: number; members: GroupMember[]; creator: string };
const hex = (value: string, size: number) => {
  if (!new RegExp(`^[0-9a-f]{${size * 2}}$`).test(value)) throw new Error('Invalid group identity');
  return hexToBytes(value);
};
export function rosterBytes(members: GroupMember[]): Uint8Array {
  // One byte is the protocol's count field, not a product membership policy.
  if (!members.length || members.length > 255 || new Set(members.map(m => m.fingerprint)).size !== members.length ||
      new Set(members.map(m => m.signingKey)).size !== members.length) throw new Error('Invalid group roster');
  return join(Uint8Array.of(members.length), ...members.map(m => {
    const name = bytes(m.nickname); if (name.length > 64) throw new Error('Invalid member nickname');
    return join(hex(m.fingerprint, 32), hex(m.signingKey, 32), Uint8Array.of(name.length), name);
  }));
}
function decodeRoster(data: Uint8Array): GroupMember[] {
  const members: GroupMember[] = []; let offset = 1;
  for (let i = 0; i < data[0]; i++) {
    if (offset + 65 > data.length) throw new Error('Truncated group roster');
    const fingerprint = bytesToHex(data.subarray(offset, offset + 32)), signingKey = bytesToHex(data.subarray(offset + 32, offset + 64));
    const length = data[offset + 64]; offset += 65;
    if (length > 64 || offset + length > data.length) throw new Error('Invalid roster nickname');
    members.push({ fingerprint, signingKey, nickname: text(data.subarray(offset, offset + length)) }); offset += length;
  }
  if (offset !== data.length) throw new Error('Invalid roster framing');
  rosterBytes(members); return members;
}
export function validateGroup(state: GroupState): void {
  hex(state.id, 16); hex(state.key, 32); hex(state.creator, 32);
  if (!state.name.trim() || bytes(state.name).length > 64 || !Number.isInteger(state.epoch) || state.epoch < 0 || state.epoch > 0xffffffff ||
      !state.members.some(m => m.fingerprint === state.creator)) throw new Error('Invalid group state');
  rosterBytes(state.members);
}
export function groupStateSigningBytes(state: GroupState): Uint8Array {
  validateGroup(state);
  return join(bytes('bitchat-group-v1'), hex(state.id, 16), unsigned(state.epoch, 4), sha256(hex(state.key, 32)), sha256(rosterBytes(state.members)), sha256(bytes(state.name)));
}
export function encodeGroupState(state: GroupState, signingSeed: Uint8Array): Uint8Array {
  const signature = ed25519.sign(groupStateSigningBytes(state), signingSeed);
  return tlv16([[1, hex(state.id, 16)], [2, bytes(state.name)], [3, hex(state.key, 32)], [4, unsigned(state.epoch, 4)],
    [5, rosterBytes(state.members)], [6, hex(state.creator, 32)], [7, signature]]);
}
export function decodeGroupState(data: Uint8Array): GroupState {
  const f = fields16(data, 65535), state: GroupState = { id: bytesToHex(required(f, 1, 16)), name: text(required(f, 2)),
    key: bytesToHex(required(f, 3, 32)), epoch: number(required(f, 4), 4), members: decodeRoster(required(f, 5)), creator: bytesToHex(required(f, 6, 32)) };
  const signed = groupStateSigningBytes(state), creator = state.members.find(m => m.fingerprint === state.creator)!;
  if (!ed25519.verify(required(f, 7, 64), signed, hex(creator.signingKey, 32))) throw new Error('Invalid group creator signature');
  return state;
}
export function groupMessageSigningBytes(id: string, epoch: number, messageId: string, timestamp: number, content: string) {
  return join(bytes('bitchat-group-msg-v1'), hex(id, 16), unsigned(epoch, 4), bytes(messageId), unsigned(timestamp, 8), bytes(content));
}
export function groupEnvelope(data: Uint8Array) {
  const f = fields16(data, 65535);
  return { id: bytesToHex(required(f, 1, 16)), epoch: number(required(f, 2), 4), nonce: required(f, 3, 12), ciphertext: required(f, 4) };
}
export function sealGroupMessage(state: GroupState, seed: Uint8Array, name: string, content: string, messageId: string, timestamp: number): Uint8Array {
  validateGroup(state);
  if (!content.trim() || bytes(content).length > 65000 || !messageId || bytes(messageId).length > 255 || bytes(name).length > 64) throw new Error('Invalid group message');
  const signing = ed25519.getPublicKey(seed);
  if (!state.members.some(m => m.signingKey === bytesToHex(signing))) throw new Error('Not a group member');
  const inner = tlv16([[1, bytes(messageId)], [2, signing], [3, bytes(name)], [4, unsigned(timestamp, 8)], [5, bytes(content)],
    [6, ed25519.sign(groupMessageSigningBytes(state.id, state.epoch, messageId, timestamp, content), seed)]]);
  const key = hex(state.key, 32), nonce = randomBytes(12);
  try {
    const ciphertext = chacha20poly1305(key, nonce, join(hex(state.id, 16), unsigned(state.epoch, 4))).encrypt(inner);
    return tlv16([[1, hex(state.id, 16)], [2, unsigned(state.epoch, 4)], [3, nonce], [4, ciphertext]]);
  } finally { key.fill(0); inner.fill(0); }
}
export function openGroupMessage(state: GroupState, data: Uint8Array) {
  const e = groupEnvelope(data);
  if (e.id !== state.id || e.epoch !== state.epoch) throw new Error('Wrong group or epoch');
  const key = hex(state.key, 32);
  let plain: Uint8Array;
  try { plain = chacha20poly1305(key, e.nonce, join(hex(e.id, 16), unsigned(e.epoch, 4))).decrypt(e.ciphertext); }
  finally { key.fill(0); }
  try {
    const f = fields16(plain, 65535), id = text(required(f, 1)), signingKey = bytesToHex(required(f, 2, 32));
    const member = state.members.find(m => m.signingKey === signingKey), timestamp = number(required(f, 4), 8), content = text(required(f, 5));
    if (!member || !id || bytes(id).length > 255 || !content.trim() || bytes(content).length > 65000 || bytes(text(required(f, 3))).length > 64 ||
        !ed25519.verify(required(f, 6, 64), groupMessageSigningBytes(e.id, e.epoch, id, timestamp, content), hex(signingKey, 32))) throw new Error('Invalid group sender');
    // The roster name is authenticated by the creator; the inner nickname is not signed.
    return { id, timestamp, content, member };
  } finally { plain.fill(0); }
}
