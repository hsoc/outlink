import { MESSAGE_WINDOW, messageIsFresh } from '@/lib/message-retention';
import { cashuTransfers } from '@/services/cashu/transfers';
import { CASHU_PREFIX, tokenParts } from '@/services/cashu/token';
import { sessionIntent } from '@/services/history/lifecycle';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { GroupRuntime, type GroupInfo, type GroupMessage } from './compatibility/group-runtime';
import { privateMessageAlerts } from '@/services/mentions/private-messages';
import { mentionService } from '@/services/mentions/mentions';
import { ensureNickname, nicknameStore, validateNickname } from '@/services/preferences/nickname';
import { refreshAreaRelays } from '@/services/geohash/relay-refresh';
import type { Event } from 'nostr-tools/pure';
import { base64 } from '@scure/base';
import { PrekeyRuntime, type ProtocolStorage } from './compatibility/prekey-runtime';
import { CourierRuntime } from './compatibility/courier-runtime';
import { NetworkRuntime, type NetworkConfig } from './compatibility/network-runtime';
import { bridgeHint, meshStableId } from './compatibility/network-protocol';
import { decodeCourier, encodeCourier, decodePrekeys, courierTag, courierTags, sealCourier } from './compatibility/courier';
import { geohashService } from '@/services/geohash/geohash.service';
import { getPublicKey } from 'nostr-tools/pure';
import { decode as decodeNpub, npubEncode } from 'nostr-tools/nip19';
import { DISCOVERY_LIFETIME_MS, isSavedContact, contactsService, contactsStore } from './compatibility/contacts';
import { putRecord, readRecord, readRecords, removeRecord } from './compatibility/storage';
import { MessageOutbox, type PendingMessage, type CourierDispatch, type DeliveryResult } from './compatibility/outbox';
import { PrivateMailbox, privateNostrKey, type InternetPayload } from './compatibility/private-mailbox';
import { verificationLink, verifyLink } from './compatibility/verification';
import { mobileIdentity } from './mobile-identity';
import { historyOperation, loadMessages, saveMessage } from '@/services/history/history';
import { bytes, peerId, join, encodeTlv, decodeTlv, text, BitchatType, verifyPacket, isBroadcast, type BitchatPacket } from './bitchat-wire';
import { gossipArchive } from './compatibility/gossip-storage';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { BitchatSession, type BitchatIdentity, type BitchatMessage, type BitchatPeer, type ExtensionContext } from './bitchat-session';

export type BitchatState = { active: boolean; busy: boolean; id: string; account: string | null; peers: BitchatPeer[];
  messages: BitchatMessage[]; bridgeRelays: number; privateRelays: number; error: boolean };
