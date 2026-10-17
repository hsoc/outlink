import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { BitchatType, bytes, isBroadcast, type BitchatPacket } from '../bitchat-wire';
const valid = (id: string) => /^[0-9a-f]{16}$/.test(id);
/** Topology claims are routing hints, never proof of a direct authenticated link. */
export class MeshRouting {
  private readonly claims = new Map<string, { neighbors: Set<string>; at: number; version: number }>();
  private readonly failures = new Map<string, { pending?: number; suppressed?: number }>();
  clear() { this.claims.clear(); this.failures.clear(); }
  update(peer: string, neighbors: string[], version: number, now = Date.now()) {
    if (!valid(peer) || neighbors.some(id => !valid(id))) return;
    if (!this.claims.has(peer) && this.claims.size >= 256) this.claims.delete(this.claims.keys().next().value!);
    this.claims.set(peer, { neighbors: new Set(neighbors.filter(id => id !== peer).slice(0, 10)), at: now, version: Math.max(version, this.claims.get(peer)?.version ?? 1) });
  }
  observe(peer: string, version: number) { const claim = this.claims.get(peer); if (claim) claim.version = Math.max(claim.version, version); }
  remove(peer: string) { this.claims.delete(peer); this.failures.delete(peer); }
  route(source: string, destination: string, now = Date.now()): string[] | undefined {
    if (source === destination) return [];
    const queue = [[source]], seen = new Set([source]);
    for (let index = 0; index < queue.length; ++index) {
      const path = queue[index], last = path.at(-1)!, claim = this.claims.get(last);
      if (!claim || now - claim.at >= 60000 || path.length > 5) continue;
      for (const neighbor of claim.neighbors) {
        const other = this.claims.get(neighbor);
        if (seen.has(neighbor) || !other || other.version < 2 || now - other.at >= 60000 || !other.neighbors.has(last)) continue;
        const next = [...path, neighbor]; if (neighbor === destination) return next.slice(1, -1);
        seen.add(neighbor); queue.push(next);
      }
    }
  }
  canRoute(peer: string, now = Date.now()): boolean {
    const failure = this.failures.get(peer); if (!failure) return true;
    if (failure.suppressed && now < failure.suppressed) return false;
    failure.suppressed = undefined;
    if (failure.pending !== undefined && now - failure.pending > 10000) { failure.pending = undefined; failure.suppressed = now + 60000; return false; }
    return true;
  }
  routed(peer: string, now = Date.now()) {
    if (!this.failures.has(peer) && this.failures.size >= 256) this.failures.delete(this.failures.keys().next().value!);
    const state = this.failures.get(peer) ?? {}; state.pending ??= now; this.failures.set(peer, state);
  }
  confirmed(peer: string) { const state = this.failures.get(peer); if (!state) return; if (!state.suppressed) this.failures.delete(peer); else state.pending = undefined; }
}
/** Follow the immutable route; a missing next-hop hint falls back to flooding. */
export function nextRoute(packet: BitchatPacket, local: string): string | 'drop' | undefined {
  if (packet.type === BitchatType.sync || packet.recipient === local || packet.ttl <= 1) return 'drop';
  if (!packet.route?.length) return;
  const index = packet.route.indexOf(local);
  return index < 0 ? packet.route[0] : index === packet.route.length - 1 ? packet.recipient : packet.route[index + 1];
}
export function selectFanout(links: string[], packet: BitchatPacket, seed: string): string[] {
  if (!isBroadcast(packet) || [BitchatType.announce, BitchatType.fragment, BitchatType.sync].includes(packet.type as 1 | 32 | 33)) return links;
  const select = (ids: string[]) => {
    const count = ids.length <= 2 ? ids.length : Math.min(ids.length, Math.ceil(Math.log2(ids.length)) + 1);
    if (count === ids.length) return ids;
    return ids.map(id => ({ id, score: bytesToHex(sha256(bytes(`${seed}::${id}`))) }))
      .sort((a, b) => a.score < b.score ? -1 : a.score > b.score ? 1 : a.id < b.id ? -1 : 1).slice(0, count).map(entry => entry.id);
  };
  return [...select(links.filter(id => !id.startsWith('p:'))), ...select(links.filter(id => id.startsWith('p:')))];
}
export function relayTiming(packet: BitchatPacket, degree: number, random: number): { ttl: number; delay: number } | undefined {
  if (packet.ttl <= 1 || packet.type === BitchatType.sync) return;
  const directed = !isBroadcast(packet), handshake = packet.type === BitchatType.handshake;
  const range = (low: number, high: number) => low + random % (high - low + 1);
  if (handshake || directed && [BitchatType.fragment, BitchatType.encrypted].includes(packet.type as 17 | 32)) return { ttl: packet.ttl - 1, delay: handshake ? range(10, 35) : range(20, 60) };
  if (packet.type === BitchatType.fragment || packet.type === BitchatType.voice) return { ttl: Math.min(packet.ttl, degree >= 6 ? 5 : 7) - 1, delay: range(8, 25) };
  const cap = degree >= 6 ? 5 : degree <= 2 || packet.type === BitchatType.announce ? 7 : 6;
  return { ttl: Math.min(packet.ttl, cap) - 1, delay: degree <= 2 ? range(10, 40) : degree <= 5 ? range(60, 150) : degree <= 9 ? range(80, 180) : range(100, 220) };
}
