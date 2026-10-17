import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
const utf8 = new TextEncoder();
const prefix = 'outlink:v1:';
/** Versioned authenticated records; indexes and encryption use separate derived keys. */
export function localCipher(secret: string) {
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('Invalid local storage key');
  const root = hexToBytes(secret);
  const key = hkdf(sha256, root, undefined, utf8.encode('outlink/local-storage/encryption/v1'), 32);
  const indexKey = hkdf(sha256, root, undefined, utf8.encode('outlink/local-storage/index/v1'), 32);
  root.fill(0);
  return {
    index(context: string) { return bytesToHex(hmac(sha256, indexKey, utf8.encode(context))); },
    seal(value: string, context: string) {
      const nonce = randomBytes(24), plaintext = utf8.encode(value);
      try { return prefix + base64.encode(concatBytes(nonce, xchacha20poly1305(key, nonce, utf8.encode(context)).encrypt(plaintext))); }
      finally { plaintext.fill(0); }
    },
    open(value: string, context: string) {
      if (!value.startsWith(prefix)) throw new Error('Unsupported local storage format');
      const data = base64.decode(value.slice(prefix.length));
      if (data.length < 40) throw new Error('Truncated encrypted record');
      const plaintext = xchacha20poly1305(key, data.subarray(0, 24), utf8.encode(context)).decrypt(data.subarray(24));
      try { return new TextDecoder('utf-8', { fatal: true }).decode(plaintext); }
      finally { plaintext.fill(0); }
    },
    destroy() { key.fill(0); indexKey.fill(0); },
  };
}
export const newLocalStorageKey = () => bytesToHex(randomBytes(32));
