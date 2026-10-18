import { bytes } from '../bitchat-wire';
import { bytesToHex } from '@noble/hashes/utils.js';
import { getPublicKey, type Event } from 'nostr-tools/pure';
import { areaRelays } from '@/services/geohash/relay-directory';
import { GeohashSession, type GeoSocket } from '@/services/geohash/geohash-session';
import { courierTags, type CourierEnvelope } from './courier';
import { bridgeEvent, channelEvent, courierDrop, decodeCarrier, decodeDrop, encodeCarrier, validEvent, validHash, type Carrier } from './network-protocol';
import type { ProtocolStorage } from './prekey-runtime';
export type NetworkConfig = { autoAreaRelays?: boolean; gateway: boolean; bridge: boolean; hash: string; cell: string; relays: string[] };
export type NetworkPeer = { id: string; key: Uint8Array; capabilities: number; authenticated: boolean; verified: boolean };
type Uplink = { id: string; depositor: string; carrier: Carrier; at: number };
type Dependencies = {
  peers(): NetworkPeer[]; ownKey: Uint8Array;
  send(payload: Uint8Array, peer?: string): Promise<void>;
  geo(event: Event, hash: string): void; bridge(event: Event): void; hasRadio(event: Event): boolean;
  open(envelope: CourierEnvelope): Promise<boolean>; handover(envelope: CourierEnvelope, peer: string): Promise<void>;
  connected(count: number): void; error(): void; published(event: Event): void;
};
/** Opt-in public forwarding; private courier seals remain opaque on relays. */
export class NetworkRuntime {
  private transport?: GeohashSession;
  private online = 0;
  private dropOnline = 0;
  private readonly areas = new Map<string, { transport: GeohashSession; online: number }>();
  private stopped = true;
  private timer?: ReturnType<typeof setInterval>;
  private pending = Promise.resolve();
  private queued = 0;
  private mutations = Promise.resolve();
  private draining?: Promise<void>;
  private drainAgain = false;
  private readonly received = new Set<string>();
  private readonly meshSeen = new Set<string>();
  private readonly published = new Set<string>();
  private readonly publishing = new Set<string>();
  private readonly downlinks: Carrier[] = [];
  private readonly sendTimes: { at: number; bridge: boolean }[] = [];
  private readonly ingress = new Map<string, number[]>();
  private readonly signers = new Map<string, number[]>();
  private verificationTimes: number[] = [];
  private seenDrops: { id: string; expiry: number }[] = [];
  private lastPresence = 0;
  constructor(readonly config: NetworkConfig, private readonly bridgeKey: Uint8Array, private readonly deps: Dependencies,
    private readonly storage: ProtocolStorage, private readonly socket?: (url: string) => GeoSocket, private readonly now = Date.now) {
    if (config.gateway && config.hash && !validHash(config.hash) || config.bridge && (!validHash(config.cell) || config.cell.length !== 6)) throw new Error('Choose a valid bridge area');
  }
  private remember(set: Set<string>, id: string) { set.add(id); if (set.size > 512) set.delete(set.values().next().value!); }
  private tags(): string[] {
    const keys = [this.deps.ownKey, ...(this.config.gateway ? this.deps.peers().filter(peer => peer.authenticated && peer.verified).slice(0, 16).map(peer => peer.key) : [])];
    return [...new Set(keys.flatMap(key => courierTags(key, this.now()).map(bytesToHex)))];
  }
  private filters() {
    const filters: Record<string, unknown>[] = [];
    if (this.config.gateway && this.config.hash) filters.push({ kinds: [20000, 20001], '#g': [this.config.hash], since: Math.floor(this.now() / 1000) - 900, limit: 200 });
    if (this.config.bridge) {
      filters.push({ kinds: [20000, 20001], '#r': [this.config.cell], since: Math.floor(this.now() / 1000) - 900, limit: 200 });
      filters.push({ kinds: [1401], '#x': this.tags(), since: Math.floor(this.now() / 1000) - 86400, limit: 200 });
    }
    return filters;
  }
  refreshRelays() { if (!this.stopped && this.config.autoAreaRelays) for (const [hash, area] of this.areas) area.transport.updateRelays(areaRelays(hash)); }
  private connections() {
    this.online = this.dropOnline + [...this.areas.values()].reduce((sum, area) => sum + area.online, 0);
    if (this.stopped) return;
    // Surface disconnections as well as reconnections, not just successful opens.
    this.deps.connected(this.online);
    if (this.online) this.drain();
  }
  private area(hash: string, _bridge: boolean) {
    const id = hash, existing = this.areas.get(id); if (existing) return existing.transport;
    if (this.stopped) throw new Error('Network forwarding stopped');
    if (this.areas.size >= 3) { const protectedHashes = new Set([this.config.bridge ? this.config.cell : '', this.config.gateway ? this.config.hash : '']); const oldest = [...this.areas.keys()].find(key => !protectedHashes.has(key)) ?? this.areas.keys().next().value!; const area = this.areas.get(oldest)!; this.areas.delete(oldest); area.transport.stop(); }
    const area = { transport: undefined as unknown as GeohashSession, online: 0 };
    area.transport = new GeohashSession('0', this.bridgeKey.slice(), 'Outlink', areaRelays(hash), {
      message: () => {}, delivery: () => {}, presence: () => {}, error: this.deps.error,
      connection: count => { area.online = count; this.connections(); },
    }, this.socket, { subscription: 'mesh-network', filters: () => [ ...(this.config.gateway && this.config.hash === hash ? [{ kinds: [20000, 20001], '#g': [hash], since: Math.floor(this.now() / 1000) - 900, limit: 200 }] : []), ...(this.config.bridge && this.config.cell === hash ? [{ kinds: [20000, 20001], '#r': [hash], since: Math.floor(this.now() / 1000) - 900, limit: 200 }] : []) ], event: event => this.enqueue(() => this.relay(event)) });
    this.areas.set(id, area); area.transport.start(); return area.transport;
  }
  async start() {
    this.seenDrops = (await this.storage.get<{ id: string; expiry: number }[]>('network', 'seen-drops') ?? []).filter(entry => entry.expiry > this.now()).slice(-512);
    this.stopped = false;
    if (this.config.bridge || this.config.gateway && !this.config.autoAreaRelays) {
      this.transport = new GeohashSession('0', this.bridgeKey.slice(), 'Outlink', this.config.relays, {
        message: () => {}, delivery: () => {}, presence: () => {}, error: this.deps.error,
        connection: count => { this.dropOnline = count; this.connections(); },
      }, this.socket, { subscription: 'mesh-network', filters: () => this.config.autoAreaRelays ? this.filters().filter(filter => (filter.kinds as number[]).includes(1401)) : this.filters(), event: event => this.enqueue(() => this.relay(event)) });
      this.transport.start();
    }
    if (this.config.autoAreaRelays) { if (this.config.bridge) this.area(this.config.cell, true); if (this.config.gateway && this.config.hash) this.area(this.config.hash, false); }
    this.timer = setInterval(() => { this.transport?.resubscribe(); this.drain(); void this.presence().catch(this.deps.error); }, 5000);
  }
  private enqueue(work: () => Promise<void>) {
    if (this.stopped || this.queued >= 64) return;
    ++this.queued;
    this.pending = this.pending.then(() => new Promise<void>(resolve => setTimeout(resolve, 0))).then(async () => { if (!this.stopped) await work(); })
      .catch(this.deps.error).finally(() => { --this.queued; });
  }
  private allow(map: Map<string, number[]>, key: string, maximum: number): boolean {
    const times = (map.get(key) ?? []).filter(at => this.now() - at < 60000);
    if (times.length >= maximum) return false;
    if (!map.has(key) && map.size >= 128) map.delete(map.keys().next().value!);
    times.push(this.now()); map.set(key, times); return true;
  }
  private cryptoBudget(): boolean {
    this.verificationTimes = this.verificationTimes.filter(at => this.now() - at < 60000);
    if (this.verificationTimes.length >= 720) return false;
    this.verificationTimes.push(this.now()); return true;
  }
  async receive(payload: Uint8Array, link: string, directed: boolean, relayOnly = false): Promise<boolean> {
    if (this.stopped || !this.cryptoBudget()) return false;
    let carrier: Carrier; try { carrier = decodeCarrier(payload); } catch { return false; }
    const uplink = carrier.direction === 1 || carrier.direction === 3;
    if (uplink !== directed) return false;
    if (relayOnly) return uplink;
    if (uplink) {
      if (!this.config.gateway || carrier.direction === 3 && (!this.config.bridge || carrier.hash !== this.config.cell)) return false;
      if (this.meshSeen.has(carrier.event.id) || this.published.has(carrier.event.id)) return true;
      if (!this.allow(this.ingress, link, 10)) return false;
      await this.queueUplink(carrier, link); return true;
    }
    if (this.meshSeen.has(carrier.event.id)) return true;
    this.remember(this.meshSeen, carrier.event.id);
    if (carrier.direction === 2) this.deps.geo(carrier.event, carrier.hash);
    else if (!this.deps.hasRadio(carrier.event) && carrier.event.kind === 20000) this.deps.bridge(carrier.event);
    return true;
  }
  private queueUplink(carrier: Carrier, depositor: string): Promise<void> {
    const operation = this.mutations.catch(() => {}).then(async () => {
    if (this.stopped) throw new Error('Network forwarding stopped');
    const all = await this.storage.list<Uplink>('network-uplink', 20);
    if (all.some(entry => entry.id === carrier.event.id)) return;
    const own = all.filter(entry => entry.depositor === depositor).sort((a, b) => a.at - b.at);
    if (own.length >= 5) await this.storage.remove('network-uplink', own[0].id);
    else if (all.length >= 20) await this.storage.remove('network-uplink', all.sort((a, b) => a.at - b.at)[0].id);
    await this.storage.put('network-uplink', carrier.event.id, { id: carrier.event.id, carrier, depositor, at: this.now() } satisfies Uplink);
    });
    this.mutations = operation; return operation.then(() => { if (this.config.autoAreaRelays) this.area(carrier.hash, carrier.direction === 3); this.drain(); });
  }
  private async publish(event: Event) {
    const bridge = event.tags.find(tag => tag[0] === 'r'), geo = event.tags.find(tag => tag[0] === 'g');
    const transport = this.config.autoAreaRelays && (bridge || geo) ? this.area((bridge ?? geo)![1], !!bridge) : this.transport;
    if (!transport || !this.online || this.stopped) throw new Error('No network relay connected');
    this.publishing.add(event.id);
    try { await transport.publish(event); this.remember(this.published, event.id); this.deps.published(event); } finally { this.publishing.delete(event.id); }
  }
  private drain() {
    if (this.stopped) return;
    if (this.draining) { this.drainAgain = true; return; }
    this.draining = (async () => {
      for (const entry of await this.storage.list<Uplink>('network-uplink', 20)) {
        if (this.stopped) break;
        const permitted = entry.carrier.direction === 1 ? this.config.gateway : this.config.bridge;
        if (!channelEvent(entry.carrier.event, entry.carrier.hash, entry.carrier.direction >= 3, this.now())) { await this.storage.remove('network-uplink', entry.id); continue; }
        if (!permitted || !validEvent(entry.carrier.event)) continue;
        if (!this.online) {
          if (entry.depositor === 'self' && this.config.bridge) {
            const peer = this.deps.peers().find(peer => (peer.capabilities & 132) === 132);
            if (peer) { try { await this.deps.send(encodeCarrier(entry.carrier), peer.id); await this.storage.remove('network-uplink', entry.id); } catch { /* Retry after reconnection. */ } }
          }
          continue;
        }
        if (!this.meshSeen.has(entry.id)) { try { await this.publish(entry.carrier.event); } catch { break; } }
        await this.storage.remove('network-uplink', entry.id);
      }
      for (let i = this.sendTimes.length - 1; i >= 0; --i) if (this.now() - this.sendTimes[i].at >= 60000) this.sendTimes.splice(i, 1);
      for (let index = 0; index < this.downlinks.length && !this.stopped;) {
        const carrier = this.downlinks[index], bridge = carrier.direction === 4, limit = bridge ? 20 : 30;
        if (!channelEvent(carrier.event, carrier.hash, bridge, this.now())) { this.downlinks.splice(index, 1); continue; }
        if (this.sendTimes.filter(entry => entry.bridge === bridge).length >= limit) { ++index; continue; }
        try { await this.deps.send(encodeCarrier(carrier)); } catch { break; }
        this.sendTimes.push({ at: this.now(), bridge }); this.downlinks.splice(index, 1);
      }
    })().catch(this.deps.error).finally(() => { this.draining = undefined; if (this.drainAgain && !this.stopped) { this.drainAgain = false; this.drain(); } });
  }
  private async relay(value: unknown) {
    if (!this.cryptoBudget() || !validEvent(value, 30000)) return;
    const event = value;
    if (event.kind === 1401) {
      if (!this.config.bridge || this.seenDrops.some(entry => entry.id === event.id)) return;
      let envelope: CourierEnvelope; try { envelope = decodeDrop(event, this.now()); } catch { return; }
      const tag = bytesToHex(envelope.tag), own = courierTags(this.deps.ownKey, this.now()).some(key => bytesToHex(key) === tag);
      if (own) { if (!await this.deps.open(envelope)) return; }
      else {
        const peer = this.config.gateway && this.deps.peers().filter(peer => peer.authenticated && peer.verified).slice(0, 16).find(peer => courierTags(peer.key, this.now()).some(key => bytesToHex(key) === tag));
        if (!peer) return; await this.deps.handover(envelope, peer.id);
      }
      this.seenDrops = [...this.seenDrops.filter(entry => entry.expiry > this.now()), { id: event.id, expiry: envelope.expiry }].slice(-512);
      await this.storage.put('network', 'seen-drops', this.seenDrops); return;
    }
    if (bytes(JSON.stringify(event)).length > 16384) return;
    const bridge = event.tags.some(tag => tag[0] === 'r'), hash = bridge ? this.config.cell : this.config.hash;
    if (bridge ? !this.config.bridge || event.pubkey === getPublicKey(this.bridgeKey) : !this.config.gateway || !hash) return;
    if (!channelEvent(event, hash, bridge, this.now()) || this.received.has(event.id) || this.meshSeen.has(event.id) || this.published.has(event.id) || this.publishing.has(event.id) || !this.allow(this.signers, event.pubkey, 120)) return;
    this.remember(this.received, event.id);
    if (bridge) { if (!this.deps.hasRadio(event) && event.kind === 20000) this.deps.bridge(event); }
    else this.deps.geo(event, hash);
    if (this.config.gateway && (!bridge || !this.deps.hasRadio(event))) {
      if (this.downlinks.length >= 30) this.downlinks.shift();
      this.downlinks.push({ direction: bridge ? 4 : 2, hash, event }); this.drain();
    }
  }
  async uplinkGeo(event: Event, hash: string): Promise<boolean> {
    if (this.stopped || !validEvent(event) || !channelEvent(event, hash, false, this.now())) return false;
    const peer = this.deps.peers().find(peer => peer.capabilities & 4); if (!peer) return false;
    await this.deps.send(encodeCarrier({ direction: 1, hash, event }), peer.id); return true;
  }
  async publicMessage(content: string, name: string, sender: string, timestamp: number, nearbyOnly: boolean) {
    if (this.stopped || !this.config.bridge || nearbyOnly) return;
    const event = bridgeEvent(this.bridgeKey, this.config.cell, name, content, sender, timestamp);
    await this.queueUplink({ direction: 3, hash: this.config.cell, event }, 'self');

  }
  private async presence() {
    if (this.stopped || !this.config.bridge || !(this.config.autoAreaRelays ? this.areas.get(this.config.cell)?.online : this.dropOnline) || this.now() - this.lastPresence < 240000) return;
    this.lastPresence = this.now(); await this.publish(bridgeEvent(this.bridgeKey, this.config.cell, '', ''));
  }
  retry() { this.transport?.resubscribe(); this.drain(); }
  canDrop() { return this.config.bridge && this.dropOnline > 0 && !this.stopped; }
  async publishDrop(envelope: CourierEnvelope) { if (!this.canDrop()) throw new Error('Bridge is offline'); await this.publish(courierDrop(envelope)); }
  async idle() { await this.pending; await this.mutations.catch(() => {}); while (this.draining) await this.draining; }
  stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.transport?.stop(); for (const area of this.areas.values()) area.transport.stop(); this.areas.clear(); this.online = this.dropOnline = 0; this.bridgeKey.fill(0); this.deps.connected(0); }
}
