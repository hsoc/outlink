import { getPublicKey } from 'nostr-tools/pure';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';
import { GeohashSession, type GeoSocket } from '@/services/geohash/geohash-session';
import { mobileIdentity } from '../mobile-identity';
import { bytes, text, join, encodePacket, decodePacket, encodeTlv, decodeTlv } from '../bitchat-wire';
import { createPrivateEnvelope, openPrivateEnvelope } from './nostr-private';
export type InternetPayload = { kind: 'message'; id: string; content: string; senderId: string; recipientId?: string; timestamp: number } |
  { kind: 'receipt'; id: string; delivery: 'delivered' | 'read'; senderId: string; recipientId?: string; timestamp: number };
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
    join(Uint8Array.of(payload.delivery === 'read' ? 2 : 3), bytes(payload.id));
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
  return null;
}
export class PrivateMailbox {
  readonly pubkey: string;
  private readonly transport: GeohashSession;
  private stopped = true;
  private queued = 0;
  private pending = Promise.resolve();
  private readonly seen = new Set<string>();
  constructor(private readonly key: Uint8Array, relays: string[],
    callbacks: { message(sender: string, payload: InternetPayload): Promise<void>; connection(count: number): void; error(): void },
    socket?: (url: string) => GeoSocket) {
    this.pubkey = getPublicKey(key);
    this.transport = new GeohashSession('0', key.slice(), 'Outlink', relays, {
      message: () => {}, delivery: () => {}, presence: () => {}, connection: callbacks.connection, error: callbacks.error,
    }, socket, { subscription: 'private-inbox', filters: () => [{ kinds: [1059], '#p': [this.pubkey], since: Math.floor(Date.now() / 1000) - 86400, limit: 200 }],
      event: event => {
        if (this.stopped || this.queued >= 64) return;
        this.queued++;
        this.pending = this.pending.then(() => new Promise<void>(resolve => setTimeout(resolve, 0))).then(async () => {
          if (this.stopped) return;
          let opened: ReturnType<typeof openPrivateEnvelope>, payload: InternetPayload | null;
          try {
            opened = openPrivateEnvelope(event, this.key);
            if (this.seen.has(opened.id)) return;
            if (opened.timestamp < Math.floor(Date.now() / 1000) - 86400 || opened.timestamp > Math.floor(Date.now() / 1000) + 300) return;
            payload = await decodeEmbedded(opened.content);
            if (!payload && opened.content.trim() && !opened.content.startsWith('bitchat1:')) payload = { kind: 'message', id: opened.id, content: opened.content, senderId: '', timestamp: opened.timestamp * 1000 };
          } catch { return; } // Invalid remote data is not an application error.
          if (this.stopped || !payload) return;
          await callbacks.message(opened.sender, payload);
          // A storage failure must remain retryable, rather than poisoning dedup.
          this.seen.add(opened.id); if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
        }).catch(() => callbacks.error()).finally(() => { this.queued--; });
      } });
  }
  start() { this.stopped = false; this.transport.start(); }
  async send(recipient: string, payload: InternetPayload, senderId?: string, recipientId?: string) {
    if (this.stopped) throw new Error('Private mailbox is stopped');
    await this.transport.publish(createPrivateEnvelope(embeddedPrivate(payload, senderId, recipientId), this.key, recipient));
  }
  async settled() { await this.pending; }
  stop() { this.stopped = true; this.transport.stop(); this.key.fill(0); this.seen.clear(); }
}
