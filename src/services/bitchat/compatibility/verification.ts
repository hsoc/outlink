import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { bytes, join, peerId } from '../bitchat-wire';
import { label } from './binary';
export type Verification = { v: number; noiseKeyHex: string; signKeyHex: string; npub?: string; nickname: string; ts: number; nonceB64: string; sigHex: string };
function canonical(qr: Omit<Verification, 'sigHex'>): Uint8Array {
  return join(...['bitchat-verify-v1', String(qr.v), qr.noiseKeyHex.toLowerCase(), qr.signKeyHex.toLowerCase(), qr.npub ?? '', qr.nickname, String(qr.ts), qr.nonceB64].map(label));
}
export function verificationLink(noiseSeed: Uint8Array, signingSeed: Uint8Array, nickname: string, npub?: string, now = Math.floor(Date.now() / 1000)): string {
  const qr = { v: 1, noiseKeyHex: bytesToHex(x25519.getPublicKey(noiseSeed)), signKeyHex: bytesToHex(ed25519.getPublicKey(signingSeed)), nickname, npub, ts: now, nonceB64: base64urlnopad.encode(randomBytes(16)) };
  const url = new URL('bitchat://verify');
  for (const [name, value] of Object.entries({ v: '1', noise: qr.noiseKeyHex, sign: qr.signKeyHex, nick: nickname, ts: String(now), nonce: qr.nonceB64, sig: bytesToHex(ed25519.sign(canonical(qr), signingSeed)), ...(npub ? { npub } : {}) })) url.searchParams.set(name, value);
  return url.toString();
}
export function verifyLink(value: string, now = Math.floor(Date.now() / 1000), maxAge = 300): Verification & { id: string; fingerprint: string } {
  if (value.length > 4096) throw new Error('Verification link too large');
  const url = new URL(value);
  if (url.protocol !== 'bitchat:' || url.hostname !== 'verify' || url.pathname !== '' || url.hash !== '' || url.username !== '' || url.password !== '' || url.port !== '' || url.searchParams.getAll('npub').length > 1) throw new Error('Invalid verification link');
  const get = (key: string) => { const all = url.searchParams.getAll(key); if (all.length !== 1) throw new Error('Invalid verification field'); return all[0]; };
  const qr = { v: Number(get('v')), noiseKeyHex: get('noise').toLowerCase(), signKeyHex: get('sign').toLowerCase(), nickname: get('nick'), ts: Number(get('ts')), nonceB64: get('nonce'), sigHex: get('sig').toLowerCase(), npub: url.searchParams.get('npub') ?? undefined };
  if (qr.v !== 1 || !Number.isSafeInteger(qr.ts) || Math.abs(now - qr.ts) > maxAge ||
      !/^[0-9a-f]{64}$/.test(qr.noiseKeyHex) || !/^[0-9a-f]{64}$/.test(qr.signKeyHex) || !/^[0-9a-f]{128}$/.test(qr.sigHex) ||
      base64urlnopad.decode(qr.nonceB64).length !== 16 || bytes(qr.nickname).length > 64 || !qr.nickname.trim() ||
      !ed25519.verify(hexToBytes(qr.sigHex), canonical(qr), hexToBytes(qr.signKeyHex))) throw new Error('Invalid or expired verification signature');
  const key = hexToBytes(qr.noiseKeyHex);
  return { ...qr, id: peerId(key), fingerprint: bytesToHex(sha256(key)) };
}
export function verificationResponseBytes(noiseHex: string, nonce: Uint8Array): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(noiseHex) || nonce.length !== 16) throw new Error('Invalid verification challenge');
  return join(bytes('bitchat-verify-resp-v1'), label(noiseHex), nonce);
}
