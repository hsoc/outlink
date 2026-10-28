import { MESSAGE_WINDOW, messageIsFresh } from '@/lib/message-retention';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { mentionService } from '@/services/mentions/mentions';
import { privateMessageAlerts } from '@/services/mentions/private-messages';
import { ensureNickname, nicknameStore, validateNickname } from '@/services/preferences/nickname';
import { ChannelIdentities, clearIdentitySet, type ChannelIdentitySet } from './channel-identities';
import { GeoPrivateSession, type GeoThread } from './private-session';
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
import { encodeGeohash, normalizeGeohash } from './geohash';
import { GeohashSession, type GeoMessage } from './geohash-session';
export const DEFAULT_GEO_RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];
type State = { active: boolean; busy: boolean; hash: string; connected: number; present: number; participants: { name: string; identity: string }[]; messages: GeoMessage[]; privateMessages: BitchatMessage[]; privatePeers: string[]; privateThreads: (GeoThread & { blocked: boolean; migrating: boolean })[]; publicIdentity: string; rotatesAt: number; privateActive: boolean; privateConnected: number; error: boolean };
const empty: State = { active: false, busy: false, hash: '', connected: 0, present: 0, participants: [], messages: [], privateMessages: [], privatePeers: [], privateThreads: [], publicIdentity: '', rotatesAt: 0, privateActive: false, privateConnected: 0, error: false };
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
  isBlocked(key: string) {
    const thread = geohashStore.getState().privateThreads.find(t => t.peer === key || t.head === key || t.keys.includes(key));
    return [key, ...(thread?.keys ?? [])].some(id => blockedUsers.has('nostr:' + id));
  }
  meshFallback?: (event: Event, hash: string) => Promise<boolean>;
  acceptCarrier(event: Event, hash: string) { if (this.connection?.hash === hash) this.session?.acceptEvent(event); }
  connection?: { hash: string; name: string; relays: string[] };
  private historyVersion = 0;
  private privateSession?: GeoPrivateSession;
  private identities?: ChannelIdentities;
  private keySet?: ChannelIdentitySet;
  private identityTimer?: ReturnType<typeof setInterval>;
  private rotating?: Promise<void>;
  private readonly joining = new Set<Promise<void>>();
  private internetEpoch = 0;
  private readonly configuring = new Set<Promise<void>>();
  private closing: Promise<void> = Promise.resolve();
  async idle() { await Promise.allSettled([...this.joining, ...this.configuring, this.rotating]); await this.closing; }
  clearMessages(): void {
    ++this.historyVersion; this.before = undefined; this.privateBefore = undefined;
    geohashStore.setState({ messages: [], privateMessages: [], privatePeers: [], privateThreads: [] });
  }
  private before?: number;
  async restore(hash: string): Promise<void> {
    hash = normalizeGeohash(hash);
    const revision = this.revision;
    const version = this.historyVersion;
    const page = await loadMessages<GeoMessage>(`geo:${hash}`);
    const privatePage = await loadMessages<BitchatMessage>(`geo-private:${hash}`);
    const privatePeers = await readRecords<GeoThread>(`geo:${hash}:geo-peers`, 100);
    if (version !== this.historyVersion || revision !== this.revision) return;
    this.before = page.before; this.privateBefore = privatePage.before;
    geohashStore.setState({ hash, messages: page.messages, privateMessages: privatePage.messages, privatePeers: privatePeers.map(p => p.peer), privateThreads: privatePeers.map(p => ({ peer: p.peer, head: p.head ?? p.peer, keys: p.keys ?? [p.peer], local: p.local ?? '', blocked: false, migrating: false })) });
    await this.privateSession?.refreshThreads();
  }
  async older(): Promise<void> {
    if (!this.before) return;
    const hash = geohashStore.getState().hash;
    const version = this.historyVersion;
    const page = await loadMessages<GeoMessage>(`geo:${hash}`, this.before);
    if (version !== this.historyVersion || hash !== geohashStore.getState().hash) return;
    this.before = page.before;
    geohashStore.setState(state => ({ messages: [...page.messages, ...state.messages].slice(0, MESSAGE_WINDOW) }));
  }
  private session?: GeohashSession;
  private directoryTimer?: ReturnType<typeof setInterval>;
  private relayEpoch = 0;
  private revision = 0;
  rename(name: string): void {
    const value = validateNickname(name);
    this.session?.rename(value);
    if (this.connection) this.connection.name = value;
  }
  join(input: string, name: string, relayInput: string[]): Promise<void> {
    const operation = this.joinInternal(input, name, relayInput); this.joining.add(operation);
    void operation.finally(() => this.joining.delete(operation)).catch(() => {}); return operation;
  }
  private async joinInternal(input: string, name: string, relayInput: string[]): Promise<void> {
    const hash = normalizeGeohash(input); let relays = normalizeGeoRelays(relayInput);
    this.stop(); const revision = ++this.revision;
    await this.closing;
    await blockedUsers.restore();
    await this.restore(hash);
    if (revision !== this.revision) return;
    const preferences = JSON.parse(await platform.preferences.getItem('mobile.workspace') ?? '{}');
    const automatic = preferences.autoAreaRelays !== false;
    if (revision !== this.revision) return;
    if (automatic) { await refreshAreaRelays(); relays = areaRelays(hash); }
    if (revision !== this.revision) return;
    geohashStore.setState({ busy: true, hash, error: false });
    try {
      const root = await mobileIdentity();
      if (revision !== this.revision) return;
      const identities = new ChannelIdentities(platform.secureStorage, root), master = hexToBytes(root);
      const legacy = channelKey(master, hash); master.fill(0);
      const keys = await identities.load(hash, legacy);
      if (revision !== this.revision) { clearIdentitySet(keys); return; }
      try { name = await ensureNickname(); }
      catch (error) { clearIdentitySet(keys); throw error; }
      if (revision !== this.revision) { clearIdentitySet(keys); return; }
      this.identities = identities; this.keySet = keys;
      const key = keys.current.key.slice();
      geohashStore.setState({ publicIdentity: keys.current.pubkey, rotatesAt: keys.rotateAt });
      const current = () => revision === this.revision;
      this.session = new GeohashSession(hash, key, name, relays, {
        message: message => {
          if (!current() || !messageIsFresh(message) || !message.outgoing && this.isBlocked(message.pubkey) || geohashStore.getState().messages.some(m => m.id === message.id)) return;
          mentionService.received(message, 'geo', hash, message.id, [geohashStore.getState().publicIdentity]);
          geohashStore.setState(state => {
            const messages = [...state.messages, message].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)).slice(-MESSAGE_WINDOW);
            return { messages };
          });
        },
        delivery: (id, delivery) => { if (current()) geohashStore.setState(state => ({ messages: state.messages.map(m => m.id === id ? { ...m, delivery } : m) })); },
        connection: connected => { if (current()) geohashStore.setState({ connected }); },
        participants: participants => { if (current()) geohashStore.setState({ participants }); },
        presence: present => { if (current()) geohashStore.setState({ present }); },
        error: () => { if (current()) geohashStore.setState({ error: true }); },
      }, undefined, undefined, event => this.meshFallback?.(event, hash) ?? Promise.resolve(false));
      this.connection = { hash, name, relays };
      this.rename(nicknameStore.getState().name || name);
      this.session.start();
      this.session.replaceIdentity(keys.current.key.slice(), keys.retired.map(e => e.pubkey));
      this.identityTimer = setInterval(() => { void this.checkIdentity().catch(() => geohashStore.setState({ error: true })); }, 60000);
      if (preferences.internet) await this.enableInternet(true);
      if (!current()) return;
      await this.configureRelays(automatic, relays);
      if (!current()) return;
      geohashStore.setState({ active: true, busy: false });
    } catch (error) { if (revision === this.revision) { this.stop(); geohashStore.setState({ error: true }); } throw error; }
  }
  checkIdentity(): Promise<void> {
    if (this.rotating) return this.rotating;
    const operation = this.refreshIdentity().finally(() => { if (this.rotating === operation) this.rotating = undefined; });
    this.rotating = operation; return operation;
  }
  private async refreshIdentity() {
    const manager = this.identities, connection = this.connection, revision = this.revision;
    if (!manager || !connection || !this.keySet) return;
    const keys = await manager.load(connection.hash);
    if (revision !== this.revision || connection !== this.connection) { clearIdentitySet(keys); return; }
    const old = this.keySet, changed = old.current.pubkey !== keys.current.pubkey || old.retired.map(e => e.pubkey).join() !== keys.retired.map(e => e.pubkey).join();
    this.keySet = keys;
    try {
      if (changed) {
        this.session?.replaceIdentity(keys.current.key.slice(), keys.retired.map(e => e.pubkey));
        await this.privateSession?.replaceIdentities(keys);
      }
      if (revision === this.revision) geohashStore.setState({ publicIdentity: keys.current.pubkey, rotatesAt: keys.rotateAt });
    } finally { clearIdentitySet(old); }
  }
  privatePeer(key: string) { const thread = geohashStore.getState().privateThreads.find(t => t.peer === key || t.head === key || t.keys.includes(key)); return thread?.peer ?? key; }
  async useCurrentIdentity(peer: string) { await this.privateSession?.useCurrentIdentity(peer); }
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
    await this.rotating;
    if (revision !== this.revision || epoch !== this.internetEpoch || !this.keySet) return;
    const hash = connection.hash, identities = this.keySet, key = identities.current.key.slice();
    const current = () => revision === this.revision && epoch === this.internetEpoch;
    const scope = (value: string) => `geo:${hash}:${value}`;
    const records = {
      get: <T,>(s: string, id: string) => readRecord<T>(scope(s), id),
      list: <T,>(s: string, n: number) => readRecords<T>(scope(s), n),
      put: (s: string, id: string, value: unknown) => putRecord(scope(s), id, value),
      remove: (s: string, id: string) => removeRecord(scope(s), id),
    };
    this.privateSession = new GeoPrivateSession(key, connection.relays, {
      records, hash, legacyPubkey: identities.legacyPubkey,
      threads: threads => { if (current()) geohashStore.setState({ privateThreads: threads, privatePeers: threads.map(t => t.peer) }); },
      outbox: { list: peer => readRecords<PendingMessage>(scope(`outbox:${peer}`), 100),
        get: (peer, id) => readRecord<PendingMessage>(scope(`outbox:${peer}`), id),
        put: (peer, id, value) => putRecord(scope(`outbox:${peer}`), id, value), remove: (peer, id) => removeRecord(scope(`outbox:${peer}`), id) },
      get: async id => { const row = await historyOperation(() => platform.history.get(`geo-private:${hash}`, id)); return row ? JSON.parse(row) : null; },
      save: message => saveMessage(`geo-private:${hash}`, message.id + message.peer, message),
      blocked: (sender, aliases = []) => [sender, ...aliases].some(key => this.isBlocked(key)),
      received: message => { if (current() && messageIsFresh(message)) privateMessageAlerts.received(message, 'geo', hash); },
      changed: message => {
        if (!current() || !messageIsFresh(message)) return;
        geohashStore.setState(state => {
          const peer = message.channelThread ?? (message.outgoing ? message.recipient! : message.peer);
          const messages = state.privateMessages.filter(m => m.id !== message.id || m.peer !== message.peer);
          messages.push(message); messages.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
          return { privateMessages: messages.slice(-MESSAGE_WINDOW), privatePeers: state.privatePeers.includes(peer) ? state.privatePeers : [...state.privatePeers, peer] };
        });
      },
      connection: count => { if (current()) geohashStore.setState({ privateConnected: count }); },
      error: () => { if (current()) geohashStore.setState({ error: true }); },
    }, undefined, identities);
    this.privateSession.start(); geohashStore.setState({ privateActive: true });
  }
  async sendPrivate(peer: string, content: string) {
    if (!this.privateSession) throw new Error('Enable internet private messages first');
    await this.checkIdentity();
    const session = this.privateSession;
    if (!session) throw new Error('Private channel stopped');
    const name = await ensureNickname();
    if (this.privateSession !== session) throw new Error('Private channel changed');
    await session.send(peer, content, name);
  }
  async readPrivate(peer: string, id: string, sender?: string) { await this.privateSession?.read(peer, id, sender); }
  async olderPrivate() {
    const hash = geohashStore.getState().hash, version = this.historyVersion;
    if (!this.privateBefore) return;
    const page = await loadMessages<BitchatMessage>(`geo-private:${hash}`, this.privateBefore);
    if (version !== this.historyVersion || hash !== geohashStore.getState().hash) return;
    this.privateBefore = page.before;
    geohashStore.setState(state => { const entries = new Map(state.privateMessages.map(m => [m.id + m.peer, m])); for (const m of page.messages) if (!entries.has(m.id + m.peer)) entries.set(m.id + m.peer, m); return { privateMessages: [...entries.values()].sort((a, b) => a.timestamp - b.timestamp).slice(0, MESSAGE_WINDOW) }; });
  }
  private privateBefore?: number;
  async send(content: string): Promise<void> {
    await this.checkIdentity();
    const session = this.session;
    if (!session) throw new Error('No location channel selected');
    const name = await ensureNickname();
    if (this.session !== session) throw new Error('Location channel changed');
    this.rename(name);
    await session.send(content);
  }
  stop(): void {
    this.connection = undefined;
    if (this.identityTimer) clearInterval(this.identityTimer); this.identityTimer = undefined;
    const identityManager = this.identities; this.identities = undefined;
    clearIdentitySet(this.keySet); this.keySet = undefined;
    ++this.internetEpoch; ++this.relayEpoch;
    const privateSession = this.privateSession; this.privateSession = undefined; privateSession?.stop();
    this.closing = Promise.allSettled([this.closing, privateSession?.idle(), identityManager?.idle(), this.rotating, stopRelayRefresh()]).then(() => {});
    geohashStore.setState({ privateActive: false, privateConnected: 0, publicIdentity: '', rotatesAt: 0 });
    if (this.directoryTimer) clearInterval(this.directoryTimer); this.directoryTimer = undefined;
    ++this.revision;
    this.session?.stop(); this.session = undefined;
    geohashStore.setState(state => ({ active: false, busy: false, connected: 0, present: 0, participants: [], messages: state.messages.map(message => message.delivery === 'sending' ? { ...message, delivery: 'failed' as const } : message) }));
  }
  async nearby(precision: number): Promise<{ hash: string; neighborhood: string }> {
    if (!Number.isInteger(precision) || precision < 1 || precision > 12) throw new Error('Invalid geohash precision');
    const { latitude, longitude } = await platform.location.currentCoordinates();
    const precise = encodeGeohash(latitude, longitude, Math.max(6, precision));
    return { hash: precise.slice(0, precision), neighborhood: precise.slice(0, 6) };
  }
}
export const geohashService = new GeohashService();
