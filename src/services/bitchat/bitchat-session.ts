import { MeshRouting, nextRoute, selectFanout, relayTiming } from './compatibility/routing';
import { verificationResponseBytes } from './compatibility/verification';
import { GossipCache, decodeSync } from './compatibility/gossip';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import type { ProximityTransportPort, ProximityTransportSubscription } from '@/platform';
import { BitchatCipher, BitchatHandshake } from './bitchat-noise';
import { BitchatFragments, fragmentPacket } from './bitchat-fragments';
import { BITCHAT_TTL, BitchatType, bytes, decodePacket, decodeTlv, encodeTlv, join,
  packetId, peerId, signPacket, text, verifyPacket, isBroadcast, type BitchatPacket } from './bitchat-wire';

export type ExtensionContext = { link: string; boundPeer?: string; authenticated: boolean; noiseKey?: Uint8Array; signingKey?: Uint8Array };
export type MeshPingResult = { rttMs: number; hops?: number };
export type BitchatIdentity = { noiseSeed: Uint8Array; noisePublicKey: Uint8Array; signingSeed: Uint8Array };
export type BitchatPeer = { id: string; name: string; fingerprint: string; lastSeen: number; secure: boolean; authenticatedCapabilities?: boolean; capabilities?: number; direct?: boolean; authenticatedLink?: boolean; noisePublicKey?: string; signingPublicKey?: string };
export type BitchatMessage = { id: string; peer: string; recipient?: string; name: string; content: string;
  timestamp: number; channelThread?: string; bridge?: { pubkey: string; radioHint?: string }; outgoing: boolean; delivery: 'queued' | 'carried' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' };
type KnownPeer = BitchatPeer & { ingress: string; noiseKey: Uint8Array; signingKey: Uint8Array };
type Negotiation = { handshake: BitchatHandshake; at: number; promise: Promise<void>;
  resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Callbacks = { extension?(packet: BitchatPacket, context: ExtensionContext): Promise<boolean>; peer: (peer: BitchatPeer) => void; message: (message: BitchatMessage) => void;
  receipt: (id: string, sender: string, status: 'sent' | 'delivered' | 'read' | 'failed') => void; error: (error: Error) => void };

/** MIT implementation of the Bitchat bearer/session rules, with bounded ephemeral state. */
export class BitchatSession {
  readonly id: string;
  private capabilities = 0;
  private readonly pendingPrekeys = new Map<string, { packet: BitchatPacket; ingress: string }>();
  private readonly authenticatedLinks = new Map<string, string>();
  private readonly pings = new Map<string, { peer: string; at: number; timer: ReturnType<typeof setTimeout>; resolve(result: MeshPingResult): void; reject(error: Error): void }>();
  private readonly pingResponses = new Map<string, number[]>();
  private readonly routing = new MeshRouting();
  private readonly directHints = new Map<string, string>();
  private topologyTimer?: ReturnType<typeof setTimeout>;
  private readonly signingKey: Uint8Array;
  private readonly peers = new Map<string, KnownPeer>();
  private readonly links = new Set<string>();
  private readonly seen = new Map<string, number>();
  private readonly privateSeen = new Map<string, number>();
  private readonly ciphers = new Map<string, { cipher: BitchatCipher; at: number }>();
  private readonly retired = new Map<string, { cipher: BitchatCipher; until: number }>();
  private readonly rekeyAt = new Map<string, number>();
  private readonly negotiations = new Map<string, Negotiation>();
  private readonly fragments = new BitchatFragments();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private subscriptions: ProximityTransportSubscription[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private queue: Promise<void> = Promise.resolve();
  private queued = 0;
  private readonly relays = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sends = new Map<string, Promise<void>>();
  private readonly gossip: GossipCache;
  private readonly verificationWaits = new Map<string, { nonce: Uint8Array; noiseKey: string; signingKey: string; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly challengeNonces = new Map<string, string>();
  private readonly pins = new Map<string, { noiseKey: string; signingKey: string }>();
  private readonly syncRequests = new Map<string, number>();
  private readonly syncResponses = new Map<string, number[]>();
  private readonly syncSending = new Set<string>();
  private readonly outboundTimes = new Map<string, number[]>();
  private readonly sendWaits = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve(): void }>();
  constructor(private readonly transport: ProximityTransportPort, private readonly identity: BitchatIdentity,
    private name: string, private readonly callbacks: Callbacks,
    private readonly random: (length: number) => Uint8Array,
    archive?: { packets: BitchatPacket[]; changed(id: string, packet?: BitchatPacket): void; pins?: { id: string; noiseKey: string; signingKey: string }[] }) {
    if (!name.trim() || bytes(name).length > 64) throw new Error('Bitchat name must fit 64 UTF-8 bytes');
    for (const pin of archive?.pins ?? []) this.pins.set(pin.id, pin);
    this.gossip = new GossipCache(archive?.changed);
    for (const packet of archive?.packets ?? []) this.gossip.add(packet, false);
    this.id = peerId(identity.noisePublicKey); this.signingKey = ed25519.getPublicKey(identity.signingSeed);
  }
  private report(error: unknown): void {
    this.callbacks.error(error instanceof Error ? error : new Error('Bitchat operation failed'));
  }
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.transport.configureProtocolAsync || !this.transport.maximumFrameSizeAsync)
      throw new Error('This build does not support Bitchat Bluetooth');
    if (!await this.transport.requestPermissions()) throw new Error('Bluetooth permission was denied');
    await this.transport.configureProtocolAsync('bitchat');
    this.running = true;
    this.subscriptions = [
      this.transport.addListener('onPeer', (e) => {
        if (!this.running || typeof e.endpointId !== 'string') return;
        if (this.links.size >= 64 && !this.links.has(e.endpointId)) return;
        this.links.add(e.endpointId);
        void this.broadcast(this.announcement(), undefined, e.endpointId).catch((error) => this.report(error));
      }),
      this.transport.addListener('onConnection', (e) => {
        if (e.state !== 'disconnected' || typeof e.endpointId !== 'string') return;
        this.links.delete(e.endpointId); this.authenticatedLinks.delete(e.endpointId); this.pingResponses.delete(e.endpointId); this.directHints.delete(e.endpointId); this.refreshTopology(); this.outboundTimes.delete(e.endpointId);
        this.syncRequests.delete(e.endpointId); this.syncResponses.delete(e.endpointId);
        const wait = this.sendWaits.get(e.endpointId);
        if (wait) { clearTimeout(wait.timer); wait.resolve(); this.sendWaits.delete(e.endpointId); }
        // A returned peer keeps its identity, but may have discarded its ephemeral Noise state.
        for (const peer of this.peers.values()) if (peer.ingress === e.endpointId && !this.directLink(peer.id) && !this.routing.route(this.id, peer.id)?.length) {
          this.ciphers.get(peer.id)?.cipher.destroy(); this.ciphers.delete(peer.id);
          this.failHandshake(peer.id, new Error('Bitchat peer disconnected'));
          peer.lastSeen = 0; peer.secure = false; peer.authenticatedLink = false; this.callbacks.peer(peer);
        }
      }),
      this.transport.addListener('onMessage', (e) => {
        if (!this.running || typeof e.endpointId !== 'string' || !(e.payload instanceof Uint8Array)) return;
        if (!this.links.has(e.endpointId)) return;
        const endpoint = e.endpointId, wire = e.payload.slice(), now = Date.now();
        const rate = this.rates.get(endpoint) ?? { at: now, count: 0 };
        if (now - rate.at >= 1000) { rate.at = now; rate.count = 0; }
        if (rate.count++ >= 64 || this.queued >= 128 || wire.length > 128 * 1024 + 512) return;
        if (this.rates.size < 64 || this.rates.has(endpoint)) this.rates.set(endpoint, rate);
        this.queued++;
        this.queue = this.queue.then(async () => { await new Promise(resolve => setTimeout(resolve, 0)); if (this.running) await this.receive(wire, endpoint); })
          .catch(() => { /* Reject malformed or unauthenticated radio traffic silently. */ }).finally(() => { this.queued--; });
      }),
    ];
    try {
      await this.transport.startAdvertisingAsync(new Uint8Array());
      await this.transport.startScanAsync(0);
      this.tick();
    } catch (error) { await this.stop(); throw error; }
  }
  get nickname(): string { return this.name; }
  rename(name: string): void {
    const value = name.trim();
    if (!value || bytes(value).length > 64) throw new Error('Bitchat name must fit 64 UTF-8 bytes');
    if (value === this.name) return;
    this.name = value;
    if (this.running && this.links.size) void this.broadcast(this.announcement()).catch(error => this.report(error));
  }
  private tick(): void {
    if (!this.running) return;
    void this.broadcast(this.announcement()).catch((error) => this.report(error));
    const now = Date.now();
    for (const [key, entry] of this.retired) if (now >= entry.until) { entry.cipher.destroy(); this.retired.delete(key); }
    for (const [key, value] of this.seen) if (now - value > 300_000) this.seen.delete(key);
    for (const [key, value] of this.privateSeen) if (now - value > 6 * 3600_000) this.privateSeen.delete(key);
    for (const peer of this.peers.values()) if (peer.lastSeen && now - peer.lastSeen > 60_000) {
      peer.lastSeen = 0; peer.secure = false; peer.authenticatedLink = false; this.callbacks.peer(peer);
      this.ciphers.get(peer.id)?.cipher.destroy(); this.ciphers.delete(peer.id);
    }
    for (const [key, entry] of this.ciphers) {
      if (now - entry.at > 3000000 && !this.negotiations.has(key) && now - (this.rekeyAt.get(key) ?? 0) > 30000 && this.peers.get(key)?.lastSeen) {
        this.rekeyAt.set(key, now); void this.rekey(key).catch(() => {});
      }
      if (now - entry.at <= 7200000) continue;
      entry.cipher.destroy(); this.ciphers.delete(key);
      const peer = this.peers.get(key); if (peer) { peer.secure = false; this.callbacks.peer(peer); }
    }
    for (const endpoint of this.links) void this.requestHistory(endpoint).catch(error => this.report(error));
    this.timer = setTimeout(() => this.tick(), this.links.size ? 15_000 : 4000);
  }
  private capabilityBytes(): Uint8Array { return this.capabilities > 255 ? Uint8Array.of(this.capabilities & 255, this.capabilities >>> 8) : Uint8Array.of(this.capabilities); }
  setCapabilities(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Invalid capabilities');
    if (this.capabilities === value) return;
    this.capabilities = value;
    if (this.running) for (const [peer, entry] of this.ciphers) void this.sendState(peer, entry.cipher).catch(error => this.report(error));
    if (this.running) void this.broadcast(this.announcement()).catch(error => this.report(error));
  }
  authenticatedDirect(peer: string): boolean { return [...this.authenticatedLinks].some(([link, id]) => id === peer && this.links.has(link) && this.directHints.get(link) === peer && this.ciphers.has(peer)); }
  directPeers(): string[] { return [...new Set(this.directHints.values())]; }
  async rekey(peer: string): Promise<void> { await this.ensureCipher(peer, true); }
  async authenticateDirect(peer: string): Promise<void> {
    if (!this.directLink(peer)) throw new Error('Peer is not directly connected');
    if (this.authenticatedDirect(peer)) return;
    await this.ensureCipher(peer, true);
    if (!this.authenticatedDirect(peer)) throw new Error('Direct link authentication failed');
  }
  async sendExtension(type: number, payload: Uint8Array, peer?: string, direct = false): Promise<void> {
    if (![BitchatType.courier, BitchatType.prekeys, BitchatType.carrier].includes(type as 4 | 36 | 40)) throw new Error('Unsupported extension');
    const link = peer && direct ? [...this.authenticatedLinks].find(([link, id]) => id === peer && this.links.has(link) && this.directHints.get(link) === peer)?.[0] : undefined;
    if (direct && (!peer || !link || !this.authenticatedDirect(peer))) throw new Error('Authenticated direct link required');
    const packet = signPacket(this.packet(type, payload, peer), this.identity.signingSeed);
    await this.broadcast(packet, undefined, link);
    if (type === BitchatType.prekeys) this.gossip.add(packet);
  }
  async sendReceipt(peer: string, id: string, status: 'delivered' | 'read') {
    if (!id || bytes(id).length > 255) throw new Error('Invalid receipt ID');
    const cipher = await this.ensureCipher(peer);
    await this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(join(Uint8Array.of(status === 'read' ? 2 : 3), bytes(id))), peer));
  }
  private packet(type: number, payload: Uint8Array, recipient?: string): BitchatPacket {
    return { version: 1, type, ttl: BITCHAT_TTL, timestamp: Date.now(), sender: this.id, recipient, payload };
  }
  private refreshTopology() {
    for (const [link, id] of this.directHints) if (!this.links.has(link) || !this.peers.get(id)?.lastSeen || Date.now() - this.peers.get(id)!.lastSeen > 60000) this.directHints.delete(link);
    this.routing.update(this.id, [...new Set(this.directHints.values())].slice(0, 10), 2);
  }
  routeTo(peer: string): string[] | undefined { return this.directLink(peer) ? [] : this.routing.route(this.id, peer); }
  private directLink(peer: string, exclude?: string) {
    return [...this.directHints].filter(([link, id]) => id === peer && link !== exclude && this.links.has(link))
      .sort(([a], [b]) => Number(a.startsWith('p:')) - Number(b.startsWith('p:')) || a.localeCompare(b))[0]?.[0];
  }
  private announcement(): BitchatPacket {
    this.refreshTopology();
    const packet = signPacket({ ...this.packet(BitchatType.announce, encodeTlv([
      [1, bytes(this.name)], [2, this.identity.noisePublicKey], [3, this.signingKey],
      [4, join(...[...new Set(this.directHints.values())].slice(0, 10).map(hexToBytes))], [5, this.capabilityBytes()],
    ])), version: 2 }, this.identity.signingSeed);
    this.gossip.add(packet); return packet;
  }
  private async requestHistory(endpoint: string): Promise<void> {
    const packet = signPacket({ ...this.packet(BitchatType.sync, this.gossip.request()), ttl: 0 }, this.identity.signingSeed);
    this.syncRequests.set(endpoint, Date.now() + 30_000);
    await this.broadcast(packet, undefined, endpoint);
  }
  private async broadcast(packet: BitchatPacket, exclude?: string, only?: string): Promise<void> {
    if (!this.running) throw new Error('Bitchat is stopped');
    if (!only && packet.sender === this.id && !isBroadcast(packet) && packet.ttl > 1 && !packet.rsr && packet.type !== BitchatType.sync && !this.directLink(packet.recipient!) && this.routing.canRoute(packet.recipient!)) {
      const route = this.routing.route(this.id, packet.recipient!);
      if (route?.length) { packet = signPacket({ ...packet, version: 2, route, signature: undefined }, this.identity.signingSeed); this.routing.routed(packet.recipient!); }
    }
    const next = nextRoute(packet, this.id);
    const directed = packet.sender === this.id && packet.recipient ? this.directLink(packet.recipient, exclude) : undefined;
    const routeLink = next && next !== 'drop' ? this.directLink(next, exclude) : undefined;
    const chosen = only ?? routeLink ?? directed;
    const ingressPeer = exclude ? this.directHints.get(exclude) : undefined;
    let targets = [...this.links].filter((link) => link !== exclude && (!ingressPeer || this.directHints.get(link) !== ingressPeer) && (!chosen || chosen === link));
    if (!chosen) {
      const seenPeers = new Set<string>();
      if (packet.type !== BitchatType.announce) targets = targets.sort((a, b) => Number(a.startsWith('p:')) - Number(b.startsWith('p:'))).filter(link => { const peer = this.directHints.get(link); if (!peer) return true; if (seenPeers.has(peer)) return false; seenPeers.add(peer); return true; });
      targets = selectFanout(targets, packet, packetId(packet));
    }
    if (!targets.length && packet.sender === this.id && packet.type !== BitchatType.announce)
      throw new Error('No Bitchat peers are connected');
    const outcomes = await Promise.allSettled(targets.map(async (endpoint) => {
      const previous = this.sends.get(endpoint) ?? Promise.resolve();
      const send = previous.catch(() => {}).then(async () => {
        if (!this.running || !this.links.has(endpoint)) throw new Error('Bitchat link is stopped');
        const mtu = await this.transport.maximumFrameSizeAsync!(endpoint);
        for (const frame of fragmentPacket(packet, mtu, this.random(8))) {
          await this.pace(endpoint);
          await this.transport.sendAsync(endpoint, frame);
        }
      });
      this.sends.set(endpoint, send);
      try { await send; } finally { if (this.sends.get(endpoint) === send) this.sends.delete(endpoint); }
    }));
    if (outcomes.length && outcomes.every((result) => result.status === 'rejected'))
      throw (outcomes[0] as PromiseRejectedResult).reason;
  }
  private async pace(endpoint: string): Promise<void> {
    // At most 48 frames in any second, leaving headroom under the 64-frame ingress cap.
    while (this.running && this.links.has(endpoint)) {
      const now = Date.now(), recent = (this.outboundTimes.get(endpoint) ?? []).filter(at => now - at < 1000);
      this.outboundTimes.set(endpoint, recent);
      if (recent.length < 48) { recent.push(now); return; }
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.sendWaits.delete(endpoint); resolve(); }, Math.max(1, recent[0] + 1001 - now));
        this.sendWaits.set(endpoint, { timer, resolve });
      });
    }
    throw new Error('Bitchat link is stopped');
  }
  async sendPublic(content: string, allowIsolated = false): Promise<BitchatMessage> {
    if (!content.trim() || bytes(content).length > 255) throw new Error('Message must fit 255 UTF-8 bytes');
    const packet = signPacket(this.packet(BitchatType.message, bytes(content)), this.identity.signingSeed);
    if (this.links.size || !allowIsolated) await this.broadcast(packet);
    this.remember(this.seen, packetId(packet)); this.gossip.add(packet);
    const message: BitchatMessage = { id: packetId(packet), peer: this.id, name: this.name, content,
      timestamp: packet.timestamp, outgoing: true, delivery: this.links.size ? 'sent' : 'queued' };
    this.callbacks.message(message); return message;
  }
  private remember(cache: Map<string, number>, key: string): boolean {
    if (cache.has(key)) return false;
    cache.set(key, Date.now()); if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    return true;
  }
  private newNegotiation(peer: string, initiator: boolean): Negotiation {
    if (this.negotiations.size >= 16) throw new Error('Too many Bitchat handshakes');
    let resolve!: () => void, reject!: (e: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    void promise.catch(() => {});
    const handshake = new BitchatHandshake(initiator, this.identity.noiseSeed);
    const timer = setTimeout(() => this.failHandshake(peer, new Error('Bitchat handshake timed out')), 15_000);
    const entry = { handshake, at: Date.now(), promise, resolve, reject, timer };
    this.negotiations.set(peer, entry); return entry;
  }
  private failHandshake(peer: string, error: Error): void {
    const n = this.negotiations.get(peer); if (!n) return;
    clearTimeout(n.timer); n.handshake.destroy(); n.reject(error); this.negotiations.delete(peer);
  }
  private async ensureCipher(peer: string, replace = false): Promise<BitchatCipher> {
    const known = this.peers.get(peer);
    if (!known || Date.now() - known.lastSeen > 60_000) throw new Error('Bitchat peer is offline');
    if (!replace && this.ciphers.has(peer)) return this.ciphers.get(peer)!.cipher;
    let negotiation = this.negotiations.get(peer);
    if (!negotiation) {
      negotiation = this.newNegotiation(peer, true);
      try { await this.broadcast(this.packet(BitchatType.handshake, negotiation.handshake.write(), peer)); }
      catch (error) { this.failHandshake(peer, error as Error); throw error; }
    }
    await negotiation.promise;
    const cipher = this.ciphers.get(peer)?.cipher;
    if (!cipher) throw new Error('Bitchat session unavailable'); return cipher;
  }
  pin(peer: string, noiseKey: string, signingKey: string): void {
    if (!/^[0-9a-f]{64}$/.test(noiseKey) || !/^[0-9a-f]{64}$/.test(signingKey) || peerId(hexToBytes(noiseKey)) !== peer) throw new Error('Invalid identity pin');
    const known = this.peers.get(peer);
    if (known && (bytesToHex(known.noiseKey) !== noiseKey || bytesToHex(known.signingKey) !== signingKey)) throw new Error('Contact does not match the live peer');
    this.pins.set(peer, { noiseKey, signingKey });
  }
  async verifyContact(peer: string, noiseKey: string, signingKey: string): Promise<void> {
    this.pin(peer, noiseKey, signingKey);
    if (this.verificationWaits.has(peer)) throw new Error('Verification already pending');
    const cipher = await this.ensureCipher(peer), nonce = this.random(16);
    let resolve!: () => void, reject!: (error: Error) => void;
    const response = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => { this.verificationWaits.delete(peer); reject(new Error('Contact verification timed out')); }, 30000);
    this.verificationWaits.set(peer, { nonce, noiseKey, signingKey, resolve, reject, timer });
    // Attach the waiter before transmission, including synchronous loopback bearers.
    try {
      await Promise.all([response, this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(join(Uint8Array.of(0x10), encodeTlv([[1, bytes(noiseKey)], [2, nonce]]))), peer))]);
    } finally { clearTimeout(timer); this.verificationWaits.delete(peer); nonce.fill(0); }
  }
  async sendPrivate(peer: string, content: string, messageId: string): Promise<void> {
    if (!content.trim() || bytes(content).length > 255 || !messageId || bytes(messageId).length > 255)
      throw new Error('Message must fit 255 UTF-8 bytes');
    const cipher = await this.ensureCipher(peer);
    const payload = join(Uint8Array.of(1), encodeTlv([[0, bytes(messageId)], [1, bytes(content)]]));
    const packet = this.packet(BitchatType.encrypted, cipher.seal(payload), peer);
    this.callbacks.message({ id: messageId, peer: this.id, recipient: peer, name: this.name, content,
      timestamp: packet.timestamp, outgoing: true, delivery: 'sending' });
    try { await this.broadcast(packet); this.callbacks.receipt(messageId, peer, 'sent'); }
    catch (error) { this.callbacks.receipt(messageId, peer, 'failed'); throw error; }
  }
  async ping(peer: string): Promise<MeshPingResult> {
    if (!this.running || !/^[0-9a-f]{16}$/.test(peer) || peer === this.id || this.pings.size >= 16) throw new Error('Mesh probe is unavailable');
    const nonce = this.random(8), key = bytesToHex(nonce);
    if (this.pings.has(key)) throw new Error('Mesh probe nonce collision');
    let resolve!: (result: MeshPingResult) => void, reject!: (error: Error) => void;
    const result = new Promise<MeshPingResult>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => { this.pings.delete(key); reject(new Error('Mesh probe timed out')); }, 10000);
    this.pings.set(key, { peer, at: Date.now(), timer, resolve, reject });
    try {
      const [reply] = await Promise.all([result, this.broadcast(this.packet(BitchatType.ping, join(nonce, Uint8Array.of(BITCHAT_TTL)), peer))]); return reply;
    } finally { clearTimeout(timer); this.pings.delete(key); }
  }
  private async receiveProbe(packet: BitchatPacket, ingress: string) {
    if (packet.payload.length < 9) return;
    const nonce = packet.payload.subarray(0, 8), key = bytesToHex(nonce);
    if (packet.type === BitchatType.pong) {
      const pending = this.pings.get(key); if (!pending || pending.peer !== packet.sender) return;
      this.pings.delete(key); clearTimeout(pending.timer);
      const origin = packet.payload[8];
      pending.resolve({ rttMs: Math.max(0, Date.now() - pending.at), hops: origin >= packet.ttl ? origin - packet.ttl + 1 : undefined });
      return;
    }
    // Claimed sender IDs are unsigned and cannot key an amplification budget.
    const now = Date.now(), recent = (this.pingResponses.get(ingress) ?? []).filter(at => now - at < 10000);
    if (recent.length >= 5) return;
    recent.push(now); this.pingResponses.set(ingress, recent);
    await this.broadcast(this.packet(BitchatType.pong, join(nonce, Uint8Array.of(BITCHAT_TTL)), packet.sender));
  }
  async markRead(peer: string, messageId: string): Promise<void> {
    const cipher = this.ciphers.get(peer)?.cipher;
    if (cipher && bytes(messageId).length <= 255)
      await this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(join(Uint8Array.of(2), bytes(messageId))), peer));
  }
  private async receive(wire: Uint8Array, ingress: string): Promise<void> {
    const inflate = this.transport.inflateRawAsync?.bind(this.transport);
    let packet = await decodePacket(wire, inflate);
    if (!this.running) return;
    const prekey = packet.type === BitchatType.prekeys || packet.type === BitchatType.fragment && packet.payload[12] === BitchatType.prekeys;
    if (packet.sender === this.id || Math.abs(Date.now() - packet.timestamp) > (prekey ? 24 : 6) * 3600_000) return;
    const solicited = !!packet.rsr && (this.syncRequests.get(ingress) ?? 0) >= Date.now();
    if (packet.rsr && !solicited) return;
    const incomingId = packetId(packet);
    const duplicate = this.seen.has(incomingId);
    // Only fragments enter dedup before final authentication; complete packets
    // must remain retryable if their author's announcement has not arrived yet.
    if (packet.type === BitchatType.fragment && !duplicate) this.remember(this.seen, incomingId);
    if (duplicate) {
      const scheduled = this.relays.get(incomingId);
      if (scheduled) { clearTimeout(scheduled); this.relays.delete(incomingId); }
      // A cached announce must not suppress a later live reachability proof.
      if (packet.type !== BitchatType.announce || solicited) return;
    }
    const reassembled = packet.type === BitchatType.fragment;
    if (reassembled) {
      // Each shard is floodable, but complete packets are authenticated before display.
      if (packet.ttl > 1 && packet.payload[12] !== BitchatType.sync) this.forward(packet, ingress);
      const complete = await this.fragments.accept(packet, Date.now(), inflate);
      if (!complete || !this.running) return; packet = complete;
      if (this.seen.has(packetId(packet)) && (packet.type !== BitchatType.announce || solicited)) return;
    }
    if (packet.type === BitchatType.announce) {
      if (!solicited && Math.abs(Date.now() - packet.timestamp) > 60_000) return;
      const f = decodeTlv(packet.payload), name = text(f.get(1) ?? new Uint8Array());
      const noiseKey = f.get(2), signingKey = f.get(3);
      if (!name.trim() || bytes(name).length > 255 || !noiseKey || !signingKey || signingKey.length !== 32 ||
          peerId(noiseKey) !== packet.sender || !verifyPacket(packet, signingKey)) return;
      const pin = this.pins.get(packet.sender);
      if (pin && (pin.noiseKey !== bytesToHex(noiseKey) || pin.signingKey !== bytesToHex(signingKey))) return;
      const neighbors = f.get(4);
      if (neighbors && (neighbors.length > 80 || neighbors.length % 8)) return;
      const capability = f.get(5); if (capability && (!capability.length || capability.length > 8)) return;
      const previous = this.peers.get(packet.sender);
      if (previous && (!previous.noiseKey.every((v, i) => v === noiseKey[i]) ||
          !previous.signingKey.every((v, i) => v === signingKey[i]))) return;
      if (!previous && this.peers.size >= 256) return;
      const peer: KnownPeer = { id: packet.sender, name, noiseKey, signingKey, ingress,
        authenticatedCapabilities: previous?.authenticatedCapabilities && this.ciphers.has(packet.sender),
        capabilities: previous?.authenticatedCapabilities && this.ciphers.has(packet.sender) ? previous.capabilities : (capability?.[0] ?? 0) | (capability?.[1] ?? 0) << 8, direct: packet.ttl === BITCHAT_TTL && !solicited, authenticatedLink: this.authenticatedDirect(packet.sender), noisePublicKey: bytesToHex(noiseKey), signingPublicKey: bytesToHex(signingKey), fingerprint: bytesToHex(sha256(noiseKey)), lastSeen: solicited ? previous?.lastSeen ?? 0 : Date.now(), secure: this.ciphers.has(packet.sender) };
      this.peers.set(packet.sender, peer); this.callbacks.peer(peer); this.gossip.add(packet);
      if (!solicited) {
        this.routing.update(peer.id, neighbors ? Array.from({ length: neighbors.length / 8 }, (_, index) => bytesToHex(neighbors.subarray(index * 8, index * 8 + 8))) : [], packet.version);
        if (packet.ttl === BITCHAT_TTL && this.directHints.get(ingress) !== peer.id) {
          // Provisional forwarding hint only; not a courier trust/authentication binding.
          this.directHints.set(ingress, peer.id); this.refreshTopology();
          if (!this.topologyTimer) this.topologyTimer = setTimeout(() => { this.topologyTimer = undefined; if (this.running) void this.broadcast(this.announcement()).catch(error => this.report(error)); }, 50);
        }
      }
      const pending = this.pendingPrekeys.get(peer.id); this.pendingPrekeys.delete(peer.id);
      if (pending && Math.abs(Date.now() - pending.packet.timestamp) <= 86400000 && verifyPacket(pending.packet, signingKey)) {
        const accepted = await this.callbacks.extension?.(pending.packet, { link: pending.ingress, boundPeer: this.directHints.get(pending.ingress), authenticated: false, noiseKey, signingKey });
        if (accepted) { this.gossip.add(pending.packet); this.remember(this.seen, packetId(pending.packet)); if (!pending.packet.rsr && pending.packet.ttl > 1) this.forward(pending.packet, pending.ingress); }
      }
      if (!previous && !solicited) void this.requestHistory(ingress).catch(error => this.report(error));
    } else if ((packet.type === BitchatType.message || packet.type === BitchatType.leave)) {
      const known = this.peers.get(packet.sender);
      if (!known || !verifyPacket(packet, known.signingKey)) return;
      if (packet.type === BitchatType.message) {
        const content = text(packet.payload); this.gossip.add(packet);
        if (content.trim() && isBroadcast(packet)) this.callbacks.message({ id: packetId(packet),
          peer: packet.sender, name: known.name, content, timestamp: packet.timestamp, outgoing: false, delivery: 'sent' });
      } else { known.lastSeen = 0; known.secure = false; this.callbacks.peer(known);
        this.ciphers.get(packet.sender)?.cipher.destroy(); this.ciphers.delete(packet.sender); }
    } else if (packet.type === BitchatType.sync) {
      const known = this.peers.get(packet.sender);
      if (packet.ttl !== 0 || !known || !verifyPacket(packet, known.signingKey) || (packet.recipient && packet.recipient !== this.id)) return;
      const now = Date.now(), recent = (this.syncResponses.get(ingress) ?? []).filter(at => now - at < 30_000);
      if (recent.length >= 8 || this.syncSending.has(ingress)) return;
      recent.push(now); this.syncResponses.set(ingress, recent);
      const missing = this.gossip.missing(decodeSync(packet.payload));
      this.remember(this.seen, packetId(packet));
      this.syncSending.add(ingress);
      void (async () => {
        try {
          for (const cached of missing) {
            if (!this.running || !this.links.has(ingress)) break;
            await this.broadcast({ ...cached, ttl: 0, rsr: true }, undefined, ingress);
          }
        } catch (error) { if (this.running) this.report(error); }
        finally { this.syncSending.delete(ingress); }
      })();
      return;
    } else if ([BitchatType.courier, BitchatType.prekeys, BitchatType.carrier].includes(packet.type as 4 | 36 | 40)) {
      const known = this.peers.get(packet.sender);
      if (packet.type === BitchatType.prekeys && !known) {
        if (packet.payload.length <= 1024 && (this.pendingPrekeys.has(packet.sender) || this.pendingPrekeys.size < 32)) this.pendingPrekeys.set(packet.sender, { packet, ingress });
        return;
      }
      const needsSignature = packet.type === BitchatType.prekeys || packet.type === BitchatType.carrier && packet.recipient === this.id;
      if (needsSignature && (!known || !verifyPacket(packet, known.signingKey))) return;
      const accepted = await this.callbacks.extension?.(packet, { link: ingress, boundPeer: this.directHints.get(ingress),
        authenticated: this.authenticatedLinks.get(ingress) === packet.sender && this.authenticatedDirect(packet.sender), noiseKey: known?.noiseKey, signingKey: known?.signingKey });
      if (!accepted) return;
      if (packet.type === BitchatType.prekeys) this.gossip.add(packet);
    } else if (![BitchatType.handshake, BitchatType.encrypted, BitchatType.ping, BitchatType.pong].includes(packet.type as 16 | 17 | 38 | 39)) return;
    if (packet.route?.length && packet.type !== BitchatType.announce) {
      const known = this.peers.get(packet.sender); if (!known || !verifyPacket(packet, known.signingKey)) return;
    }
    this.routing.observe(packet.sender, packet.version);
    if (packet.signature && this.peers.has(packet.sender) && verifyPacket(packet, this.peers.get(packet.sender)!.signingKey)) this.routing.confirmed(packet.sender);
    if (packet.recipient === this.id) {
      if (packet.type === BitchatType.ping || packet.type === BitchatType.pong) await this.receiveProbe(packet, ingress);
      if (packet.type === BitchatType.handshake) await this.receiveHandshake(packet, ingress);
      if (packet.type === BitchatType.encrypted) await this.receivePrivate(packet);
      this.remember(this.seen, packetId(packet)); return;
    }
    this.remember(this.seen, packetId(packet));
    if (!duplicate && !solicited && !reassembled && packet.ttl > 1) this.forward(packet, ingress);
  }
  private forward(packet: BitchatPacket, ingress: string): void {
    if (this.relays.size >= 128 || nextRoute(packet, this.id) === 'drop') return;
    const timing = relayTiming(packet, this.links.size, this.random(1)[0]); if (!timing) return;
    const key = packetId(packet), next = nextRoute(packet, this.id);
    const only = next && next !== 'drop' ? this.directLink(next, ingress) : undefined;
    const timer = setTimeout(() => {
      this.relays.delete(key);
      if (this.running) void this.broadcast({ ...packet, ttl: timing.ttl }, ingress, only).catch(() => {});
    }, timing.delay);
    this.relays.set(key, timer);
  }
  private async receiveHandshake(packet: BitchatPacket, ingressForHandshake: string): Promise<void> {
    const peer = this.peers.get(packet.sender); if (!peer) return;
    let entry = this.negotiations.get(peer.id);
    try {
      if (packet.payload.length === 32) {
        if (entry?.handshake.initiator && this.id < peer.id) return;
        if (entry && !entry.handshake.initiator) return;
        if (!entry && Date.now() - (this.rekeyAt.get(peer.id) ?? 0) < 5000) return;
        this.rekeyAt.set(peer.id, Date.now());
        if (entry) {
          // Preserve callers waiting for our collided initiation when becoming responder.
          entry.handshake.destroy(); entry.handshake = new BitchatHandshake(false, this.identity.noiseSeed);
        } else entry = this.newNegotiation(peer.id, false);
        entry.handshake.read(packet.payload);
        await this.broadcast(this.packet(BitchatType.handshake, entry.handshake.write(), peer.id));
        return;
      }
      if (!entry) return;
      entry.handshake.read(packet.payload);
      if (entry.handshake.initiator)
        await this.broadcast(this.packet(BitchatType.handshake, entry.handshake.write(), peer.id));
      if (!this.running) return;
      const cipher = entry.handshake.finish(peer.noiseKey);
      this.retired.get(peer.id)?.cipher.destroy();
      const previous = this.ciphers.get(peer.id);
      if (previous) this.retired.set(peer.id, { cipher: previous.cipher, until: Date.now() + 30000 });
      this.ciphers.set(peer.id, { cipher, at: Date.now() });
      for (const [link, id] of this.authenticatedLinks) if (id === peer.id) this.authenticatedLinks.delete(link);
      peer.authenticatedCapabilities = false;
      clearTimeout(entry.timer); this.negotiations.delete(peer.id);
      if (packet.ttl === BITCHAT_TTL && !packet.route?.length && this.directHints.get(ingressForHandshake) === peer.id) this.authenticatedLinks.set(ingressForHandshake, peer.id);
      peer.secure = true; peer.authenticatedLink = this.authenticatedDirect(peer.id); this.callbacks.peer(peer); entry.resolve();
      // Bind the signing key to the Noise-authenticated identity for newer clients.
      await this.sendState(peer.id, cipher);
    } catch (error) { this.failHandshake(peer.id, error as Error); throw error; }
  }
  private sendState(peer: string, cipher: BitchatCipher) {
    const state = join(Uint8Array.of(0x21, 1), encodeTlv([[1, this.capabilityBytes()], [2, this.signingKey]]));
    return this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(state), peer));
  }
  private async receivePrivate(packet: BitchatPacket): Promise<void> {
    const peer = this.peers.get(packet.sender), cipher = this.ciphers.get(packet.sender)?.cipher;
    if (!peer || !cipher) return;
    let plain: Uint8Array, oldSession = false;
    try { plain = cipher.open(packet.payload); } catch (error) {
      const retired = this.retired.get(peer.id);
      if (!retired || retired.until <= Date.now()) throw error;
      plain = retired.cipher.open(packet.payload); oldSession = true;
    }
    this.routing.confirmed(peer.id);
    if (plain[0] === 1) {
      const f = decodeTlv(plain.subarray(1)), messageId = text(f.get(0) ?? new Uint8Array());
      const content = text(f.get(1) ?? new Uint8Array());
      if (!messageId || !content.trim()) return;
      if (this.remember(this.privateSeen, `${peer.id}:${messageId}`))
        this.callbacks.message({ id: messageId, peer: peer.id, recipient: this.id, name: peer.name,
          content, timestamp: packet.timestamp, outgoing: false, delivery: 'delivered' });
      await this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(join(Uint8Array.of(3), bytes(messageId))), peer.id));
    } else if (plain[0] === 2 || plain[0] === 3) {
      const messageId = text(plain.subarray(1));
      if (bytes(messageId).length <= 255) this.callbacks.receipt(messageId, peer.id, plain[0] === 2 ? 'read' : 'delivered');
    } else if (plain[0] === 0x10 || plain[0] === 0x11) {
      const fields = decodeTlv(plain.subarray(1)), noiseKey = text(fields.get(1) ?? new Uint8Array()), nonce = fields.get(2);
      if (!/^[0-9a-f]{64}$/.test(noiseKey) || nonce?.length !== 16) return;
      if (plain[0] === 0x10) {
        if (noiseKey !== bytesToHex(this.identity.noisePublicKey) || this.challengeNonces.get(peer.id) === bytesToHex(nonce)) return;
        this.challengeNonces.set(peer.id, bytesToHex(nonce));
        const signature = ed25519.sign(verificationResponseBytes(noiseKey, nonce), this.identity.signingSeed);
        await this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(join(Uint8Array.of(0x11), encodeTlv([[1, bytes(noiseKey)], [2, nonce], [3, signature]]))), peer.id));
      } else {
        const pending = this.verificationWaits.get(peer.id), signature = fields.get(3);
        if (!pending || pending.noiseKey !== noiseKey || bytesToHex(pending.nonce) !== bytesToHex(nonce) || signature?.length !== 64 ||
          !ed25519.verify(signature, verificationResponseBytes(noiseKey, nonce), hexToBytes(pending.signingKey))) return;
        clearTimeout(pending.timer); this.verificationWaits.delete(peer.id); pending.resolve();
      }
    } else if (plain[0] === 0x21) {
      if (plain[1] !== 1 || oldSession) return;
      const fields = decodeTlv(plain.subarray(2)), key = fields.get(2), capabilities = fields.get(1);
      if (!capabilities || capabilities.length < 1 || capabilities.length > 8 || capabilities.length > 1 && capabilities.at(-1) === 0) throw new Error('Invalid authenticated capabilities');
            if (!key || key.length !== 32) throw new Error('Invalid Bitchat authenticated signing key');
      // A self-signed public announcement cannot prove possession of its Noise
      // key. The encrypted state is authoritative after XX authenticates that key.
      const pin = this.pins.get(peer.id);
      if (pin && pin.signingKey !== bytesToHex(key)) throw new Error('Pinned signing identity changed');
      peer.capabilities = capabilities[0] | (capabilities[1] ?? 0) << 8; peer.authenticatedCapabilities = true;
      peer.signingKey = key.slice(); peer.signingPublicKey = bytesToHex(key);
      this.callbacks.peer(peer);
    }
  }
  async stop(): Promise<void> {
    this.running = false; if (this.timer) clearTimeout(this.timer);
    if (this.topologyTimer) clearTimeout(this.topologyTimer); this.topologyTimer = undefined;
    this.directHints.clear(); this.pendingPrekeys.clear(); this.authenticatedLinks.clear(); this.routing.clear(); this.pingResponses.clear();
    for (const ping of this.pings.values()) { clearTimeout(ping.timer); ping.reject(new Error('Bitchat stopped')); }
    this.pings.clear();
    this.relays.forEach(clearTimeout); this.relays.clear();
    for (const wait of this.sendWaits.values()) { clearTimeout(wait.timer); wait.resolve(); }
    this.sendWaits.clear(); this.outboundTimes.clear(); this.syncRequests.clear(); this.syncResponses.clear(); this.syncSending.clear();
    this.subscriptions.forEach((s) => s.remove()); this.subscriptions = [];
    for (const key of this.negotiations.keys()) this.failHandshake(key, new Error('Bitchat stopped'));
    this.ciphers.forEach((v) => v.cipher.destroy()); this.ciphers.clear();
    this.retired.forEach(v => v.cipher.destroy()); this.retired.clear(); this.rekeyAt.clear();
    for (const wait of this.verificationWaits.values()) { clearTimeout(wait.timer); wait.reject(new Error('Bitchat stopped')); }
    this.verificationWaits.clear(); this.challengeNonces.clear();
    this.fragments.clear(); this.links.clear(); this.peers.clear(); this.seen.clear(); this.privateSeen.clear(); this.rates.clear();
    // Stop native writes so a stalled link cannot hold the bearer lease open.
    await this.transport.stopSessionAsync();
    await this.queue;
    await Promise.allSettled([...this.sends.values()]);
  }
}
