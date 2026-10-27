import { getDecodedToken, getDecodedTokenBinary } from '@cashu/cashu-ts';
import { base64urlnopad } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
export const MAX_TOKEN = 8192, CHUNK_SIZE = 176, MAX_PARTS = Math.ceil(MAX_TOKEN / CHUNK_SIZE);
export const CASHU_PREFIX = 'OLC1:';
const utf8 = new TextEncoder();
export const digest = (value: string) => bytesToHex(sha256(utf8.encode(value)));
/** Structural inspection only: neither proves mint backing nor checks whether proofs are spent. */
export function inspectToken(input: string) {
  const wire = input.trim().replace(/^cashu:/, '').replace(/=+$/, '');
  if (wire.length > MAX_TOKEN || !/^cashu[AB][A-Za-z0-9_-]+$/.test(wire)) throw new Error('Invalid Cashu token');
  if (wire.startsWith('cashuA')) {
    const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(base64urlnopad.decode(wire.slice(6))));
    if (!Array.isArray(envelope.token) || envelope.token.length !== 1) throw new Error('Only single-mint tokens supported');
  }
  // Retain short keyset IDs when inspecting V4 offline; the external wallet resolves them at redemption.
  const token = wire.startsWith('cashuB')
    ? getDecodedTokenBinary(Uint8Array.from([...utf8.encode('crawB'), ...base64urlnopad.decode(wire.slice(6))]))
    : getDecodedToken(wire, []);
  const url = new URL(token.mint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.href.length > 512) throw new Error('Unsupported mint URL');
  if (token.unit !== undefined && token.unit !== 'sat') throw new Error('Only sat tokens are supported');
  if (!token.proofs.length || token.proofs.length > 32) throw new Error('Invalid proof count');
  const mint = url.href.replace(/\/+$/, '');
  let amount = 0n;
  const claims = token.proofs.map(proof => {
    const value = proof.amount.toBigInt();
    if (value <= 0n || value > 2100000000000000n || !/^(?:[0-9a-f]{16}|[0-9a-f]{66})$/i.test(proof.id) ||
      typeof proof.secret !== 'string' || !proof.secret.length || proof.secret.length > 1024 ||
      !/^(02|03)[0-9a-f]{64}$/i.test(proof.C)) throw new Error('Invalid proof');
    secp256k1.Point.fromHex(proof.C).assertValidity();
    amount += value;
    return digest(mint + '\n' + proof.secret);
  });
  if (new Set(claims).size !== claims.length || amount > 2100000000000000n) throw new Error('Duplicate or excessive proofs');
  return { wire, id: digest(wire), mint, amount: amount.toString(), claims };
}
export function tokenParts(wire: string): string[] {
  const token = inspectToken(wire);
  wire = token.wire;
  const id = token.id, total = Math.ceil(wire.length / CHUNK_SIZE);
  return Array.from({ length: total }, (_, index) => `${CASHU_PREFIX}${id}:${index}:${total}:${wire.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE)}`);
}
export function parsePart(content: string) {
  const match = /^OLC1:([0-9a-f]{64}):(\d{1,2}):(\d{1,2}):([A-Za-z0-9_-]+)$/.exec(content);
  if (!match) throw new Error('Invalid Cashu part');
  const [, id, rawIndex, rawTotal, data] = match, index = Number(rawIndex), total = Number(rawTotal);
  if (total < 1 || total > MAX_PARTS || index >= total || data.length > CHUNK_SIZE || (index < total - 1 && data.length !== CHUNK_SIZE)) throw new Error('Invalid Cashu part bounds');
  return { id, index, total, data };
}
