import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { ProximityTransportPort, ProximityTransportSubscription } from '@/platform';
import { BitchatCipher, BitchatHandshake } from './bitchat-noise';
import { BitchatFragments, fragmentPacket } from './bitchat-fragments';
import { BITCHAT_TTL, BitchatType, bytes, decodePacket, decodeTlv, encodeTlv, join,
  packetId, peerId, signPacket, text, verifyPacket, type BitchatPacket } from './bitchat-wire';

export type BitchatIdentity = { noiseSeed: Uint8Array; noisePublicKey: Uint8Array; signingSeed: Uint8Array };
export type BitchatPeer = { id: string; name: string; fingerprint: string; lastSeen: number; secure: boolean };
export type BitchatMessage = { id: string; peer: string; recipient?: string; name: string; content: string;
  timestamp: number; outgoing: boolean; delivery: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' };
type KnownPeer = BitchatPeer & { ingress: string; noiseKey: Uint8Array; signingKey: Uint8Array };
type Negotiation = { handshake: BitchatHandshake; at: number; promise: Promise<void>;
  resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Callbacks = { peer: (peer: BitchatPeer) => void; message: (message: BitchatMessage) => void;
  receipt: (id: string, sender: string, status: 'sent' | 'delivered' | 'read' | 'failed') => void; error: (error: Error) => void };

/** MIT implementation of the Bitchat bearer/session rules, with bounded ephemeral state. */
export class BitchatSession {
  readonly id: string;
  private readonly signingKey: Uint8Array;
  private readonly peers = new Map<string, KnownPeer>();
  private readonly links = new Set<string>();
  private readonly seen = new Map<string, number>();
  private readonly privateSeen = new Map<string, number>();
  private readonly ciphers = new Map<string, { cipher: BitchatCipher; at: number }>();
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
  private readonly outboundTimes = new Map<string, number[]>();
  private readonly sendWaits = new Map<string, { timer: ReturnType<typeof setTimeout>; resolve(): void }>();
  constructor(private readonly transport: ProximityTransportPort, private readonly identity: BitchatIdentity,
    private readonly name: string, private readonly callbacks: Callbacks,
    private readonly random: (length: number) => Uint8Array) {
    if (!name.trim() || bytes(name).length > 64) throw new Error('Bitchat name must fit 64 UTF-8 bytes');
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
        this.links.delete(e.endpointId); this.outboundTimes.delete(e.endpointId);
        const wait = this.sendWaits.get(e.endpointId);
        if (wait) { clearTimeout(wait.timer); wait.resolve(); this.sendWaits.delete(e.endpointId); }
        // A returned peer keeps its identity, but may have discarded its ephemeral Noise state.
        for (const peer of this.peers.values()) if (peer.ingress === e.endpointId) {
          this.ciphers.get(peer.id)?.cipher.destroy(); this.ciphers.delete(peer.id);
          this.failHandshake(peer.id, new Error('Bitchat peer disconnected'));
          peer.lastSeen = 0; peer.secure = false; this.callbacks.peer(peer);
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
        this.queue = this.queue.then(async () => { if (this.running) await this.receive(wire, endpoint); })
          .catch(() => { /* Reject malformed or unauthenticated radio traffic silently. */ }).finally(() => { this.queued--; });
      }),
    ];
    try {
      await this.transport.startAdvertisingAsync(new Uint8Array());
      await this.transport.startScanAsync(0);
      this.tick();
    } catch (error) { await this.stop(); throw error; }
  }
  private tick(): void {
    if (!this.running) return;
    void this.broadcast(this.announcement()).catch((error) => this.report(error));
    const now = Date.now();
    for (const [key, value] of this.seen) if (now - value > 300_000) this.seen.delete(key);
    for (const [key, value] of this.privateSeen) if (now - value > 6 * 3600_000) this.privateSeen.delete(key);
    for (const peer of this.peers.values()) if (peer.lastSeen && now - peer.lastSeen > 60_000) {
      peer.lastSeen = 0; peer.secure = false; this.callbacks.peer(peer);
      this.ciphers.get(peer.id)?.cipher.destroy(); this.ciphers.delete(peer.id);
    }
    for (const [key, entry] of this.ciphers) if (now - entry.at > 3600_000) {
      entry.cipher.destroy(); this.ciphers.delete(key);
      const peer = this.peers.get(key); if (peer) { peer.secure = false; this.callbacks.peer(peer); }
    }
    this.timer = setTimeout(() => this.tick(), this.links.size ? 15_000 : 4000);
  }
  private packet(type: number, payload: Uint8Array, recipient?: string): BitchatPacket {
    return { version: 1, type, ttl: BITCHAT_TTL, timestamp: Date.now(), sender: this.id, recipient, payload };
  }
  private announcement(): BitchatPacket {
    return signPacket(this.packet(BitchatType.announce, encodeTlv([
      [1, bytes(this.name)], [2, this.identity.noisePublicKey], [3, this.signingKey], [5, Uint8Array.of(0)],
    ])), this.identity.signingSeed);
  }
  private async broadcast(packet: BitchatPacket, exclude?: string, only?: string): Promise<void> {
    if (!this.running) throw new Error('Bitchat is stopped');
    const targets = [...this.links].filter((link) => link !== exclude && (!only || only === link));
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
  async sendPublic(content: string): Promise<void> {
    if (!content.trim() || bytes(content).length > 255) throw new Error('Message must fit 255 UTF-8 bytes');
    const packet = signPacket(this.packet(BitchatType.message, bytes(content)), this.identity.signingSeed);
    await this.broadcast(packet); this.remember(this.seen, packetId(packet));
    this.callbacks.message({ id: packetId(packet), peer: this.id, name: this.name, content,
      timestamp: packet.timestamp, outgoing: true, delivery: 'sent' });
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
  private async ensureCipher(peer: string): Promise<BitchatCipher> {
    const known = this.peers.get(peer);
    if (!known || Date.now() - known.lastSeen > 60_000) throw new Error('Bitchat peer is offline');
    if (this.ciphers.has(peer)) return this.ciphers.get(peer)!.cipher;
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
  async markRead(peer: string, messageId: string): Promise<void> {
    const cipher = this.ciphers.get(peer)?.cipher;
    if (cipher && bytes(messageId).length <= 255)
      await this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(join(Uint8Array.of(2), bytes(messageId))), peer));
  }
  private async receive(wire: Uint8Array, ingress: string): Promise<void> {
    const inflate = this.transport.inflateRawAsync?.bind(this.transport);
    let packet = await decodePacket(wire, inflate);
    if (!this.running) return;
    if (packet.sender === this.id || Math.abs(Date.now() - packet.timestamp) > 6 * 3600_000) return;
    const incomingId = packetId(packet);
    if (!this.remember(this.seen, incomingId)) {
      const scheduled = this.relays.get(incomingId);
      if (scheduled) { clearTimeout(scheduled); this.relays.delete(incomingId); }
      return;
    }
    const reassembled = packet.type === BitchatType.fragment;
    if (reassembled) {
      // Each shard is floodable, but complete packets are authenticated before display.
      if (packet.ttl > 0) this.forward(packet, ingress);
      const complete = await this.fragments.accept(packet, Date.now(), inflate);
      if (!complete || !this.running) return; packet = complete;
      if (!this.remember(this.seen, packetId(packet))) return;
    }
    if (packet.type === BitchatType.announce) {
      if (Math.abs(Date.now() - packet.timestamp) > 60_000) return;
      const f = decodeTlv(packet.payload), name = text(f.get(1) ?? new Uint8Array());
      const noiseKey = f.get(2), signingKey = f.get(3);
      if (!name.trim() || bytes(name).length > 255 || !noiseKey || !signingKey || signingKey.length !== 32 ||
          peerId(noiseKey) !== packet.sender || !verifyPacket(packet, signingKey)) return;
      const previous = this.peers.get(packet.sender);
      if (previous && (!previous.noiseKey.every((v, i) => v === noiseKey[i]) ||
          !previous.signingKey.every((v, i) => v === signingKey[i]))) return;
      if (!previous && this.peers.size >= 256) return;
      const peer: KnownPeer = { id: packet.sender, name, noiseKey, signingKey, ingress,
        fingerprint: bytesToHex(sha256(noiseKey)), lastSeen: Date.now(), secure: this.ciphers.has(packet.sender) };
      this.peers.set(packet.sender, peer); this.callbacks.peer(peer);
    } else if ((packet.type === BitchatType.message || packet.type === BitchatType.leave)) {
      const known = this.peers.get(packet.sender);
      if (!known || !verifyPacket(packet, known.signingKey)) return;
      if (packet.type === BitchatType.message) {
        const content = text(packet.payload);
        if (content.trim() && !packet.recipient) this.callbacks.message({ id: packetId(packet),
          peer: packet.sender, name: known.name, content, timestamp: packet.timestamp, outgoing: false, delivery: 'sent' });
      } else { known.lastSeen = 0; known.secure = false; this.callbacks.peer(known);
        this.ciphers.get(packet.sender)?.cipher.destroy(); this.ciphers.delete(packet.sender); }
    } else if (packet.type !== BitchatType.handshake && packet.type !== BitchatType.encrypted) return;
    if (packet.recipient === this.id) {
      if (packet.type === BitchatType.handshake) await this.receiveHandshake(packet);
      if (packet.type === BitchatType.encrypted) await this.receivePrivate(packet);
      return;
    }
    if (!reassembled && packet.ttl > 0) this.forward(packet, ingress);
  }
  private forward(packet: BitchatPacket, ingress: string): void {
    if (this.relays.size >= 128) return;
    const key = packetId(packet);
    const ttl = Math.min(packet.ttl - 1, !packet.recipient && this.links.size >= 6 ? 5 : BITCHAT_TTL);
    const timer = setTimeout(() => {
      this.relays.delete(key);
      if (this.running) void this.broadcast({ ...packet, ttl }, ingress).catch(() => {});
    }, 10 + this.random(1)[0] % 211);
    this.relays.set(key, timer);
  }
  private async receiveHandshake(packet: BitchatPacket): Promise<void> {
    const peer = this.peers.get(packet.sender); if (!peer) return;
    let entry = this.negotiations.get(peer.id);
    try {
      if (packet.payload.length === 32) {
        if (entry?.handshake.initiator && this.id < peer.id) return;
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
      this.ciphers.get(peer.id)?.cipher.destroy();
      this.ciphers.set(peer.id, { cipher, at: Date.now() });
      clearTimeout(entry.timer); this.negotiations.delete(peer.id);
      peer.secure = true; this.callbacks.peer(peer); entry.resolve();
      // Bind the signing key to the Noise-authenticated identity for newer clients.
      const state = join(Uint8Array.of(0x21, 1), encodeTlv([[1, Uint8Array.of(0)], [2, this.signingKey]]));
      await this.broadcast(this.packet(BitchatType.encrypted, cipher.seal(state), peer.id));
    } catch (error) { this.failHandshake(peer.id, error as Error); throw error; }
  }
  private async receivePrivate(packet: BitchatPacket): Promise<void> {
    const peer = this.peers.get(packet.sender), cipher = this.ciphers.get(packet.sender)?.cipher;
    if (!peer || !cipher) return;
    const plain = cipher.open(packet.payload);
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
    } else if (plain[0] === 0x21) {
      if (plain[1] !== 1) return;
      const key = decodeTlv(plain.subarray(2)).get(2);
      if (!key || key.length !== 32) throw new Error('Invalid Bitchat authenticated signing key');
      // A self-signed public announcement cannot prove possession of its Noise
      // key. The encrypted state is authoritative after XX authenticates that key.
      peer.signingKey = key.slice();
      this.callbacks.peer(peer);
    }
  }
  async stop(): Promise<void> {
    this.running = false; if (this.timer) clearTimeout(this.timer);
    this.relays.forEach(clearTimeout); this.relays.clear();
    for (const wait of this.sendWaits.values()) { clearTimeout(wait.timer); wait.resolve(); }
    this.sendWaits.clear(); this.outboundTimes.clear();
    this.subscriptions.forEach((s) => s.remove()); this.subscriptions = [];
    for (const key of this.negotiations.keys()) this.failHandshake(key, new Error('Bitchat stopped'));
    this.ciphers.forEach((v) => v.cipher.destroy()); this.ciphers.clear();
    this.fragments.clear(); this.links.clear(); this.peers.clear(); this.seen.clear(); this.privateSeen.clear(); this.rates.clear();
    // Stop native writes so a stalled link cannot hold the bearer lease open.
    await this.transport.stopSessionAsync();
    await this.queue;
    await Promise.allSettled([...this.sends.values()]);
    await this.transport.configureProtocolAsync?.('nearby');
  }
}
