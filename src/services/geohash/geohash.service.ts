import { loadMessages, saveMessage } from '@/services/history/history';
import { createStore } from 'zustand/vanilla';
import { hexToBytes } from '@noble/hashes/utils.js';
import { platform } from '@/platform';
import { mobileIdentity } from '@/services/bitchat/mobile-identity';
import { channelKey, normalizeGeoRelays } from './geohash-protocol';
import { normalizeGeohash } from './geohash';
import { GeohashSession, type GeoMessage } from './geohash-session';
export const DEFAULT_GEO_RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];
type State = { active: boolean; busy: boolean; hash: string; connected: number; present: number; messages: GeoMessage[]; error: boolean };
const empty: State = { active: false, busy: false, hash: '', connected: 0, present: 0, messages: [], error: false };
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
  connection?: { hash: string; name: string; relays: string[] };
  private historyVersion = 0;
  clearMessages(): void {
    ++this.historyVersion; this.before = undefined;
    geohashStore.setState({ messages: [] });
  }
  private before?: number;
  async restore(hash: string): Promise<void> {
    hash = normalizeGeohash(hash);
    const revision = this.revision;
    const version = this.historyVersion;
    const page = await loadMessages<GeoMessage>(`geo:${hash}`);
    if (version !== this.historyVersion || revision !== this.revision) return;
    this.before = page.before;
    geohashStore.setState({ hash, messages: page.messages });
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
  private revision = 0;
  async join(input: string, name: string, relayInput: string[]): Promise<void> {
    const hash = normalizeGeohash(input), relays = normalizeGeoRelays(relayInput);
    if (!name.trim() || new TextEncoder().encode(name).length > 64) throw new Error('Invalid nickname');
    this.stop(); const revision = ++this.revision;
    await this.restore(hash);
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
      });
      this.connection = { hash, name, relays };
      this.session.start(); geohashStore.setState({ active: true, busy: false });
    } catch (error) { if (revision === this.revision) { this.stop(); geohashStore.setState({ error: true }); } throw error; }
  }
  async send(content: string): Promise<void> {
    if (!this.session) throw new Error('No location channel selected');
    await this.session.send(content);
  }
  stop(): void {
    this.connection = undefined;
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
