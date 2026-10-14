import { pureJsCrypto } from '@libp2p/noise/crypto/js';
import { wrapCrypto } from '@libp2p/noise/crypto';
import { XXHandshakeState } from '@libp2p/noise/protocol';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { Uint8ArrayList } from 'uint8arraylist';

import { join } from './bitchat-wire';

function nonce(counter: number): Uint8Array {
  const value = new Uint8Array(12);
  new DataView(value.buffer).setBigUint64(4, BigInt(counter), true);
  return value;
}
/** Bitchat adds a big-endian u32 counter to standard Noise transport ciphertext. */
export class BitchatCipher {
  private outgoing = 0;
  private highest = -1;
  private readonly received = new Set<number>();
  private closed = false;
  constructor(private readonly sendKey: Uint8Array, private readonly receiveKey: Uint8Array) {}
  seal(plain: Uint8Array): Uint8Array {
    if (this.closed || this.outgoing >= 0xffffffff) throw new Error('Bitchat session exhausted');
    const prefix = new Uint8Array(4);
    new DataView(prefix.buffer).setUint32(0, this.outgoing);
    const cipher = chacha20poly1305(this.sendKey, nonce(this.outgoing)).encrypt(plain);
    this.outgoing++;
    return join(prefix, cipher);
  }
  open(cipher: Uint8Array): Uint8Array {
    if (this.closed || cipher.length < 20) throw new Error('Invalid Bitchat ciphertext');
    const counter = new DataView(cipher.buffer, cipher.byteOffset, cipher.byteLength).getUint32(0);
    if (counter === 0xffffffff || counter <= this.highest - 1024 || this.received.has(counter))
      throw new Error('Replayed Bitchat ciphertext');
    const plain = chacha20poly1305(this.receiveKey, nonce(counter)).decrypt(cipher.subarray(4));
    // A failed authentication must never advance the replay window.
    this.highest = Math.max(this.highest, counter);
    this.received.add(counter);
    for (const n of this.received) if (n <= this.highest - 1024) this.received.delete(n);
    return plain;
  }
  destroy(): void {
    this.closed = true; this.sendKey.fill(0); this.receiveKey.fill(0); this.received.clear();
  }
}
export class BitchatHandshake {
  private readonly state: XXHandshakeState;
  private stage = 0;
  private closed = false;
  constructor(readonly initiator: boolean, staticSeed: Uint8Array, ephemeralSeed?: Uint8Array) {
    const crypto = wrapCrypto(pureJsCrypto);
    this.state = new XXHandshakeState({
      protocolName: 'Noise_XX_25519_ChaChaPoly_SHA256', prologue: new Uint8Array(), initiator,
      s: pureJsCrypto.generateX25519KeyPairFromSeed(staticSeed.slice()),
      crypto: ephemeralSeed ? { ...crypto,
        generateKeypair: () => pureJsCrypto.generateX25519KeyPairFromSeed(ephemeralSeed.slice()) } : crypto,
    });
  }
  write(): Uint8Array {
    if (this.closed || (this.initiator ? this.stage !== 0 && this.stage !== 2 : this.stage !== 1))
      throw new Error('Invalid Bitchat handshake write');
    const empty = new Uint8Array();
    const value = this.stage === 0 ? this.state.writeMessageA(empty) :
      this.stage === 1 ? this.state.writeMessageB(empty) : this.state.writeMessageC(empty);
    this.stage++;
    return value instanceof Uint8Array ? value : value.subarray();
  }
  read(message: Uint8Array): void {
    if (this.closed || (this.initiator ? this.stage !== 1 : this.stage !== 0 && this.stage !== 2))
      throw new Error('Invalid Bitchat handshake read');
    if (message.length !== [32, 96, 64][this.stage]) throw new Error('Invalid Bitchat handshake length');
    const value = new Uint8ArrayList(message);
    const payload = this.stage === 0 ? this.state.readMessageA(value) :
      this.stage === 1 ? this.state.readMessageB(value) : this.state.readMessageC(value);
    if (payload.length !== 0) throw new Error('Unexpected Bitchat handshake payload');
    this.stage++;
  }
  finish(expectedKey: Uint8Array): BitchatCipher {
    const remote = this.state.rs instanceof Uint8Array ? this.state.rs : this.state.rs?.subarray();
    if (this.closed || this.stage !== 3 || !remote ||
        !expectedKey.every((value, i) => value === remote[i]) || expectedKey.length !== 32)
      throw new Error('Bitchat Noise identity mismatch');
    const [first, second] = this.state.ss.split();
    if (!first.k || !second.k) throw new Error('Missing Bitchat session keys');
    const cipher = new BitchatCipher((this.initiator ? first.k : second.k).slice(),
      (this.initiator ? second.k : first.k).slice());
    first.k.fill(0); second.k.fill(0); this.destroy();
    return cipher;
  }
  destroy(): void {
    this.closed = true;
    this.state.s?.privateKey.fill(0); this.state.e?.privateKey.fill(0);
    this.state.ss.cs.k?.fill(0); this.state.ss.ck.fill(0);
  }
}
