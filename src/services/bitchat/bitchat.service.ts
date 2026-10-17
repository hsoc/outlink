import { getPublicKey } from 'nostr-tools/pure';
import { decode as decodeNpub, npubEncode } from 'nostr-tools/nip19';
import { contactsService, contactsStore } from './compatibility/contacts';
import { putRecord, readRecord, readRecords, removeRecord } from './compatibility/storage';
import { MessageOutbox, type PendingMessage } from './compatibility/outbox';
import { PrivateMailbox, privateNostrKey, type InternetPayload } from './compatibility/private-mailbox';
import { verificationLink, verifyLink } from './compatibility/verification';
import { mobileIdentity } from './mobile-identity';
import { historyOperation, loadMessages, saveMessage } from '@/services/history/history';
import { bytes, peerId } from './bitchat-wire';
import { gossipArchive } from './compatibility/gossip-storage';
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
function contactsStoreLookup(sender: string) {
  return contactsStore.getState().contacts.find(contact => {
    try { if (!contact.npub) return false; const decoded = decodeNpub(contact.npub); return decoded.type === 'npub' && decoded.data === sender; } catch { return false; }
  });
}
class BitchatService {
  connection?: { account: string; name: string };
  private mailbox?: PrivateMailbox;
  private internetConnections = 0;
  private internetEpoch = 0;
  private sweeping = false;
  private outboxTimer?: ReturnType<typeof setInterval>;
  private readonly outbox = new MessageOutbox({
    list: peer => readRecords<PendingMessage>(`outbox:${peer}`, 100),
    get: (peer, id) => readRecord<PendingMessage>(`outbox:${peer}`, id),
    put: (peer, id, value) => putRecord(`outbox:${peer}`, id, value),
    remove: (peer, id) => removeRecord(`outbox:${peer}`, id),
  }, message => this.mergeMessage(message));
  private mergeMessage(message: BitchatMessage) {
    bitchatSessionStore.setState(state => {
      const previous = state.messages.find(m => m.id === message.id && m.peer === message.peer);
      if (previous?.delivery === 'read' || previous?.delivery === 'delivered' && !['read', 'delivered'].includes(message.delivery)) return state;
      const messages = state.messages.filter(m => m.id !== message.id || m.peer !== message.peer);
      let low = 0, high = messages.length;
      while (low < high) { const middle = low + high >> 1; if (messages[middle].timestamp <= message.timestamp) low = middle + 1; else high = middle; }
      messages.splice(low, 0, message);
      return { messages: messages.slice(-500) };
    });
    // The subscription persists visible updates. Older messages still need durable receipts.
    if (!bitchatSessionStore.getState().messages.some(m => m.id === message.id && m.peer === message.peer)) {
      void historyOperation(async () => {
        const id = message.id + message.peer, saved = await platform.history.get('mesh', id);
        const previous = saved ? JSON.parse(saved) as BitchatMessage : undefined;
        if (previous?.delivery === 'read' || previous?.delivery === 'delivered' && !['read', 'delivered'].includes(message.delivery)) return;
        await platform.history.save('mesh', id, JSON.stringify(message));
      }).catch(() => bitchatSessionStore.setState({ error: true }));
    }
  }
  private async rememberPeer(peer: BitchatPeer, newlyOnline: boolean) {
    if (!peer.noisePublicKey || !peer.signingPublicKey) return;
    const previous = contactsService.get(peer.id);
    if (previous && previous.noiseKey !== peer.noisePublicKey) throw new Error('Pinned peer identity changed');
    if (previous?.verified && previous.signingKey !== peer.signingPublicKey) throw new Error('Verified signing identity changed');
    if (!previous || previous.name !== peer.name || previous.signingKey !== peer.signingPublicKey) await contactsService.save({ id: peer.id, noiseKey: peer.noisePublicKey, signingKey: peer.signingPublicKey, name: peer.name,
      fingerprint: peer.fingerprint, favorite: previous?.favorite ?? false, verified: previous?.verified ?? false,
      blocked: previous?.blocked ?? false, mutual: previous?.mutual ?? false, npub: previous?.npub,
      theirFavorite: previous?.theirFavorite, pendingFavorite: previous?.pendingFavorite, updatedAt: Date.now() });
    if (newlyOnline && peer.lastSeen > 0 && this.connection) void this.flush(peer.id).catch(() => bitchatSessionStore.setState({ error: true }));
  }
  private async flush(peer: string) {
    const contact = contactsService.get(peer); if (!contact || contact.blocked) return;
    await this.sendFavoriteNotice(peer);
    const available = () => !!this.session && bitchatSessionStore.getState().peers.some(p => p.id === peer && p.lastSeen > 0 && Date.now() - p.lastSeen < 60000) || !!this.mailbox && this.internetConnections > 0 && contact.favorite && !!contact.npub;
    await this.outbox.flush(peer, async entry => {
      const live = bitchatSessionStore.getState().peers.find(p => p.id === peer && Date.now() - p.lastSeen < 60000);
      if (this.session && live) await this.session.sendPrivate(peer, entry.message.content, entry.message.id);
      else if (this.mailbox && contact.favorite && contact.npub) {
        const target = decodeNpub(contact.npub); if (target.type !== 'npub') throw new Error('Invalid Nostr contact');
        await this.mailbox.send(target.data, { kind: 'message', id: entry.message.id, content: entry.message.content,
          senderId: entry.message.peer, recipientId: peer, timestamp: entry.message.timestamp }, entry.message.peer, peer);
      } else throw new Error('Peer has no available route');
    }, available);
  }
  private async receiveInternet(sender: string, payload: InternetPayload) {
    const contact = contactsStoreLookup(sender);
    if (!contact || contact.blocked || payload.senderId && payload.senderId !== contact.id || payload.recipientId && payload.recipientId !== bitchatSessionStore.getState().id) return;
    if (payload.kind === 'receipt') { await this.receipt(payload.id, contact.id, payload.delivery); return; }
    if (await this.favoriteNotification(contact.id, payload.content)) return;
    const own = bitchatSessionStore.getState().id;
    const previous = await historyOperation(() => platform.history.get('mesh', payload.id + contact.id));
    if (!previous) this.mergeMessage({ id: payload.id, peer: contact.id, recipient: own, name: contact.name, content: payload.content,
      timestamp: payload.timestamp, outgoing: false, delivery: 'delivered' });
    await this.mailbox?.send(sender, { kind: 'receipt', id: payload.id, delivery: 'delivered', senderId: own, recipientId: contact.id, timestamp: Date.now() }, own, contact.id);
  }
  async enableInternet(enabled: boolean, relays = ['wss://relay.damus.io/', 'wss://nos.lol/']) {
    const epoch = ++this.internetEpoch, previous = this.mailbox;
    this.mailbox = undefined; this.internetConnections = 0; previous?.stop(); await previous?.settled();
    if (!enabled || !this.connection || epoch !== this.internetEpoch) return;
    const key = await privateNostrKey();
    if (!this.connection || epoch !== this.internetEpoch) { key.fill(0); return; }
    this.mailbox = new PrivateMailbox(key, relays, { message: (sender, payload) => this.receiveInternet(sender, payload),
      connection: count => { this.internetConnections = count; if (count) for (const contact of contactsStore.getState().contacts) if (contact.favorite) void this.flush(contact.id).catch(() => {}); },
      error: () => bitchatSessionStore.setState({ error: true }) });
    this.mailbox.start();
  }
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
      await this.restore(); await contactsService.restore();
      bitchatSessionStore.setState({ busy: true, error: false });
      try {
        this.identity = await loadIdentity(account); this.account = account;
        this.session = new BitchatSession(platform.proximityTransport, this.identity, name, {
          peer: peer => {
            const pin = contactsService.get(peer.id);
            if (pin?.blocked || pin && pin.noiseKey !== peer.noisePublicKey) return;
            const old = bitchatSessionStore.getState().peers.find(p => p.id === peer.id);
            bitchatSessionStore.setState(state => {
              const peers = state.peers.filter(p => p.id !== peer.id); peers.push({ ...peer }); return { peers };
            });
            void this.rememberPeer(peer, !old?.lastSeen || peer.secure && !old.secure).catch(() => bitchatSessionStore.setState({ error: true }));
          },
          message: message => {
            if (contactsService.get(message.peer)?.blocked) return;
            if (message.content.startsWith('[FAVORITED]:') || message.content.startsWith('[UNFAVORITED]:')) {
              if (!message.outgoing) void this.favoriteNotification(message.peer, message.content).catch(() => bitchatSessionStore.setState({ error: true }));
              return;
            }
            if (!message.outgoing && message.recipient) {
              void historyOperation(() => platform.history.get('mesh', message.id + message.peer)).then(previous => { if (!previous) this.mergeMessage(message); }).catch(() => bitchatSessionStore.setState({ error: true }));
            } else this.mergeMessage(message);
          },
          receipt: (id, sender, delivery) => { void this.receipt(id, sender, delivery).catch(() => bitchatSessionStore.setState({ error: true })); },
          error: () => bitchatSessionStore.setState({ error: true }),
        }, randomBytes, { ...await gossipArchive(() => bitchatSessionStore.setState({ error: true })), pins: contactsStore.getState().contacts.filter(contact => contact.verified || contact.favorite).map(contact => ({ id: contact.id, noiseKey: contact.noiseKey, signingKey: contact.signingKey })) });
        await this.session.start();
        this.connection = { account, name };
        bitchatSessionStore.setState({ active: true, busy: false, id: this.session.id, account });
        const workspace = await platform.preferences.getItem('mobile.workspace');
        const preferences = workspace ? JSON.parse(workspace) as { internet?: boolean; relays?: string } : {};
        if (preferences.internet) await this.enableInternet(true, preferences.relays?.split(/\s+/).filter(Boolean));
        this.outboxTimer = setInterval(() => {
          if (this.sweeping) return;
          this.sweeping = true;
          void (async () => {
            try { for (const contact of contactsStore.getState().contacts) { if (!this.connection) break; if (!contact.blocked) await this.flush(contact.id); } }
            catch { bitchatSessionStore.setState({ error: true }); }
            finally { this.sweeping = false; }
          })();
        }, 30000);
        for (const peer of bitchatSessionStore.getState().peers) if (peer.lastSeen) void this.flush(peer.id).catch(() => {});

      } catch (error) { await this.stopInternal(); bitchatSessionStore.setState({ error: true }); throw error; }
    });
  }
  stop(): Promise<void> { return this.transition(() => this.stopInternal()); }
  private async stopInternal(): Promise<void> {
    this.connection = undefined; ++this.internetEpoch;
    if (this.outboxTimer) clearInterval(this.outboxTimer); this.outboxTimer = undefined;
    this.outbox.cancelFlushes();
    const mailbox = this.mailbox; this.mailbox = undefined; this.internetConnections = 0;
    mailbox?.stop(); await mailbox?.settled();
    const session = this.session; this.session = undefined;
    try { if (session) await session.stop(); await this.outbox.idle(); }
    finally {
      this.identity?.noiseSeed.fill(0); this.identity?.signingSeed.fill(0);
      this.identity = undefined; this.account = undefined;
      bitchatSessionStore.setState(state => ({ active: false, busy: false, peers: [], messages: state.messages.map(message => message.delivery === 'sending' ? { ...message, delivery: 'failed' as const } : message) }));
    }
  }
  private async localIdentity() {
    if (this.identity) return { noiseSeed: this.identity.noiseSeed.slice(), signingSeed: this.identity.signingSeed.slice(), noisePublicKey: this.identity.noisePublicKey.slice() };
    return loadIdentity(await mobileIdentity());
  }
  async verification(name: string) {
    const identity = await this.localIdentity(), key = await privateNostrKey();
    try { return verificationLink(identity.noiseSeed, identity.signingSeed, name, npubEncode(getPublicKey(key))); }
    finally { identity.noiseSeed.fill(0); identity.signingSeed.fill(0); key.fill(0); }
  }
  async importContact(link: string) {
    const qr = verifyLink(link);
    this.session?.pin(qr.id, qr.noiseKeyHex, qr.signKeyHex);
    const contact = await contactsService.importVerification(link);
    if (this.session && bitchatSessionStore.getState().peers.some(peer => peer.id === contact.id && peer.lastSeen > 0)) {
      await this.session.verifyContact(contact.id, contact.noiseKey, contact.signingKey);
      // Preserve concurrent preference changes made while waiting for the response.
      const current = contactsService.get(contact.id);
      if (current?.noiseKey === contact.noiseKey && current.signingKey === contact.signingKey) await contactsService.save({ ...current, verified: true });
    }
    return contactsService.get(contact.id)!;
  }
  private readonly notifying = new Set<string>();
  private async sendFavoriteNotice(peer: string) {
    const contact = contactsService.get(peer);
    if (!this.session || !contact || contact.blocked || contact.pendingFavorite === undefined || this.notifying.has(peer) ||
      !bitchatSessionStore.getState().peers.some(p => p.id === peer && p.lastSeen > 0 && Date.now() - p.lastSeen < 60000)) return;
    this.notifying.add(peer);
    const session = this.session;
    let key: Uint8Array | undefined;
    try {
      key = await privateNostrKey();
      if (session !== this.session) return;
      const content = `${contact.pendingFavorite ? '[FAVORITED]:' : '[UNFAVORITED]:'}${npubEncode(getPublicKey(key))}`;
      await session.sendPrivate(peer, content, await platform.deviceCrypto.randomUUID());
      const current = contactsService.get(peer);
      if (current && current.pendingFavorite === contact.pendingFavorite) await contactsService.save({ ...current, pendingFavorite: undefined });
    } finally { key?.fill(0); this.notifying.delete(peer); }
  }
  async favorite(peer: string, favorite: boolean) {
    const contact = contactsService.get(peer); if (!contact) throw new Error('Unknown contact');
    await contactsService.save({ ...contact, favorite, mutual: favorite && !!contact.theirFavorite, pendingFavorite: favorite });
    await this.sendFavoriteNotice(peer);
  }
  private async favoriteNotification(peer: string, content: string): Promise<boolean> {
    const favorite = content.startsWith('[FAVORITED]:'), unfavorite = content.startsWith('[UNFAVORITED]:');
    if (!favorite && !unfavorite) return false;
    const npub = content.slice(content.indexOf(':') + 1), decoded = decodeNpub(npub);
    if (decoded.type !== 'npub') throw new Error('Invalid favorite identity');
    await historyOperation(async () => {});
    const contact = contactsService.get(peer); if (!contact) return true;
    await contactsService.save({ ...contact, npub, theirFavorite: favorite, mutual: contact.favorite && favorite });
    return true;
  }
  private async receipt(id: string, sender: string, delivery: 'sent' | 'delivered' | 'read' | 'failed') {
    if (delivery === 'sent' || delivery === 'failed') return;
    await this.outbox.acknowledge(sender, id, delivery);
    const key = id + bitchatSessionStore.getState().id;
    const value = await historyOperation(() => platform.history.get('mesh', key));
    if (!value) return;
    const message = JSON.parse(value) as BitchatMessage;
    if (message.outgoing && message.recipient === sender && message.delivery !== 'read') this.mergeMessage({ ...message, delivery });
  }
  async send(content: string, peer?: string): Promise<void> {
    if (!content.trim() || bytes(content).length > 255) throw new Error('Message must fit 255 UTF-8 bytes');
    if (!peer) {
      if (!this.session) throw new Error('Bitchat is stopped');
      await this.session.sendPublic(content); return;
    }
    await contactsService.restore();
    const contact = contactsService.get(peer);
    if (!contact || contact.blocked) throw new Error('Unknown or blocked contact');
    const identity = await this.localIdentity();
    const own = peerId(identity.noisePublicKey); identity.noiseSeed.fill(0); identity.signingSeed.fill(0);
    await this.outbox.enqueue(peer, { id: await platform.deviceCrypto.randomUUID(), peer: own, recipient: peer,
      name: await platform.preferences.getItem('mobile.nickname') ?? 'Outlink', content, timestamp: Date.now(), outgoing: true, delivery: 'queued' });
    if (this.connection) void this.flush(peer).catch(() => bitchatSessionStore.setState({ error: true }));
  }
  async read(peer: string, id: string): Promise<void> {
    await this.session?.markRead(peer, id);
    bitchatSessionStore.setState((state) => ({ messages: state.messages.map((m) =>
      !m.outgoing && m.peer === peer && m.id === id ? { ...m, delivery: 'read' } : m) }));
  }
  resetLocalState() { this.hydrated = false; this.before = undefined; ++this.historyVersion; bitchatSessionStore.setState(empty, true); }
  removeIdentity(account: string): Promise<void> {
    return this.transition(async () => {
      if (this.account === account) await this.stopInternal();
      await platform.secureStorage.deleteItem(storageKey(account));
    });
  }
}
export const bitchatService = new BitchatService();
