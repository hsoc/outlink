import { bytesToHex } from '@noble/hashes/utils.js';
import { BITCHAT_MAX_PACKET, BitchatType, decodePacket, encodePacket, join,
  type BitchatPacket, type InflateRaw } from './bitchat-wire';

type Assembly = { packet: BitchatPacket; count: number; type: number; at: number;
  bytes: number; chunks: Map<number, Uint8Array> };
export function fragmentPacket(packet: BitchatPacket, mtu: number, fragmentId: Uint8Array): Uint8Array[] {
  const wire = encodePacket(packet, (packet.type === BitchatType.handshake || packet.type === BitchatType.encrypted));
  if (wire.length <= mtu) return [wire];
  const envelope: BitchatPacket = { ...packet, type: BitchatType.fragment,
    signature: undefined, wirePayload: undefined, compressed: false, payload: new Uint8Array() };
  const chunkSize = mtu - encodePacket(envelope).length - 13;
  const count = Math.ceil(wire.length / chunkSize);
  if (fragmentId.length !== 8 || chunkSize < 1 || count > 256) throw new Error('Bitchat link MTU too small');
  return Array.from({ length: count }, (_, i) => {
    const header = new Uint8Array(13); header.set(fragmentId);
    const view = new DataView(header.buffer); view.setUint16(8, i); view.setUint16(10, count); header[12] = packet.type;
    return encodePacket({ ...envelope, payload: join(header, wire.subarray(i * chunkSize, (i + 1) * chunkSize)) });
  });
}
/** Assemblies are keyed by the original sender, never by the mutable ingress link. */
export class BitchatFragments {
  private readonly pending = new Map<string, Assembly>();
  private totalBytes = 0;
  clear(): void { this.pending.clear(); this.totalBytes = 0; }
  private remove(key: string): void {
    const a = this.pending.get(key); if (a) this.totalBytes -= a.bytes; this.pending.delete(key);
  }
  async accept(packet: BitchatPacket, now: number, inflate?: InflateRaw): Promise<BitchatPacket | null> {
    for (const [key, a] of this.pending) if (now - a.at > 30_000) this.remove(key);
    const p = packet.payload;
    if (p.length <= 13) throw new Error('Invalid Bitchat fragment');
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const index = view.getUint16(8), count = view.getUint16(10), type = p[12];
    if (!count || count > 256 || index >= count || type === BitchatType.fragment)
      throw new Error('Invalid Bitchat fragment header');
    const key = `${packet.sender}:${bytesToHex(p.subarray(0, 8))}`;
    let a = this.pending.get(key);
    if (!a) {
      if (this.pending.size >= 32 || [...this.pending.keys()].filter((k) => k.startsWith(packet.sender + ':')).length >= 4)
        throw new Error('Bitchat fragment quota');
      a = { packet, count, type, at: now, bytes: 0, chunks: new Map() }; this.pending.set(key, a);
    }
    if (a.count !== count || a.type !== type || a.packet.timestamp !== packet.timestamp ||
        a.packet.recipient !== packet.recipient) { this.remove(key); throw new Error('Conflicting Bitchat fragments'); }
    const chunk = p.slice(13), previous = a.chunks.get(index);
    if (previous) {
      if (previous.length !== chunk.length || !previous.every((v, i) => v === chunk[i])) {
        this.remove(key); throw new Error('Conflicting Bitchat fragment bytes');
      }
      return null;
    }
    if (a.bytes + chunk.length > BITCHAT_MAX_PACKET + 512 || this.totalBytes + chunk.length > 1024 * 1024) {
      this.remove(key); throw new Error('Bitchat assembly limit');
    }
    a.chunks.set(index, chunk); a.bytes += chunk.length; this.totalBytes += chunk.length;
    if (a.chunks.size !== count) return null;
    const wire = join(...Array.from({ length: count }, (_, i) => a!.chunks.get(i)!));
    this.remove(key);
    const result = await decodePacket(wire, inflate);
    if (result.sender !== packet.sender || result.recipient !== packet.recipient || result.type !== type ||
        result.timestamp !== packet.timestamp) throw new Error('Bitchat fragment identity mismatch');
    return { ...result, ttl: Math.min(result.ttl, packet.ttl) };
  }
}