const empty: BitchatState = { active: false, busy: false, id: '', account: null, peers: [], messages: [], bridgeRelays: 0, privateRelays: 0, error: false };
export const bitchatSessionStore = createStore<BitchatState>(() => empty);
const protocolStorage: ProtocolStorage = { get: readRecord, list: readRecords, put: putRecord, remove: removeRecord };
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
export const meshGroupsStore = createStore<{ groups: GroupInfo[]; messages: GroupMessage[]; self: string; historyEpoch: number }>(() => ({ groups: [], messages: [], self: '', historyEpoch: 0 }));
class BitchatService {
  private readonly conversationVersions = new Map<string, number>();
  private readonly deletions = new Map<string, Promise<void>>();
  private groups?: GroupRuntime;
  private bridgeIdentity = '';
  nicknameIdentities(): string[] { return [this.session?.id ?? '', this.bridgeIdentity].filter(Boolean); }
  connection?: { account: string; name: string };
  private prekeys?: PrekeyRuntime;
  private couriers?: CourierRuntime;
  private network?: NetworkRuntime;
  private lastPrekeys = 0;
  private networkEpoch = 0;
  private flushingAll?: Promise<void>;
  private readonly flushes = new Map<string, Promise<void>>();
  private readonly operations = new Set<Promise<unknown>>();
  private track<T>(work: Promise<T>): Promise<T> { this.operations.add(work); void work.finally(() => this.operations.delete(work)).catch(() => {}); return work; }
  private readonly encounters = new Map<string, Promise<void>>();
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
  private mergeMessage(message: BitchatMessage, checked = false) {
    if (!messageIsFresh(message)) return;
    // Cashu frames use only live Noise DMs, never chat history, relay mail, or courier storage.
    if (message.content.startsWith(CASHU_PREFIX)) return;
    const peer = message.recipient ? message.outgoing ? message.recipient : message.peer : undefined;
    if (peer && this.conversationVersions.has(peer) && !checked) {
      const epoch = sessionIntent();
      void this.track((this.deletions.get(peer) ?? Promise.resolve()).then(() => historyOperation(() => platform.history.get('mesh', message.id + message.peer))).then(saved => {
        if (epoch === sessionIntent() && !(saved && JSON.parse(saved).deleted)) this.mergeMessage(message, true);
      })).catch(() => bitchatSessionStore.setState({ error: true }));
      return;
    }
    if (!message.outgoing && (blockedUsers.has('mesh:' + message.peer) || message.bridge && (blockedUsers.has('nostr:' + message.bridge.pubkey) || geohashService.isBlocked?.(message.bridge.pubkey)))) return;
    const known = bitchatSessionStore.getState().messages.some(m => m.id === message.id && m.peer === message.peer);
    if (!known && !contactsService.get(message.peer)?.blocked) privateMessageAlerts.received(message);
    if (!known) mentionService.received(message, 'mesh', 'public', message.bridge?.radioHint ?? meshStableId(message.peer, message.timestamp, message.content), [this.session?.id ?? '', this.bridgeIdentity]);
    bitchatSessionStore.setState(state => {
      const previous = state.messages.find(m => m.id === message.id && m.peer === message.peer);
      if (previous?.delivery === 'read' || previous?.delivery === 'delivered' && !['read', 'delivered'].includes(message.delivery)) return state;
      const hint = !message.recipient && !message.bridge ? meshStableId(message.peer, message.timestamp, message.content) : undefined;
      const messages = state.messages.filter(m => (m.id !== message.id || m.peer !== message.peer) && (!hint || m.bridge?.radioHint !== hint));
      let low = 0, high = messages.length;
      while (low < high) { const middle = low + high >> 1; if (messages[middle].timestamp <= message.timestamp) low = middle + 1; else high = middle; }
      messages.splice(low, 0, message);
      return { messages: messages.slice(-MESSAGE_WINDOW) };
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
    const noiseKey = peer.noisePublicKey, signingKey = peer.signingPublicKey;
    const previous = contactsService.get(peer.id);
    if (previous && previous.noiseKey !== noiseKey) throw new Error('Pinned peer identity changed');
    if (previous?.verified && previous.signingKey !== signingKey) throw new Error('Verified signing identity changed');
    if (!previous || previous.name !== peer.name || previous.signingKey !== signingKey || !isSavedContact(previous) && (previous.expiresAt ?? 0) < Date.now() + 3600000) await contactsService.upsert(peer.id, current => ({ id: peer.id, noiseKey, signingKey, name: peer.name,
      fingerprint: peer.fingerprint, saved: current?.saved, expiresAt: Date.now() + DISCOVERY_LIFETIME_MS, favorite: current?.favorite ?? false, verified: current?.verified ?? false,
      blocked: current?.blocked ?? false, mutual: current?.mutual ?? false, npub: current?.npub,
      theirFavorite: current?.theirFavorite, pendingFavorite: current?.pendingFavorite, updatedAt: Date.now() }));
    if (newlyOnline && peer.lastSeen > 0 && this.connection) void this.encounter(peer.id).catch(() => bitchatSessionStore.setState({ error: true }));
  }
  private carrierPeers(entry?: PendingMessage) {
    return bitchatSessionStore.getState().peers.filter(peer => this.session?.directPeers().includes(peer.id) && peer.lastSeen > 0 && !contactsService.get(peer.id)?.blocked &&
      (!entry?.courier || entry.courier.deposited.length < 3 && !entry.courier.deposited.includes(peer.noisePublicKey!)));
  }
  private flush(peer: string): Promise<void> {
    const existing = this.flushes.get(peer); if (existing) return existing;
    const work = this.flushInternal(peer).finally(() => { this.flushes.delete(peer); }); this.flushes.set(peer, work); return work;
  }
  private async flushInternal(peer: string) {
    const contact = contactsService.get(peer);
    if (!contact) {
      // Expire orphaned queued mail without transmitting under a discarded identity.
      await this.outbox.flush(peer, async () => { throw new Error('Contact expired'); }, () => false); return;
    }
    if (contact.blocked) return;
    await this.sendFavoriteNotice(peer); await this.flushReceipts(peer);
    const available = (entry: PendingMessage) => !!this.session && bitchatSessionStore.getState().peers.some(p => p.id === peer && p.lastSeen > 0 && Date.now() - p.lastSeen < 60000) ||
      !!this.mailbox && this.internetConnections > 0 && contact.favorite && !!contact.npub || !!this.prekeys && (this.carrierPeers(entry).length > 0 || !!this.network?.canDrop() && !entry.courier?.dropAccepted);
    await this.outbox.flush(peer, async entry => {
      const session = this.session;
      const live = bitchatSessionStore.getState().peers.find(p => p.id === peer && p.lastSeen > 0 && Date.now() - p.lastSeen < 60000);
      if (session && live) { try { await session.sendPrivate(peer, entry.message.content, entry.message.id); return { delivery: 'sent' }; } catch { /* Try another transport. */ } }
      if (this.mailbox && this.internetConnections > 0 && contact.favorite && contact.npub) {
        const target = decodeNpub(contact.npub); if (target.type !== 'npub') throw new Error('Invalid Nostr contact');
        try { await this.mailbox.send(target.data, { kind: 'message', id: entry.message.id, content: entry.message.content,
          senderId: entry.message.peer, recipientId: peer, timestamp: entry.message.timestamp }, entry.message.peer, peer); return { delivery: 'sent' }; } catch { /* Try sealed mail. */ }
      }
      if (!session || !this.prekeys || !this.identity) throw new Error('Peer has no available route');
      let dispatch: CourierDispatch = entry.courier ? { ...entry.courier, deposited: [...entry.courier.deposited] } : { wire: '', deposited: [] };
      if (!dispatch.wire) {
        const recipient = hexToBytes(contact.noiseKey), prekey = await this.prekeys.assign(recipient, entry.message.id);
        const plain = join(Uint8Array.of(1), encodeTlv([[0, bytes(entry.message.id)], [1, bytes(entry.message.content)]]));
        try { dispatch.wire = base64.encode(encodeCourier({ tag: courierTag(recipient, Math.floor(Date.now() / 86400000)), expiry: entry.expiresAt, copies: 4,
          prekeyId: prekey?.id, ciphertext: sealCourier(plain, this.identity.noiseSeed, prekey?.publicKey ?? recipient, prekey?.id) })); } finally { plain.fill(0); }
      }
      for (const carrier of this.carrierPeers(entry)) {
        if (dispatch.deposited.length >= 3 || session !== this.session) break;
        try { await session.authenticateDirect(carrier.id); await session.sendExtension(BitchatType.courier, base64.decode(dispatch.wire), carrier.id, true); dispatch.deposited.push(carrier.noisePublicKey!); } catch { /* Other carriers may remain reachable. */ }
      }
      if (this.network?.canDrop() && !dispatch.dropAccepted) { try { await this.network.publishDrop(decodeCourier(base64.decode(dispatch.wire))); dispatch.dropAccepted = true; } catch { /* Retain for retry. */ } }
      if (!dispatch.deposited.length && !dispatch.dropAccepted) throw new Error('No carrier accepted mail');
      return { delivery: 'carried', courier: dispatch } satisfies DeliveryResult;
    }, available);
  }
  private async publishPrekeys(force = false) {
    if (!this.session || !this.prekeys || !this.connection || !bitchatSessionStore.getState().peers.some(peer => peer.lastSeen > 0) || !force && Date.now() - this.lastPrekeys < 60000) return;
    const session = this.session, prekeys = this.prekeys; this.lastPrekeys = Date.now();
    const payload = await prekeys.bundle(); if (session !== this.session) return;
    try { await session.sendExtension(BitchatType.prekeys, payload); } catch (error) { this.lastPrekeys = 0; throw error; }
  }
  private flushAll() {
    return this.flushingAll ??= (async () => {
      for (const [index, contact] of contactsStore.getState().contacts.entries()) {
        if (!this.connection) break; if (!contact.blocked) await this.flush(contact.id);
        if (index % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
      }
    })().finally(() => { this.flushingAll = undefined; });
  }
  private encounter(peer: string): Promise<void> {
    const pending = this.encounters.get(peer); if (pending) return pending;
    const work = (async () => {
      const session = this.session, contact = contactsService.get(peer);
      if (!session || !contact || contact.blocked || !this.connection) return;
      await this.publishPrekeys();
      if (session.directPeers().includes(peer)) {
        await session.authenticateDirect(peer);
        await this.flushReceipts(peer);
      } else if (this.groups?.needsConnection(contact.fingerprint) && !bitchatSessionStore.getState().peers.find(p => p.id === peer)?.secure) {
        await session.rekey(peer);
      }
      if (session !== this.session) return;
      await this.couriers?.encounter(hexToBytes(contact.noiseKey), contact.favorite ? 'favorite' : 'verified', session.authenticatedDirect(peer),
        envelope => session.sendExtension(BitchatType.courier, encodeCourier(envelope), peer, session.authenticatedDirect(peer)));
      this.network?.retry();
      void this.flushAll().catch(() => bitchatSessionStore.setState({ error: true }));
    })().finally(() => { this.encounters.delete(peer); });
    this.encounters.set(peer, work); return work;
  }
  private async extension(packet: BitchatPacket, context: ExtensionContext): Promise<boolean> {
    if (packet.type === BitchatType.group) {
      if (!this.groups) return false;
      await this.groups.receiveMessage(packet.payload); return true;
    }
    if (packet.type === BitchatType.prekeys) {
      if (!context.signingKey || !context.noiseKey || !this.prekeys || !isBroadcast(packet)) return false;
      const bundle = decodePrekeys(packet.payload, context.signingKey);
      if (peerId(bundle.owner) !== packet.sender || bytesToHex(bundle.owner) !== bytesToHex(context.noiseKey)) return false;
      await this.prekeys.ingest(packet.payload, context.signingKey); return true;
    }
    if (packet.type === BitchatType.carrier) {
      if (!this.network) return false;
      const relayOnly = !isBroadcast(packet) && packet.recipient !== this.session?.id;
      return this.network.receive(packet.payload, context.link, !isBroadcast(packet), relayOnly);
    }
    if (packet.type !== BitchatType.courier || isBroadcast(packet)) return false;
    const envelope = decodeCourier(packet.payload);
    if (envelope.expiry <= Date.now() || envelope.expiry > Date.now() + 86400000 + 60000) return false;
    if (packet.recipient !== this.session?.id) return true;
    const own = this.identity?.noisePublicKey;
    if (own && courierTags(own).some(tag => bytesToHex(tag) === bytesToHex(envelope.tag))) return this.openEnvelope(envelope);
    if (!context.authenticated || context.boundPeer !== packet.sender || !context.noiseKey || !context.signingKey || !verifyPacket(packet, context.signingKey)) return false;
    const contact = contactsService.get(packet.sender); if (contact?.blocked) return false;
    return await this.couriers?.deposit(envelope, bytesToHex(context.noiseKey), contact?.favorite ? 'favorite' : 'verified') ?? false;
  }
  private async openEnvelope(envelope: ReturnType<typeof decodeCourier>): Promise<boolean> {
    if (!this.prekeys || !this.identity) return false;
    let opened: Awaited<ReturnType<PrekeyRuntime['open']>>;
    try { opened = await this.prekeys.open(envelope.ciphertext, envelope.prekeyId); } catch { return false; }
    try {
      if (opened.changed) void this.publishPrekeys(true).catch(() => bitchatSessionStore.setState({ error: true }));
      if (opened.payload[0] !== 1) return true;
      const fields = decodeTlv(opened.payload.subarray(1)), id = text(fields.get(0) ?? new Uint8Array()), content = text(fields.get(1) ?? new Uint8Array());
      if (!id || !content.trim()) return true;
      const sender = peerId(opened.sender), contact = contactsService.get(sender);
      if (blockedUsers.has('mesh:' + sender) || contact?.blocked || contact && contact.noiseKey !== bytesToHex(opened.sender)) return true;
      const message: BitchatMessage = { id, peer: sender, recipient: peerId(this.identity.noisePublicKey), name: contact?.name ?? sender, content, timestamp: Date.now(), outgoing: false, delivery: 'delivered' };
      const existing = await historyOperation(() => platform.history.get('mesh', id + sender));
      if (!existing) { await saveMessage('mesh', id + sender, message); this.mergeMessage(message); }
      await this.queueReceipt(sender, id, 'delivered');
      return true;
    } finally { opened.payload.fill(0); }
  }
  private queueReceipt(peer: string, id: string, status: 'delivered' | 'read') {
    return historyOperation(async () => {
      const scope = `acks:${peer}`, saved = await platform.records.get(scope, id);
      const existing = saved ? JSON.parse(saved) as { status: string } : undefined;
      if (!existing) {
        const entries = await platform.records.list(scope);
        if (entries.length >= 100) await platform.records.remove(scope, (JSON.parse(entries[entries.length - 1].value) as { id: string }).id);
      }
      await platform.records.set(scope, id, JSON.stringify({ id, status: existing?.status === 'read' ? 'read' : status, expiry: Date.now() + 86400000 }));
    });
  }
  private async flushReceipts(peer: string) {
    const session = this.session; if (!session) return;
    for (const entry of await readRecords<{ id: string; status: 'delivered' | 'read'; expiry: number }>(`acks:${peer}`, 100)) {
      if (session !== this.session) break;
      if (entry.expiry > Date.now()) {
        const live = bitchatSessionStore.getState().peers.some(p => p.id === peer && p.lastSeen > 0 && Date.now() - p.lastSeen < 60000);
        if (live) await session.sendReceipt(peer, entry.id, entry.status);
        else {
          const contact = contactsService.get(peer);
          if (!this.mailbox || !this.internetConnections || !contact?.favorite || !contact.npub || contact.blocked) continue;
          const target = decodeNpub(contact.npub); if (target.type !== 'npub') continue;
          await this.mailbox.send(target.data, { kind: 'receipt', id: entry.id, delivery: entry.status, senderId: session.id, recipientId: peer, timestamp: Date.now() }, session.id, peer);
        }
      }
      await historyOperation(async () => {
        const value = await platform.records.get(`acks:${peer}`, entry.id);
        if (value && (JSON.parse(value) as { status: string }).status === entry.status) await platform.records.remove(`acks:${peer}`, entry.id);
      });
    }
  }
  hasGateway() { return bitchatSessionStore.getState().peers.some(peer => peer.capabilities && (peer.capabilities & 4) && peer.lastSeen > 0 && Date.now() - peer.lastSeen < 60000 && !contactsService.get(peer.id)?.blocked); }
  private hasRadio(event: Event) {
    const hint = bridgeHint(event); return !!hint && bitchatSessionStore.getState().messages.some(message => !message.recipient && !message.bridge && meshStableId(message.peer, message.timestamp, message.content) === hint);
  }
  async refreshNetwork() {
    const epoch = ++this.networkEpoch, session = this.session, previous = this.network;
    previous?.stop(); await previous?.idle(); this.network = undefined; this.bridgeIdentity = '';
    bitchatSessionStore.setState({ bridgeRelays: 0 });
    if (!session || !this.identity || !this.connection) return;
    await historyOperation(async () => {});
    const saved = await platform.preferences.getItem('mobile.workspace');
    const config = saved ? JSON.parse(saved) as { autoAreaRelays?: boolean; gateway?: boolean; bridge?: boolean; bridgeCell?: string; hash?: string; relays?: string } : {};
    const options: NetworkConfig = { autoAreaRelays: config.autoAreaRelays !== false, gateway: config.gateway === true, bridge: config.bridge === true, cell: config.bridgeCell ?? '', hash: config.hash?.trim().toLowerCase().replace(/^#/, '') ?? '', relays: config.relays?.split(/\s+/).filter(Boolean) ?? ['wss://relay.damus.io/', 'wss://nos.lol/'] };
    if (options.autoAreaRelays && (options.gateway || options.bridge)) await refreshAreaRelays();
    if (epoch !== this.networkEpoch || session !== this.session || !this.connection) return;
    const key = await privateNostrKey(`bridge/${options.cell}`);
    if (epoch !== this.networkEpoch || session !== this.session) { key.fill(0); return; }
    this.bridgeIdentity = getPublicKey(key);
    this.network = new NetworkRuntime(options, key, {
      ownKey: this.identity.noisePublicKey,
      peers: () => bitchatSessionStore.getState().peers.filter(peer => peer.noisePublicKey && peer.lastSeen > 0 && Date.now() - peer.lastSeen < 60000 && !contactsService.get(peer.id)?.blocked).map(peer => ({ id: peer.id, key: hexToBytes(peer.noisePublicKey!), capabilities: peer.capabilities ?? 0, authenticated: session.authenticatedDirect(peer.id), verified: !!peer.signingPublicKey })),
      send: (payload, peer) => session.sendExtension(BitchatType.carrier, payload, peer),
      geo: (event, hash) => geohashService.acceptCarrier(event, hash), hasRadio: event => this.hasRadio(event),
      bridge: event => {
        if (this.hasRadio(event)) return;
        this.mergeMessage({ id: event.id, peer: `bridge:${event.pubkey}`, name: `${event.tags.find(tag => tag[0] === 'n')?.[1] ?? 'anon'}#${event.pubkey.slice(-4)}`, content: event.content, timestamp: event.created_at * 1000,
          outgoing: false, delivery: 'sent', bridge: { pubkey: event.pubkey, radioHint: bridgeHint(event) } });
      },
      published: event => {
        const hint = bridgeHint(event); if (!hint) return;
        const message = bitchatSessionStore.getState().messages.find(message => message.outgoing && !message.recipient && meshStableId(message.peer, message.timestamp, message.content) === hint);
        if (message?.delivery === 'queued') this.mergeMessage({ ...message, delivery: 'sent' });
      },
      open: envelope => this.openEnvelope(envelope), handover: (envelope, peer) => session.sendExtension(BitchatType.courier, encodeCourier(envelope), peer, true),
      connected: count => {
        if (epoch !== this.networkEpoch || session !== this.session) return;
        bitchatSessionStore.setState({ bridgeRelays: count });
        if (count > 0) void this.flushAll().catch(() => bitchatSessionStore.setState({ error: true }));
      }, error: () => bitchatSessionStore.setState({ error: true }),
    }, protocolStorage);
    session.setCapabilities(9 | (options.gateway ? 4 : 0) | (options.bridge ? 128 : 0));
    await this.network.start();
    geohashService.meshFallback = (event, hash) => this.network?.uplinkGeo(event, hash) ?? Promise.resolve(false);
  }
  private async receiveInternet(sender: string, payload: InternetPayload) {
    if (payload.kind === 'rotation' || payload.kind === 'rotation-ack') return;
    const contact = contactsStoreLookup(sender);
    if (!contact || blockedUsers.has('mesh:' + contact.id) || contact.blocked || payload.senderId && payload.senderId !== contact.id || payload.recipientId && payload.recipientId !== bitchatSessionStore.getState().id) return;
    if (payload.kind === 'receipt') { await this.receipt(payload.id, contact.id, payload.delivery); return; }
    if (await this.favoriteNotification(contact.id, payload.content)) return;
    const own = bitchatSessionStore.getState().id;
    const previous = await historyOperation(() => platform.history.get('mesh', payload.id + contact.id));
    if (!previous) {
      const message: BitchatMessage = { id: payload.id, peer: contact.id, recipient: own, name: contact.name, content: payload.content, timestamp: payload.timestamp, outgoing: false, delivery: 'delivered' };
      await saveMessage('mesh', payload.id + contact.id, message); this.mergeMessage(message);
    }
    await this.queueReceipt(contact.id, payload.id, previous && JSON.parse(previous).delivery === 'read' ? 'read' : 'delivered');
    try { await this.flushReceipts(contact.id); } catch { /* Persisted receipts retry on reconnect. */ }
  }
  async enableInternet(enabled: boolean, relays = ['wss://relay.damus.io/', 'wss://nos.lol/']) {
    const epoch = ++this.internetEpoch, previous = this.mailbox;
    this.mailbox = undefined; this.internetConnections = 0;
    bitchatSessionStore.setState({ privateRelays: 0 });
    previous?.stop(); await previous?.settled();
    if (!enabled || !this.connection || epoch !== this.internetEpoch) return;
    const key = await privateNostrKey();
    if (!this.connection || epoch !== this.internetEpoch) { key.fill(0); return; }
    this.mailbox = new PrivateMailbox(key, relays, { message: (sender, payload) => this.receiveInternet(sender, payload),
      connection: count => {
        if (epoch !== this.internetEpoch) return;
        this.internetConnections = count; bitchatSessionStore.setState({ privateRelays: count });
        if (count) for (const contact of contactsStore.getState().contacts) if (contact.favorite) void this.flush(contact.id).catch(() => {});
      },
      error: () => bitchatSessionStore.setState({ error: true }) });
    this.mailbox.start();
  }
  private hydrated = false;
  private historyVersion = 0;
  clearMessages(): void {
    meshGroupsStore.setState(s => ({ messages: [], historyEpoch: s.historyEpoch + 1 }));
    ++this.historyVersion; this.before = undefined;
    bitchatSessionStore.setState({ messages: [] });
  }
  deleteConversation(peer: string): Promise<void> {
    if (!/^[0-9a-f]{16}$/.test(peer)) return Promise.reject(new Error('Invalid peer identity'));
    const existing = this.deletions.get(peer); if (existing) return existing;
    const epoch = sessionIntent();
    this.conversationVersions.set(peer, (this.conversationVersions.get(peer) ?? 0) + 1);
    const version = ++this.historyVersion;
    const operation = (async () => {
      const pending = await this.outbox.discard(peer);
      await historyOperation(async () => {
        if (epoch !== sessionIntent()) throw new Error('Conversation deletion canceled by identity erasure');
        await platform.history.deleteConversation('mesh', peer, pending.map(message => message.id + message.peer));
        if (epoch !== sessionIntent()) return;
        bitchatSessionStore.setState(state => ({ messages: state.messages.filter(message => !message.recipient || (message.outgoing ? message.recipient : message.peer) !== peer) }));
      });
      const page = await loadMessages<BitchatMessage>('mesh');
      if (epoch !== sessionIntent() || version !== this.historyVersion) return;
      this.before = page.before === undefined ? this.before : Math.min(this.before ?? page.before, page.before);
      this.hydrated = true;
      bitchatSessionStore.setState(state => {
        const messages = new Map(page.messages.map(message => [message.id + message.peer, message]));
        for (const message of state.messages) messages.set(message.id + message.peer, message);
        return { messages: [...messages.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-MESSAGE_WINDOW) };
      });
    })().finally(() => { if (this.deletions.get(peer) === operation) this.deletions.delete(peer); });
    this.deletions.set(peer, operation); return this.track(operation);
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
    bitchatSessionStore.setState(state => ({ messages: [...page.messages, ...state.messages].slice(0, MESSAGE_WINDOW) }));
  }
  private session?: BitchatSession;
  private account?: string;
  private identity?: BitchatIdentity;

  private lifecycle: Promise<void> = Promise.resolve();
  private transition(operation: () => Promise<void>): Promise<void> {
    const promise = this.lifecycle.catch(() => {}).then(operation);
    this.lifecycle = promise; return promise;
  }
  rename(name: string): void {
    const value = validateNickname(name);
    this.session?.rename(value);
    if (this.connection) this.connection.name = value;
  }
  start(account: string, name: string): Promise<void> {
    return this.transition(async () => {
      await this.stopInternal();
      await blockedUsers.restore(); await this.restore(); await contactsService.restore();
      bitchatSessionStore.setState({ busy: true, error: false });
      try {
        this.identity = await loadIdentity(account); this.account = account;
        const prekeyKey = `outlink.prekeys.${account}`;
        this.prekeys = new PrekeyRuntime(this.identity, protocolStorage, { get: () => platform.secureStorage.getItem(prekeyKey), set: value => platform.secureStorage.setItem(prekeyKey, value) });
        await this.prekeys.bundle(); this.couriers = new CourierRuntime(protocolStorage);
        name = await ensureNickname();
        const groups = new GroupRuntime(this.identity, protocolStorage, {
          state: async (peer, data, invite) => { if (this.groups !== groups || !this.session || contactsService.get(peer)?.blocked) throw new Error('Group session unavailable'); await this.session.sendGroupState(peer, data, invite); },
          broadcast: async data => { if (this.groups !== groups || !this.session) throw new Error('Group session unavailable'); await this.session.sendGroup(data); },
          changed: list => meshGroupsStore.setState({ groups: list, self: groups.self.fingerprint }),
          message: message => this.storeGroupMessage(message),
        });
        this.groups = groups; await groups.restore();
        this.session = new BitchatSession(platform.proximityTransport, this.identity, name, {
          groupState: async (peer, payload, invite) => { if (!contactsService.get(peer.id)?.blocked) { const changed = await this.groups?.receiveState(peer, payload, invite); if (changed) await this.replayGroups(); } },
          extension: (packet, context) => this.extension(packet, context),
          peer: peer => {
            const pin = contactsService.get(peer.id);
            if (pin?.blocked || pin && pin.noiseKey !== peer.noisePublicKey) return;
            if (!peer.secure) this.groups?.disconnected(peer.id);
            if (peer.authenticatedCapabilities) void this.track(this.groups?.sync(peer) ?? Promise.resolve()).catch(() => bitchatSessionStore.setState({ error: true }));
            const old = bitchatSessionStore.getState().peers.find(p => p.id === peer.id);
            bitchatSessionStore.setState(state => {
              const peers = state.peers.filter(p => p.id !== peer.id); peers.push({ ...peer }); return { peers };
            });
            void this.rememberPeer(peer, !old?.lastSeen || peer.secure && !old.secure).catch(() => bitchatSessionStore.setState({ error: true }));
          },
          message: message => {
            if (blockedUsers.has('mesh:' + message.peer) || contactsService.get(message.peer)?.blocked) return;
            if (message.content.startsWith(CASHU_PREFIX)) {
              if (!message.outgoing && message.recipient && !message.bridge) void this.track(cashuTransfers.receive(message.peer, message.content)).catch(() => bitchatSessionStore.setState({ error: true }));
              return;
            }
            if (message.content.startsWith('[FAVORITED]:') || message.content.startsWith('[UNFAVORITED]:')) {
              if (!message.outgoing) void this.favoriteNotification(message.peer, message.content).catch(() => bitchatSessionStore.setState({ error: true }));
              return;
            }
            if (!message.outgoing && message.recipient) {
              void this.track(historyOperation(() => platform.history.get('mesh', message.id + message.peer)).then(previous => { if (!previous) this.mergeMessage(message); })).catch(() => bitchatSessionStore.setState({ error: true }));
            } else this.mergeMessage(message);
          },
          receipt: (id, sender, delivery) => { void this.track(this.receipt(id, sender, delivery)).catch(() => bitchatSessionStore.setState({ error: true })); },
          error: () => bitchatSessionStore.setState({ error: true }),
        }, randomBytes, { ...await gossipArchive(() => bitchatSessionStore.setState({ error: true })), pins: contactsStore.getState().contacts.filter(contact => contact.verified || contact.favorite).map(contact => ({ id: contact.id, noiseKey: contact.noiseKey, signingKey: contact.signingKey })) });
        await this.replayGroups();
        this.session.setCapabilities(9);
        await this.session.start();
        this.rename(nicknameStore.getState().name || name);
        this.connection = { account, name: this.session.nickname ?? name };
        bitchatSessionStore.setState({ active: true, busy: false, id: this.session.id, account });
        const workspace = await platform.preferences.getItem('mobile.workspace');
        const preferences = workspace ? JSON.parse(workspace) as { internet?: boolean; relays?: string } : {};
        await this.refreshNetwork();
        if (preferences.internet) await this.enableInternet(true, preferences.relays?.split(/\s+/).filter(Boolean));
        this.outboxTimer = setInterval(() => {
          const network = this.network;
          if (network?.config.autoAreaRelays && (network.config.gateway || network.config.bridge)) void refreshAreaRelays().then(() => { if (this.network === network) network.refreshRelays(); });
          if (this.sweeping) return;
          this.sweeping = true;
          void (async () => {
            try {
              await this.publishPrekeys();
              for (const peer of bitchatSessionStore.getState().peers) { if (!this.connection) break; if (peer.lastSeen > 0) await this.encounter(peer.id); }
              for (const contact of contactsStore.getState().contacts) { if (!this.connection) break; if (!contact.blocked) await this.flush(contact.id); }
              await contactsService.prune();
              if (this.network?.canDrop()) await this.couriers?.publishHeld(envelope => this.network!.publishDrop(envelope));
            }
            catch { bitchatSessionStore.setState({ error: true }); }
            finally { this.sweeping = false; }
          })();
        }, 30000);
        for (const peer of bitchatSessionStore.getState().peers) if (peer.lastSeen) void this.encounter(peer.id).catch(() => {});

      } catch (error) { await this.stopInternal(); bitchatSessionStore.setState({ error: true }); throw error; }
    });
  }
  stop(): Promise<void> { return this.transition(() => this.stopInternal()); }
  private async stopInternal(): Promise<void> {
    this.connection = undefined; ++this.internetEpoch; ++this.networkEpoch;
    if (this.outboxTimer) clearInterval(this.outboxTimer); this.outboxTimer = undefined;
    this.outbox.cancelFlushes(); this.network?.stop(); geohashService.meshFallback = undefined;
    const mailbox = this.mailbox; this.mailbox = undefined; this.internetConnections = 0;
    mailbox?.stop(); await mailbox?.settled();
    const session = this.session; this.session = undefined;
    const groups = this.groups; this.groups = undefined;
    try { if (session) await session.stop(); await this.outbox.idle(); await Promise.allSettled([...this.operations]); await Promise.allSettled([...this.flushes.values()]); await this.flushingAll?.catch(() => {}); await Promise.allSettled([...this.encounters.values()]); await this.network?.idle(); await this.prekeys?.idle(); await this.couriers?.idle(); await contactsService.idle(); await groups?.idle(); }
    finally {
      groups?.stop();
      this.identity?.noiseSeed.fill(0); this.identity?.signingSeed.fill(0);
      this.identity = undefined; this.account = undefined; this.prekeys = undefined; this.couriers = undefined; this.network = undefined; this.lastPrekeys = 0;
      bitchatSessionStore.setState(state => ({ active: false, busy: false, peers: [], bridgeRelays: 0, privateRelays: 0, messages: state.messages.map(message => message.delivery === 'sending' ? { ...message, delivery: 'failed' as const } : message) }));
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
    if (!this.session || !contact || contact.blocked || contact.pendingFavorite === undefined || this.notifying.has(peer)) return;
    this.notifying.add(peer);
    const session = this.session;
    let key: Uint8Array | undefined;
    try {
      key = await privateNostrKey();
      if (session !== this.session) return;
      const content = `${contact.pendingFavorite ? '[FAVORITED]:' : '[UNFAVORITED]:'}${npubEncode(getPublicKey(key))}`;
      const id = await platform.deviceCrypto.randomUUID();
      if (bitchatSessionStore.getState().peers.some(p => p.id === peer && p.lastSeen > 0 && Date.now() - p.lastSeen < 60000)) await session.sendPrivate(peer, content, id);
      else {
        if (!this.mailbox || !this.internetConnections || !contact.npub) return;
        const target = decodeNpub(contact.npub); if (target.type !== 'npub') return;
        await this.mailbox.send(target.data, { kind: 'message', id, content, senderId: session.id, recipientId: peer, timestamp: Date.now() }, session.id, peer);
      }
      const current = contactsService.get(peer);
      if (current && current.pendingFavorite === contact.pendingFavorite) await contactsService.upsert(peer, latest => latest && latest.pendingFavorite === contact.pendingFavorite ? { ...latest, pendingFavorite: undefined } : latest ?? current);
    } finally { key?.fill(0); this.notifying.delete(peer); }
  }
  async favorite(peer: string, favorite: boolean) {
    const contact = contactsService.get(peer); if (!contact) throw new Error('Unknown contact');
    await contactsService.upsert(peer, current => ({ ...(current ?? contact), favorite, saved: favorite || current?.saved, mutual: favorite && !!current?.theirFavorite, pendingFavorite: favorite }));
    await this.sendFavoriteNotice(peer);
  }
  private async favoriteNotification(peer: string, content: string): Promise<boolean> {
    const favorite = content.startsWith('[FAVORITED]:'), unfavorite = content.startsWith('[UNFAVORITED]:');
    if (!favorite && !unfavorite) return false;
    const npub = content.slice(content.indexOf(':') + 1), decoded = decodeNpub(npub);
    if (decoded.type !== 'npub') throw new Error('Invalid favorite identity');
    await historyOperation(async () => {});
    const contact = contactsService.get(peer); if (!contact) return true;
    await contactsService.upsert(peer, current => ({ ...(current ?? contact), npub, theirFavorite: favorite, mutual: !!current?.favorite && favorite }));
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
  send(content: string, peer?: string, nearbyOnly = false): Promise<void> { return this.track(this.sendInternal(content, peer, nearbyOnly)); }
  private async sendInternal(content: string, peer?: string, nearbyOnly = false): Promise<void> {
    const conversationVersion = peer ? this.conversationVersions.get(peer) ?? 0 : 0;
    if (peer && this.deletions.has(peer)) throw new Error('Conversation is being deleted');
    if (!content.trim() || bytes(content).length > 255) throw new Error('Message must fit 255 UTF-8 bytes');
    if (!peer) {
      const session = this.session;
      if (!session) throw new Error('Bitchat is stopped');
      const name = await ensureNickname();
      if (this.session !== session) throw new Error('Mesh session changed');
      this.rename(name);
      const message = await session.sendPublic(content, !!this.network?.config.bridge && !nearbyOnly);
      try { await this.network?.publicMessage(content, message.name, message.peer, message.timestamp, nearbyOnly); }
      catch { bitchatSessionStore.setState({ error: true }); }
      return;
    }
    await contactsService.restore();
    const contact = contactsService.get(peer);
    if (!contact || contact.blocked) throw new Error('Unknown or blocked contact');
    const identity = await this.localIdentity();
    const own = peerId(identity.noisePublicKey); identity.noiseSeed.fill(0); identity.signingSeed.fill(0);
    await contactsService.keepForDelivery(peer);
    const name = await ensureNickname();
    this.rename(name);
    const id = await platform.deviceCrypto.randomUUID();
    if (this.deletions.has(peer) || conversationVersion !== (this.conversationVersions.get(peer) ?? 0)) throw new Error('Conversation was deleted');
    await this.outbox.enqueue(peer, { id, peer: own, recipient: peer,
      name, content, timestamp: Date.now(), outgoing: true, delivery: 'queued' });
    if (this.connection) void this.flush(peer).catch(() => bitchatSessionStore.setState({ error: true }));
  }
  async sendCashu(peer: string, id: string): Promise<void> {
    return this.track((async () => {
      const epoch = sessionIntent(), session = this.session;
      if (!session || !await this.preparePrivateConversation(peer)) throw new Error('Join Nearby and select a known contact');
      const wire = await cashuTransfers.token({ peer, id, outgoing: true });
      const parts = tokenParts(wire), attempt = await platform.deviceCrypto.randomUUID();
      for (let index = 0; index < parts.length; index++) {
        if (epoch !== sessionIntent() || session !== this.session || contactsService.get(peer)?.blocked || blockedUsers.has('mesh:' + peer)) throw new Error('Transfer canceled');
        await session.sendPrivate(peer, parts[index], `cashu-${attempt}-${index}`);
      }
    })());
  }
  async preparePrivateConversation(peer: string): Promise<boolean> {
    const epoch = sessionIntent();
    await contactsService.restore(); await contactsService.idle();
    if (epoch !== sessionIntent()) throw new Error('Conversation setup canceled by identity erasure');
    if (blockedUsers.has('mesh:' + peer) || contactsService.get(peer)?.blocked) throw new Error('Contact is blocked');
    if (!contactsService.get(peer)) {
      const discovered = bitchatSessionStore.getState().peers.find(candidate => candidate.id === peer);
      if (discovered?.noisePublicKey && discovered.signingPublicKey) await this.rememberPeer(discovered, false);
    }
    if (epoch !== sessionIntent()) throw new Error('Conversation setup canceled by identity erasure');
    return !!contactsService.get(peer);
  }
  async ping(peer: string) {
    if (!this.session || contactsService.get(peer)?.blocked) throw new Error('Contact is unavailable');
    return this.session.ping(peer);
  }
  read(peer: string, id: string): Promise<void> { return this.track(this.readInternal(peer, id)); }
  private async readInternal(peer: string, id: string): Promise<void> {
    await this.queueReceipt(peer, id, 'read');
    bitchatSessionStore.setState((state) => ({ messages: state.messages.map((m) =>
      !m.outgoing && m.peer === peer && m.id === id ? { ...m, delivery: 'read' } : m) }));
    if (this.session) { try { await this.flushReceipts(peer); } catch { /* Keep the durable acknowledgment for reconnect. */ } }
  }
  private async replayGroups(id?: string) {
    const groups = this.groups;
    for (const packet of this.session?.groupArchive?.(id) ?? []) {
      if (!groups || groups !== this.groups) return;
      try { await groups.receiveMessage(packet.payload); } catch { /* Opaque cache entries may belong to another key or contain invalid ciphertext. */ }
    }
  }
  private async storeGroupMessage(message: GroupMessage) {
    if (!messageIsFresh(message)) return;
    if (blockedUsers.has('mesh:' + message.sender.slice(0, 16))) return;
    if (contactsStore.getState().contacts.some(c => c.fingerprint === message.sender && c.blocked)) return;
    await historyOperation(async () => {
      const room = `group:${message.group}`, id = `${message.sender}:${message.id}`;
      if (await platform.history.get(room, id)) return;
      await platform.history.save(room, id, JSON.stringify(message));
      meshGroupsStore.setState(state => ({ messages: [...state.messages, message].sort((a, b) => a.timestamp - b.timestamp).slice(-MESSAGE_WINDOW) }));
    });
  }
  async groupHistory(id: string, before?: number) {
    const rows = await historyOperation(() => platform.history.load(`group:${id}`, before));
    return { messages: rows.map(row => JSON.parse(row.value) as GroupMessage).filter(message => messageIsFresh(message)), before: rows[0]?.sequence };
  }
  createGroup(name: string) { return this.track((async () => { const groups = this.groups; if (!groups) throw new Error('Join Bluetooth first'); return groups.create(name, await ensureNickname()); })()); }
  acceptGroup(id: string) { const groups = this.groups; if (!groups) return Promise.reject(new Error('Join Bluetooth first')); return this.track(groups.accept(id).then(() => this.replayGroups(id))); }
  leaveGroup(id: string) { if (!this.groups) return Promise.reject(new Error('Join Bluetooth first')); return this.track(this.groups.leave(id)); }
  sendGroup(id: string, content: string) { return this.track((async () => { const groups = this.groups; if (!groups) throw new Error('Join Bluetooth first'); await groups.send(id, await ensureNickname(), content); })()); }
  private async syncGroups() {
    const groups = this.groups; if (!groups) return;
    await Promise.allSettled(bitchatSessionStore.getState().peers.filter(p => p.secure && p.authenticatedCapabilities && !contactsService.get(p.id)?.blocked).map(p => groups.sync(p)));
  }
  inviteGroup(id: string, peerId: string) {
    return this.track((async () => {
      const session = this.session, groups = this.groups; if (!session || !groups) throw new Error('Join Bluetooth first');
      if (contactsService.get(peerId)?.blocked) throw new Error('Contact blocked');
      let peer = bitchatSessionStore.getState().peers.find(p => p.id === peerId);
      if (!peer?.lastSeen || !(peer.capabilities! & 8)) throw new Error('Group-capable live peer required');
      if (!peer.authenticatedCapabilities) {
        await session.rekey(peerId);
        await new Promise<void>((resolve, reject) => {
          const check = () => bitchatSessionStore.getState().peers.find(p => p.id === peerId)?.authenticatedCapabilities;
          if (check()) { resolve(); return; }
          const timer = setTimeout(() => { unsubscribe(); reject(new Error('Group peer authentication timed out')); }, 10000);
          const unsubscribe = bitchatSessionStore.subscribe(() => { if (check()) { clearTimeout(timer); unsubscribe(); resolve(); } });
        });
      }
      if (this.groups !== groups || this.session !== session) throw new Error('Group session changed');
      peer = bitchatSessionStore.getState().peers.find(p => p.id === peerId);
      if (!peer) throw new Error('Peer left');
      await groups.invite(id, peer); await this.syncGroups();
    })());
  }
  removeGroupMember(id: string, fingerprint: string) {
    return this.track((async () => { const groups = this.groups; if (!groups) throw new Error('Join Bluetooth first'); await groups.remove(id, fingerprint); await this.syncGroups(); })());
  }
  resetLocalState() { this.conversationVersions.clear(); this.deletions.clear(); meshGroupsStore.setState(s => ({ groups: [], messages: [], self: '', historyEpoch: s.historyEpoch + 1 })); this.hydrated = false; this.before = undefined; ++this.historyVersion; bitchatSessionStore.setState(empty, true); }
  removeIdentity(account: string): Promise<void> {
    return this.transition(async () => {
      if (this.account === account) await this.stopInternal();
      await platform.secureStorage.deleteItem(storageKey(account));
    });
  }
}
export const bitchatService = new BitchatService();
