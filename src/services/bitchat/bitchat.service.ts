import { loadMessages, saveMessage } from '@/services/history/history';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { BitchatSession, type BitchatIdentity, type BitchatMessage, type BitchatPeer } from './bitchat-session';

export type BitchatState = { active: boolean; busy: boolean; id: string; account: string | null; peers: BitchatPeer[];
  messages: BitchatMessage[]; error: boolean };
const empty: BitchatState = { active: false, busy: false, id: '', account: null, peers: [], messages: [], error: false };
export const bitchatSessionStore = createStore<BitchatState>(() => empty);
const storageKey = (account: string) => `bitchat.identity.${account}`;
async function loadIdentity(account: string): Promise<BitchatIdentity> {
  const saved = await platform.secureStorage.getItem(storageKey(account));
  const stored = saved ? JSON.parse(saved) : { noise: bytesToHex(randomBytes(32)), signing: bytesToHex(randomBytes(32)) };
  if (!/^[0-9a-f]{64}$/.test(stored.noise) || !/^[0-9a-f]{64}$/.test(stored.signing))
    throw new Error('Invalid Bitchat identity');
  const noiseSeed = hexToBytes(stored.noise), signingSeed = hexToBytes(stored.signing);
  const noisePublicKey = x25519.getPublicKey(noiseSeed);
  ed25519.getPublicKey(signingSeed);
  if (!saved) await platform.secureStorage.setItem(storageKey(account), JSON.stringify(stored));
  return { noiseSeed, noisePublicKey, signingSeed };
}
bitchatSessionStore.subscribe((state, previous) => {
  if (state.messages === previous.messages) return;
  const old = new Map(previous.messages.map(message => [message.id + ('peer' in message ? message.peer : ''), message]));
  for (const message of state.messages) {
    const id = message.id + ('peer' in message ? message.peer : '');
    if (old.get(id) !== message) void saveMessage('mesh', id, message).catch(() => bitchatSessionStore.setState({ error: true }));
  }
});
class BitchatService {
  connection?: { account: string; name: string };
  private hydrated = false;
  private historyVersion = 0;
  clearMessages(): void {
    ++this.historyVersion; this.before = undefined;
    bitchatSessionStore.setState({ messages: [] });
  }
  private before?: number;
  async restore(): Promise<void> {
    if (this.hydrated) return;
    const version = this.historyVersion;
    const page = await loadMessages<BitchatMessage>('mesh');
    if (version !== this.historyVersion) return;
    this.before = page.before; this.hydrated = true;
    bitchatSessionStore.setState({ messages: page.messages });
  }
  async latest(): Promise<void> { this.hydrated = false; await this.restore(); }
  async older(): Promise<void> {
    if (!this.before) return;
    const version = this.historyVersion;
    const page = await loadMessages<BitchatMessage>('mesh', this.before);
    if (version !== this.historyVersion) return;
    this.before = page.before;
    bitchatSessionStore.setState(state => ({ messages: [...page.messages, ...state.messages].slice(0, 500) }));
  }
  private session?: BitchatSession;
  private account?: string;
  private identity?: BitchatIdentity;

  private lifecycle: Promise<void> = Promise.resolve();
  private transition(operation: () => Promise<void>): Promise<void> {
    const promise = this.lifecycle.catch(() => {}).then(operation);
    this.lifecycle = promise; return promise;
  }
  start(account: string, name: string): Promise<void> {
    return this.transition(async () => {
      await this.stopInternal();
      await this.restore();
      bitchatSessionStore.setState({ busy: true, error: false });
      try {
        this.identity = await loadIdentity(account); this.account = account;
        this.session = new BitchatSession(platform.proximityTransport, this.identity, name, {
          peer: (peer) => bitchatSessionStore.setState((state) => {
            const index = state.peers.findIndex((p) => p.id === peer.id), peers = state.peers.slice();
            if (index < 0) peers.push({ ...peer }); else peers[index] = { ...peer };
            return { peers };
          }),
          message: (message) => bitchatSessionStore.setState((state) => ({ messages: state.messages.some(m => m.id === message.id && m.peer === message.peer) ? state.messages : [...state.messages.slice(-499), message] })),
          receipt: (id, sender, delivery) => bitchatSessionStore.setState((state) => ({ messages: state.messages.map((m) =>
            m.outgoing && m.id === id && m.recipient === sender &&
            (delivery === 'read' || (delivery === 'delivered' && m.delivery !== 'read') ||
              (delivery === 'sent' && m.delivery === 'sending') || (delivery === 'failed' && m.delivery === 'sending')) ? { ...m, delivery } : m) })),
          error: () => bitchatSessionStore.setState({ error: true }),
        }, randomBytes);
        await this.session.start();
        this.connection = { account, name };
        bitchatSessionStore.setState({ active: true, busy: false, id: this.session.id, account });

      } catch (error) { await this.stopInternal(); bitchatSessionStore.setState({ error: true }); throw error; }
    });
  }
  stop(): Promise<void> { return this.transition(() => this.stopInternal()); }
  private async stopInternal(): Promise<void> {
    this.connection = undefined;
    const session = this.session; this.session = undefined;
    try { if (session) await session.stop(); }
    finally {
      this.identity?.noiseSeed.fill(0); this.identity?.signingSeed.fill(0);
      this.identity = undefined; this.account = undefined;
      bitchatSessionStore.setState(state => ({ active: false, busy: false, peers: [], messages: state.messages.map(message => message.delivery === 'sending' ? { ...message, delivery: 'failed' as const } : message) }));
    }
  }
  async send(content: string, peer?: string): Promise<void> {
    const session = this.session;
    if (!session || !bitchatSessionStore.getState().active) throw new Error('Bitchat is stopped');
    if (peer) await session.sendPrivate(peer, content, await platform.deviceCrypto.randomUUID());
    else await session.sendPublic(content);
  }
  async read(peer: string, id: string): Promise<void> {
    await this.session?.markRead(peer, id);
    bitchatSessionStore.setState((state) => ({ messages: state.messages.map((m) =>
      !m.outgoing && m.peer === peer && m.id === id ? { ...m, delivery: 'read' } : m) }));
  }
  removeIdentity(account: string): Promise<void> {
    return this.transition(async () => {
      if (this.account === account) await this.stopInternal();
      await platform.secureStorage.deleteItem(storageKey(account));
    });
  }
}
export const bitchatService = new BitchatService();
