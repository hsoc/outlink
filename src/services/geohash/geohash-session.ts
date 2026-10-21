import { getEventHash, verifyEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import { createGeohashEvent, normalizeGeoRelays, validateGeohashEvent } from './geohash-protocol';
import { normalizeGeohash } from './geohash';

export type GeoMessage = { id: string; pubkey: string; name: string; content: string; timestamp: number;
  outgoing: boolean; delivery: 'queued' | 'sending' | 'sent' | 'failed' };
export interface GeoSocket {
  readyState: number;
  onopen: (() => void) | null; onclose: (() => void) | null; onerror: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  send(data: string): void; close(): void;
}
export type RelayMode = { subscription: string; filters(): Record<string, unknown>[]; event(value: unknown): void };
type Callbacks = { message(message: GeoMessage): void; delivery(id: string, status: 'queued' | 'sent' | 'failed'): void;
  connection(count: number): void; presence(count: number): void; participants?(participants: { name: string; identity: string }[]): void; error(): void };
type Link = { socket?: GeoSocket; timeout?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout>; opened: boolean; attempts: number;
  rateAt: number; rate: number };
type Pending = { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; rejected: Set<GeoSocket>; total: number };

/** Small NIP-01 transport for Bitchat kind-20000 chat and kind-20001 presence. */
export class GeohashSession {
  readonly hash: string;
  private publicKey: string;
  private ownPublicKeys = new Set<string>();
  private links: Link[] = [];
  private stopped = true;
  private heartbeat?: ReturnType<typeof setInterval>;
  private readonly seen = new Set<string>();
  private readonly present = new Map<string, number>();
  private readonly names = new Map<string, { name: string; at: number }>();
  private readonly pending = new Map<string, Pending>();
  constructor(hash: string, private key: Uint8Array, private name: string,
    private readonly relays: string[], private readonly callbacks: Callbacks,
    private readonly socket: (url: string) => GeoSocket = url => new WebSocket(url) as unknown as GeoSocket,
    private readonly mode?: RelayMode, private readonly fallback?: (event: Event) => Promise<boolean>) {
    this.hash = normalizeGeohash(hash); this.relays = normalizeGeoRelays(relays);
    this.publicKey = getPublicKey(key); this.ownPublicKeys.add(this.publicKey);
    if (!name.trim() || new TextEncoder().encode(name).length > 64) throw new Error('Invalid nickname');
  }
  rename(name: string): void {
    const value = name.trim();
    if (!value || new TextEncoder().encode(value).length > 64) throw new Error('Invalid nickname');
    this.name = value;
  }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.links = this.relays.map(() => ({ opened: false, attempts: 0, rateAt: 0, rate: 0 }));
    this.links.forEach((link, index) => this.connect(link, this.relays[index]));
    if (!this.mode) this.heartbeat = setInterval(() => {
      this.presence();
      this.reportPresence();
    }, 60_000);
  }
  replaceIdentity(key: Uint8Array, previous: string[] = []) {
    if (this.stopped || previous.length > 2) { key.fill(0); throw new Error('Channel identity unavailable'); }
    const next = getPublicKey(key), changed = next !== this.publicKey;
    this.key.fill(0); this.key = key; this.publicKey = next;
    this.ownPublicKeys = new Set([this.publicKey, ...previous]);
    for (const own of this.ownPublicKeys) this.present.delete(own);
    if (!this.mode) this.reportPresence();
    if (!this.mode && changed) this.presence();
  }
  updateRelays(input: string[]): void {
    const next = normalizeGeoRelays(input);
    if (JSON.stringify(next) === JSON.stringify(this.relays)) return;
    const old = new Map(this.relays.map((url, index) => [url, this.links[index]]));
    const removed = [...old].filter(([url]) => !next.includes(url));
    for (const [, link] of removed) if (link) {
      if (link.retry) clearTimeout(link.retry); if (link.timeout) clearTimeout(link.timeout);
      const socket = link.socket; link.socket = undefined; link.opened = false;
      if (socket) { socket.onopen = null; socket.onclose = null; socket.onerror = null; socket.onmessage = null; socket.close(); }
    }
    this.relays.splice(0, this.relays.length, ...next);
    if (this.stopped) return;
    this.links = next.map(url => old.get(url) ?? { opened: false, attempts: 0, rateAt: 0, rate: 0 });
    this.links.forEach((link, index) => { if (!link.socket && !link.retry) this.connect(link, next[index]); });
    this.connections();
  }
  private previousFilters = '';
  resubscribe(): void {
    if (!this.mode || this.stopped) return;
    const requested = this.mode.filters();
    const filters = JSON.stringify(requested.map(({ since: _since, until: _until, ...filter }) => filter)); if (filters === this.previousFilters) return;
    this.previousFilters = filters;
    for (const link of this.links) if (link.opened && link.socket && requested.length) {
      try { link.socket.send(JSON.stringify(['REQ', this.mode.subscription, ...requested])); } catch { this.callbacks.error(); }
    }
  }
  private reportPresence(): void {
    if (this.mode) return;
    const cutoff = Date.now() - 180_000;
    for (const [pubkey, at] of this.present) if (at < cutoff) this.present.delete(pubkey);
    for (const key of this.names.keys()) if (!this.present.has(key)) this.names.delete(key);
    this.callbacks.participants?.(this.links.some(link => link.opened) ? [...this.names].map(([identity, value]) => ({ identity, name: value.name })) : []);
    this.callbacks.presence(this.links.some(link => link.opened) ? this.present.size + 1 : 0);
  }
  private connections(): void {
    this.callbacks.connection(this.links.filter(l => l.opened).length);
    this.reportPresence();
  }
  private connect(link: Link, url: string): void {
    if (this.stopped) return;
    const retry = () => {
      if (this.stopped || link.retry) return;
      if (link.timeout) clearTimeout(link.timeout);
      link.opened = false; this.connections();
      link.retry = setTimeout(() => { link.retry = undefined; this.connect(link, url); },
        Math.min(30_000, 1000 * 2 ** Math.min(link.attempts++, 5)));
    };
    let socket: GeoSocket;
    try { socket = this.socket(url); link.socket = socket; } catch { retry(); return; }
    const current = () => !this.stopped && link.socket === socket;
    link.timeout = setTimeout(() => { if (current() && !link.opened) { socket.close(); retry(); } }, 10_000);
    socket.onopen = () => {
      if (!current()) return;
      if (link.timeout) clearTimeout(link.timeout);
      if (link.retry) { clearTimeout(link.retry); link.retry = undefined; }
      link.opened = true; link.attempts = 0; this.connections();
      try {
        const filters = this.mode?.filters() ?? [{ kinds: [20000, 20001], '#g': [this.hash], since: Math.floor(Date.now() / 1000) - 900, limit: 200 }];
        if (filters.length) socket.send(JSON.stringify(['REQ', this.mode?.subscription ?? 'geohash', ...filters]));
        if (!this.mode) this.presence(socket);
      } catch { socket.close(); retry(); }
    };
    socket.onclose = () => { if (current()) retry(); };
    socket.onerror = () => { if (current()) { socket.close(); retry(); } };
    socket.onmessage = ({ data }) => {
      if (!current() || !link.opened || typeof data !== 'string' || data.length > (this.mode ? 131072 : 32768)) return;
      const now = Date.now();
      if (now - link.rateAt >= 1000) { link.rateAt = now; link.rate = 0; }
      if (++link.rate > 32) return;
      let frame: unknown;
      try { frame = JSON.parse(data); } catch { return; }
      if (!Array.isArray(frame)) return;
      if (frame[0] === 'OK' && typeof frame[1] === 'string' && typeof frame[2] === 'boolean') {
        const pending = this.pending.get(frame[1]);
        if (!pending) return;
        if (frame[2]) pending.resolve();
        else { pending.rejected.add(socket); if (pending.rejected.size >= pending.total) pending.reject(new Error('Relays rejected the message')); }
        return;
      }
      if (frame[0] !== 'EVENT' || frame[1] !== (this.mode?.subscription ?? 'geohash')) return;
      if (this.mode) { try { this.mode.event(frame[2]); } catch { this.callbacks.error(); } return; }
      this.acceptEvent(frame[2]);
    };
  }
  acceptEvent(value: unknown): void {
    if (this.stopped || this.mode) return;
    const event = validateGeohashEvent(value, this.hash); if (!event || this.seen.has(event.id)) return;
    this.seen.add(event.id); if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    const now = Date.now(), activity = Math.min(now, event.created_at * 1000);
    if (!this.ownPublicKeys.has(event.pubkey) && activity >= now - 180_000) {
      if (!this.present.has(event.pubkey) && this.present.size >= 256) this.present.delete(this.present.keys().next().value!);
      this.present.set(event.pubkey, Math.max(this.present.get(event.pubkey) ?? 0, activity));
    }
    if (event.kind === 20000 && this.present.has(event.pubkey) && activity >= (this.names.get(event.pubkey)?.at ?? 0)) this.names.set(event.pubkey, { name: this.message(event, false).name, at: activity });
    this.reportPresence();
    if (event.kind === 20000) { const message = this.message(event, this.ownPublicKeys.has(event.pubkey)); message.delivery = 'sent'; this.callbacks.message(message); }
  }
  private message(event: Event, outgoing: boolean): GeoMessage {
    return { id: event.id, pubkey: event.pubkey, name: event.tags.find(t => t[0] === 'n')?.[1]?.slice(0, 64) || event.pubkey.slice(0, 8),
      content: event.content, timestamp: event.created_at * 1000, outgoing, delivery: outgoing ? 'sending' : 'sent' };
  }
  private presence(only?: GeoSocket): void {
    if (this.stopped) return;
    const data = JSON.stringify(['EVENT', createGeohashEvent(this.key, this.hash, this.name, '', true)]);
    for (const link of this.links) if (link.opened && link.socket && (!only || only === link.socket)) {
      try { link.socket.send(data); } catch { this.callbacks.error(); }
    }
  }
  async send(content: string): Promise<void> {
    if (this.stopped || this.pending.size >= 8) throw new Error('Channel is not ready');
    const sockets = this.links.filter(l => l.opened && l.socket?.readyState === 1).map(l => l.socket!);
    if (!sockets.length && !this.fallback) throw new Error('No relay is connected');
    const event = createGeohashEvent(this.key, this.hash, this.name, content);
    this.seen.add(event.id);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    this.callbacks.message(this.message(event, true));
    try {
      await this.publish(event);
      this.callbacks.delivery(event.id, 'sent');
    } catch (error) {
      if (this.fallback && await this.fallback(event)) { this.callbacks.delivery(event.id, 'queued'); return; }
      this.callbacks.delivery(event.id, 'failed'); throw error;
    }
  }
  async publish(event: Event): Promise<void> {
    if (this.stopped || this.pending.size >= 8 || getEventHash(event) !== event.id || !verifyEvent(event)) throw new Error('Relay is not ready or event is invalid');
    const sockets = this.links.filter(link => link.opened && link.socket?.readyState === 1).map(link => link.socket!);
    if (!sockets.length) throw new Error('No relay is connected');
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          const pending = this.pending.get(event.id); if (!pending) return;
          clearTimeout(pending.timer); this.pending.delete(event.id);
          if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('Relay acknowledgement timed out')), 8000);
        this.pending.set(event.id, { resolve: () => finish(), reject: error => finish(error), timer,
          rejected: new Set(), total: sockets.length });
        for (const socket of sockets) {
          try { socket.send(JSON.stringify(['EVENT', event])); }
          catch { const pending = this.pending.get(event.id); pending?.rejected.add(socket);
            if (pending && pending.rejected.size >= sockets.length) finish(new Error('Send failed')); }
        }
      });
  }
  stop(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const link of this.links) {
      if (link.retry) clearTimeout(link.retry);
      if (link.timeout) clearTimeout(link.timeout);
      if (link.socket) {
        link.socket.onopen = null; link.socket.onmessage = null; link.socket.onclose = null; link.socket.onerror = null;
        try { if (link.opened) link.socket.send(JSON.stringify(['CLOSE', this.mode?.subscription ?? 'geohash'])); } catch {}
        // A native close failure must not retain keys or skip the remaining relays.
        try { link.socket.close(); } catch {}
      }
    }
    for (const pending of [...this.pending.values()]) pending.reject(new Error('Channel closed'));
    this.links = []; this.key.fill(0); this.seen.clear(); this.present.clear(); this.names.clear();
    this.callbacks.participants?.([]);
    this.callbacks.connection(0); this.callbacks.presence(0);
  }
}
