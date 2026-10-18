import { GeoPrivateSession } from './private-session';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { PendingMessage } from '@/services/bitchat/compatibility/outbox';
import { putRecord, readRecord, readRecords, removeRecord } from '@/services/bitchat/compatibility/storage';
import { refreshAreaRelays, stopRelayRefresh } from './relay-refresh';
import { areaRelays } from './relay-directory';
import type { Event } from 'nostr-tools/pure';
import { loadMessages, saveMessage, historyOperation } from '@/services/history/history';
import { createStore } from 'zustand/vanilla';
import { hexToBytes } from '@noble/hashes/utils.js';
import { platform } from '@/platform';
import { mobileIdentity } from '@/services/bitchat/mobile-identity';
import { channelKey, normalizeGeoRelays } from './geohash-protocol';
import { normalizeGeohash } from './geohash';
import { GeohashSession, type GeoMessage } from './geohash-session';
export const DEFAULT_GEO_RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];
type State = { active: boolean; busy: boolean; hash: string; connected: number; present: number; messages: GeoMessage[]; privateMessages: BitchatMessage[]; privatePeers: string[]; privateActive: boolean; privateConnected: number; error: boolean };
const empty: State = { active: false, busy: false, hash: '', connected: 0, present: 0, messages: [], privateMessages: [], privatePeers: [], privateActive: false, privateConnected: 0, error: false };
export const geohashStore = createStore<State>(() => empty);
geohashStore.subscribe((state, previous) => {
  if (state.messages === previous.messages) return;
  const old = new Map(previous.messages.map(message => [message.id + ('peer' in message ? message.peer : ''), message]));
  for (const message of state.messages) {
    const id = message.id + ('peer' in message ? message.peer : '');
    if (old.get(id) !== message) void saveMessage(`geo:${state.hash}`, id, message).catch(() => geohashStore.setState({ error: true }));
  }
});
class GeohashService {
  meshFallback?: (event: Event, hash: string) => Promise<boolean>;
  acceptCarrier(event: Event, hash: string) { if (this.connection?.hash === hash) this.session?.acceptEvent(event); }
  connection?: { hash: string; name: string; relays: string[] };
  private historyVersion = 0;
  private privateSession?: GeoPrivateSession;
  private internetEpoch = 0;
  private readonly configuring = new Set<Promise<void>>();
  private closing: Promise<void> = Promise.resolve();
  async idle() { await Promise.allSettled([...this.configuring]); await this.closing; }
  clearMessages(): void {
    ++this.historyVersion; this.before = undefined; this.privateBefore = undefined;
    geohashStore.setState({ messages: [], privateMessages: [], privatePeers: [] });
  }
  private before?: number;
  async restore(hash: string): Promise<void> {
    hash = normalizeGeohash(hash);
    const revision = this.revision;
    const version = this.historyVersion;
    const page = await loadMessages<GeoMessage>(`geo:${hash}`);
    const privatePage = await loadMessages<BitchatMessage>(`geo-private:${hash}`);
    const privatePeers = await readRecords<{ peer: string }>(`geo:${hash}:geo-peers`, 100);
    if (version !== this.historyVersion || revision !== this.revision) return;
    this.before = page.before; this.privateBefore = privatePage.before;
    geohashStore.setState({ hash, messages: page.messages, privateMessages: privatePage.messages, privatePeers: privatePeers.map(p => p.peer) });
  }
  async older(): Promise<void> {
    if (!this.before) return;
    const hash = geohashStore.getState().hash;
    const version = this.historyVersion;
    const page = await loadMessages<GeoMessage>(`geo:${hash}`, this.before);
    if (version !== this.historyVersion || hash !== geohashStore.getState().hash) return;
    this.before = page.before;
    geohashStore.setState(state => ({ messages: [...page.messages, ...state.messages].slice(0, 500) }));
  }
  private session?: GeohashSession;
  private directoryTimer?: ReturnType<typeof setInterval>;
  private relayEpoch = 0;
  private revision = 0;
  async join(input: string, name: string, relayInput: string[]): Promise<void> {
    const hash = normalizeGeohash(input); let relays = normalizeGeoRelays(relayInput);
    if (!name.trim() || new TextEncoder().encode(name).length > 64) throw new Error('Invalid nickname');
    this.stop(); const revision = ++this.revision;
    await this.closing;
    await this.restore(hash);
    if (revision !== this.revision) return;
    const preferences = JSON.parse(await platform.preferences.getItem('mobile.workspace') ?? '{}');
    const automatic = preferences.autoAreaRelays !== false;
    if (revision !== this.revision) return;
    if (automatic) { await refreshAreaRelays(); relays = areaRelays(hash); }
    if (revision !== this.revision) return;
    geohashStore.setState({ busy: true, hash, error: false });
    try {
      const master = hexToBytes(await mobileIdentity());
      const key = channelKey(master, hash); master.fill(0);
      if (revision !== this.revision) { key.fill(0); return; }
      const current = () => revision === this.revision;
      this.session = new GeohashSession(hash, key, name, relays, {
        message: message => {
          if (!current()) return;
          geohashStore.setState(state => {
            if (state.messages.some(m => m.id === message.id)) return state;
            const messages = [...state.messages, message].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)).slice(-500);
            return { messages };
          });
        },
        delivery: (id, delivery) => { if (current()) geohashStore.setState(state => ({ messages: state.messages.map(m => m.id === id ? { ...m, delivery } : m) })); },
        connection: connected => { if (current()) geohashStore.setState({ connected }); },
        presence: present => { if (current()) geohashStore.setState({ present }); },
        error: () => { if (current()) geohashStore.setState({ error: true }); },
      }, undefined, undefined, event => this.meshFallback?.(event, hash) ?? Promise.resolve(false));
      this.connection = { hash, name, relays };
      this.session.start();
      if (preferences.internet) await this.enableInternet(true);
      if (!current()) return;
      await this.configureRelays(automatic, relays);
      if (!current()) return;
      geohashStore.setState({ active: true, busy: false });
    } catch (error) { if (revision === this.revision) { this.stop(); geohashStore.setState({ error: true }); } throw error; }
  }
  async configureRelays(automatic: boolean, custom: string[]) {
    const epoch = ++this.relayEpoch, revision = this.revision, connection = this.connection;
    if (this.directoryTimer) clearInterval(this.directoryTimer); this.directoryTimer = undefined;
    if (!automatic) await stopRelayRefresh();
    if (!connection) return;
    if (automatic) await refreshAreaRelays();
    if (epoch !== this.relayEpoch || revision !== this.revision) return;
    const relays = automatic ? areaRelays(connection.hash) : normalizeGeoRelays(custom);
    this.session?.updateRelays(relays); this.privateSession?.updateRelays(relays); connection.relays = relays;
    if (automatic) this.directoryTimer = setInterval(() => { void this.configureRelays(true, relays).catch(() => geohashStore.setState({ error: true })); }, 3600000);
  }
  enableInternet(enabled: boolean) {
    const epoch = ++this.internetEpoch;
    const operation = this.configureInternet(enabled, epoch); this.configuring.add(operation);
    void operation.finally(() => this.configuring.delete(operation)).catch(() => {}); return operation;
  }
  private async configureInternet(enabled: boolean, epoch: number) {
    const old = this.privateSession; this.privateSession = undefined; old?.stop(); await old?.idle();
    if (epoch !== this.internetEpoch) return;
    geohashStore.setState({ privateActive: false, privateConnected: 0 });
    const connection = this.connection, revision = this.revision;
    if (!enabled || !connection || epoch !== this.internetEpoch) return;
    const hash = connection.hash, master = hexToBytes(await mobileIdentity());
    const key = channelKey(master, hash); master.fill(0);
    if (revision !== this.revision || epoch !== this.internetEpoch) { key.fill(0); return; }
    const current = () => revision === this.revision && epoch === this.internetEpoch;
    const scope = (value: string) => `geo:${hash}:${value}`;
    const records = {
      get: <T,>(s: string, id: string) => readRecord<T>(scope(s), id),
      list: <T,>(s: string, n: number) => readRecords<T>(scope(s), n),
      put: (s: string, id: string, value: unknown) => putRecord(scope(s), id, value),
      remove: (s: string, id: string) => removeRecord(scope(s), id),
    };
    this.privateSession = new GeoPrivateSession(key, connection.relays, {
      records,
      outbox: { list: peer => readRecords<PendingMessage>(scope(`outbox:${peer}`), 100),
        get: (peer, id) => readRecord<PendingMessage>(scope(`outbox:${peer}`), id),
        put: (peer, id, value) => putRecord(scope(`outbox:${peer}`), id, value), remove: (peer, id) => removeRecord(scope(`outbox:${peer}`), id) },
      get: async id => { const row = await historyOperation(() => platform.history.get(`geo-private:${hash}`, id)); return row ? JSON.parse(row) : null; },
      save: message => saveMessage(`geo-private:${hash}`, message.id + message.peer, message),
      changed: message => {
        if (!current()) return;
        geohashStore.setState(state => {
          const peer = message.outgoing ? message.recipient! : message.peer;
          const messages = state.privateMessages.filter(m => m.id !== message.id || m.peer !== message.peer);
          messages.push(message); messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
          return { privateMessages: messages.slice(-500), privatePeers: state.privatePeers.includes(peer) ? state.privatePeers : [...state.privatePeers, peer] };
        });
      },
      connection: count => { if (current()) geohashStore.setState({ privateConnected: count }); },
      error: () => { if (current()) geohashStore.setState({ error: true }); },
    });
    this.privateSession.start(); geohashStore.setState({ privateActive: true });
  }
  async sendPrivate(peer: string, content: string) {
    if (!this.privateSession) throw new Error('Enable internet private messages first');
    await this.privateSession.send(peer, content);
  }
  async readPrivate(peer: string, id: string) { await this.privateSession?.read(peer, id); }
  async olderPrivate() {
    const hash = geohashStore.getState().hash, version = this.historyVersion;
    if (!this.privateBefore) return;
    const page = await loadMessages<BitchatMessage>(`geo-private:${hash}`, this.privateBefore);
    if (version !== this.historyVersion || hash !== geohashStore.getState().hash) return;
    this.privateBefore = page.before;
    geohashStore.setState(state => { const entries = new Map(state.privateMessages.map(m => [m.id + m.peer, m])); for (const m of page.messages) if (!entries.has(m.id + m.peer)) entries.set(m.id + m.peer, m); return { privateMessages: [...entries.values()].sort((a, b) => a.timestamp - b.timestamp).slice(0, 500) }; });
  }
  private privateBefore?: number;
  async send(content: string): Promise<void> {
    if (!this.session) throw new Error('No location channel selected');
    await this.session.send(content);
  }
  stop(): void {
    this.connection = undefined; ++this.internetEpoch; ++this.relayEpoch;
    const privateSession = this.privateSession; this.privateSession = undefined; privateSession?.stop();
    this.closing = Promise.allSettled([this.closing, privateSession?.idle(), stopRelayRefresh()]).then(() => {});
    geohashStore.setState({ privateActive: false, privateConnected: 0 });
    if (this.directoryTimer) clearInterval(this.directoryTimer); this.directoryTimer = undefined;
    ++this.revision;
    this.session?.stop(); this.session = undefined;
    geohashStore.setState(state => ({ active: false, busy: false, connected: 0, present: 0, messages: state.messages.map(message => message.delivery === 'sending' ? { ...message, delivery: 'failed' as const } : message) }));
  }
  async nearby(precision: number): Promise<string> {
    const { encodeGeohash } = await import('./geohash');
    const { latitude, longitude } = await platform.location.currentCoordinates();
    return encodeGeohash(latitude, longitude, precision);
  }
}
export const geohashService = new GeohashService();
