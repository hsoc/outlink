import { getPublicKey, type Event } from 'nostr-tools/pure';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { GeohashSession, type GeoSocket } from '@/services/geohash/geohash-session';
import { mobileIdentity } from '../mobile-identity';
import { bytes, text, join, encodePacket, decodePacket, encodeTlv, decodeTlv } from '../bitchat-wire';
import { createPrivateEnvelope, openPrivateEnvelope } from './nostr-private';
export type RotationPayload = { kind: 'rotation'; id: string; proof: Event; timestamp: number; senderId: string; recipientId?: string } |
  { kind: 'rotation-ack'; id: string; previous: string; next: string; timestamp: number; senderId: string; recipientId?: string };
export type InternetPayload = { kind: 'message'; id: string; content: string; senderId: string; recipientId?: string; timestamp: number } |
  { kind: 'receipt'; id: string; delivery: 'delivered' | 'read'; senderId: string; recipientId?: string; timestamp: number } | RotationPayload;
export async function privateNostrKey(scope = 'private-nostr'): Promise<Uint8Array> {
  const root = hexToBytes(await mobileIdentity());
  try {
    for (let counter = 0; ; counter++) {
      const key = hkdf(sha256, root, undefined, bytes(`outlink/bitchat/${scope}/v1/${counter}`), 32);
      if (secp256k1.utils.isValidSecretKey(key)) return key;
      key.fill(0);
    }
  } finally { root.fill(0); }
}
export function embeddedPrivate(payload: InternetPayload, senderId = bytesToHex(randomBytes(8)), recipientId?: string): string {
  const data = payload.kind === 'message' ? join(Uint8Array.of(1), encodeTlv([[0, bytes(payload.id)], [1, bytes(payload.content)]])) :
    payload.kind === 'receipt' ? join(Uint8Array.of(payload.delivery === 'read' ? 2 : 3), bytes(payload.id)) :
    join(Uint8Array.of(0xf0, 1), bytes(JSON.stringify(payload)));
  if (data.length > 12288) throw new Error('Private payload too large');
  return 'bitchat1:' + base64urlnopad.encode(encodePacket({ version: 1, type: 17, ttl: 7, timestamp: payload.timestamp, sender: senderId, recipient: recipientId, payload: data }, true));
}
export async function decodeEmbedded(value: string): Promise<InternetPayload | null> {
  if (!value.startsWith('bitchat1:') || value.length > 16384) return null;
  const packet = await decodePacket(base64urlnopad.decode(value.slice(9)));
  if (packet.type !== 17 || !packet.payload.length) throw new Error('Invalid embedded private packet');
  const fields = { senderId: packet.sender, recipientId: packet.recipient, timestamp: packet.timestamp };
  if (packet.payload[0] === 1) {
    const f = decodeTlv(packet.payload.subarray(1)), id = text(f.get(0) ?? new Uint8Array()), content = text(f.get(1) ?? new Uint8Array());
    if (!id || !content.trim()) throw new Error('Invalid private message');
    return { ...fields, kind: 'message', id, content };
  }
  if ([2, 3].includes(packet.payload[0])) {
    const id = text(packet.payload.subarray(1)); if (!id || bytes(id).length > 255) throw new Error('Invalid receipt');
    return { ...fields, kind: 'receipt', id, delivery: packet.payload[0] === 2 ? 'read' : 'delivered' };
  }
  if (packet.payload[0] === 0xf0 && packet.payload[1] === 1 && packet.payload.length <= 4096) {
    const control = JSON.parse(text(packet.payload.subarray(2)));
    if (!/^[0-9a-f]{64}$/.test(control.id ?? '')) return null;
    if (control.kind === 'rotation' && control.proof && typeof control.proof === 'object') return { ...fields, kind: 'rotation', id: control.id, proof: control.proof };
    if (control.kind === 'rotation-ack' && /^[0-9a-f]{64}$/.test(control.previous ?? '') && /^[0-9a-f]{64}$/.test(control.next ?? '')) return { ...fields, kind: 'rotation-ack', id: control.id, previous: control.previous, next: control.next };
  }
  return null;
}
export class PrivateMailbox {
  pubkey: string;
  private readonly keys = new Map<string, Uint8Array>();
  private readonly transport: GeohashSession;
  private stopped = true;
  private queued = 0;
  private pending = Promise.resolve();
  private readonly seen = new Set<string>();
  constructor(key: Uint8Array, relays: string[],
    callbacks: { message(sender: string, payload: InternetPayload, recipient?: string): Promise<void>; connection(count: number): void; error(): void },
    socket?: (url: string) => GeoSocket, private readonly multiIdentity = false, retired: Uint8Array[] = []) {
    if (retired.length > 2) throw new Error('Private grace key limit exceeded');
    this.pubkey = getPublicKey(key);
    this.keys.set(this.pubkey, key);
    for (const old of retired) this.keys.set(getPublicKey(old), old);
    this.transport = new GeohashSession('0', key.slice(), 'Outlink', relays, {
      message: () => {}, delivery: () => {}, presence: () => {}, connection: callbacks.connection, error: callbacks.error,
    }, socket, { subscription: 'private-inbox', filters: () => [{ kinds: [1059], '#p': [...this.keys.keys()], since: Math.floor(Date.now() / 1000) - 86400, limit: 200 }],
      event: event => {
        if (this.stopped || this.queued >= 64) return;
        this.queued++;
        this.pending = this.pending.then(() => new Promise<void>(resolve => setTimeout(resolve, 0))).then(async () => {
          if (this.stopped) return;
          let opened: ReturnType<typeof openPrivateEnvelope>, payload: InternetPayload | null;
          try {
            const address = (event as Event)?.tags?.find?.(tag => tag?.[0] === 'p')?.[1], secret = address ? this.keys.get(address) : undefined;
            if (!secret) return;
            opened = openPrivateEnvelope(event, secret);
            if (this.seen.has(opened.id)) return;
            if (opened.timestamp < Math.floor(Date.now() / 1000) - 86400 || opened.timestamp > Math.floor(Date.now() / 1000) + 300) return;
            payload = await decodeEmbedded(opened.content);
            if (!payload && opened.content.trim() && !opened.content.startsWith('bitchat1:')) payload = { kind: 'message', id: opened.id, content: opened.content, senderId: '', timestamp: opened.timestamp * 1000 };
          } catch { return; } // Invalid remote data is not an application error.
          if (this.stopped || !payload) return;
          if (this.multiIdentity) {
            const address = (event as Event).tags.find(tag => tag[0] === 'p')![1];
            await callbacks.message(opened.sender, payload, address);
          } else await callbacks.message(opened.sender, payload);
          // A storage failure must remain retryable, rather than poisoning dedup.
          this.seen.add(opened.id); if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
        }).catch(() => callbacks.error()).finally(() => { this.queued--; });
      } });
  }
  start() { this.stopped = false; this.transport.start(); }
  async send(recipient: string, payload: InternetPayload, senderId?: string, recipientId?: string) {
    await this.sendFrom(this.pubkey, recipient, payload, senderId, recipientId);
  }
  hasIdentity(pubkey: string) { return this.keys.has(pubkey); }
  async sendFrom(own: string, recipient: string, payload: InternetPayload, senderId?: string, recipientId?: string) {
    const key = this.keys.get(own);
    if (this.stopped || !key) throw new Error('Private identity is unavailable');
    await this.transport.publish(createPrivateEnvelope(embeddedPrivate(payload, senderId, recipientId), key, recipient));
  }
  replaceIdentities(key: Uint8Array, retired: Uint8Array[]) {
    if (this.stopped || retired.length > 2) { key.fill(0); retired.forEach(value => value.fill(0)); throw new Error('Private identity update unavailable'); }
    const current = getPublicKey(key), keys = new Map([[current, key], ...retired.map(value => [getPublicKey(value), value] as const)]);
    for (const value of this.keys.values()) value.fill(0); this.keys.clear();
    this.pubkey = current; for (const [pubkey, value] of keys) this.keys.set(pubkey, value);
    this.transport.replaceIdentity(key.slice()); this.transport.resubscribe();
  }
  updateRelays(relays: string[]) { this.transport.updateRelays(relays); }
  async settled() { await this.pending; }
  stop() { this.stopped = true; this.transport.stop(); for (const key of this.keys.values()) key.fill(0); this.keys.clear(); this.seen.clear(); }
}
