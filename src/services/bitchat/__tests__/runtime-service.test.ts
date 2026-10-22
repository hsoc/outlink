import { blockedUsers } from '@/services/moderation/blocked-users';
import { privateMessageAlerts } from '@/services/mentions/private-messages';
import { mentionService } from '@/services/mentions/mentions';
/** @jest-environment node */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { saveNickname } from '@/services/preferences/nickname';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bitchatService, bitchatSessionStore, meshGroupsStore } from '../bitchat.service';
import { contactsService, contactsStore } from '../compatibility/contacts';
import { memoryStorage } from '../test-support/protocol-storage';
import { BitchatSession } from '../bitchat-session';
import { platform } from '@/platform';
import { BitchatType, bytes, peerId, text, decodeTlv, encodeTlv, join, signPacket } from '../bitchat-wire';
import { courierTags, decodeCourier, encodeCourier, openCourier, sealCourier } from '../compatibility/courier';
import type { PendingMessage } from '../compatibility/outbox';
import { PrivateMailbox, type InternetPayload } from '../compatibility/private-mailbox';
import { npubEncode } from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';
import { historyOperation } from '@/services/history/history';
const root = 'aa'.repeat(32), recipientSeed = new Uint8Array(32).fill(2), recipientKey = x25519.getPublicKey(recipientSeed);
const carrierSeed = new Uint8Array(32).fill(3), carrierKey = x25519.getPublicKey(carrierSeed), carrierId = peerId(carrierKey);
jest.mock('@/services/mentions/private-messages', () => ({ privateMessageAlerts: { received: jest.fn() } }));
jest.mock('@/services/mentions/mentions', () => ({ mentionService: { received: jest.fn() } }));
jest.mock('@/services/geohash/geohash.service', () => ({ geohashService: { acceptCarrier: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: { proximityTransport: {}, records: { get: jest.fn(), set: jest.fn(), remove: jest.fn(), list: jest.fn() },
  history: { save: jest.fn(), deleteConversation: jest.fn(), load: jest.fn(async () => []), get: jest.fn() }, preferences: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
  secureStorage: { getItem: jest.fn(), setItem: jest.fn() }, deviceCrypto: { randomUUID: jest.fn(async () => 'outgoing-one') } } }));
jest.mock('../compatibility/private-mailbox', () => {
  const actual = jest.requireActual('../compatibility/private-mailbox');
  return { ...actual, PrivateMailbox: jest.fn().mockImplementation((_key, _relays, callbacks) => ({
    callbacks, start: () => callbacks.connection(1), stop: jest.fn(), settled: async () => {}, send: jest.fn(async () => {}),
  })) };
});
jest.mock('../bitchat-session', () => {
  const { peerId } = jest.requireActual('../bitchat-wire');
  const { x25519, ed25519 } = jest.requireActual('@noble/curves/ed25519.js');
  const { sha256 } = jest.requireActual('@noble/hashes/sha2.js');
  const { bytesToHex } = jest.requireActual('@noble/hashes/utils.js');
  const key = x25519.getPublicKey(new Uint8Array(32).fill(3)), id = peerId(key), sign = ed25519.getPublicKey(new Uint8Array(32).fill(13));
  return { BitchatSession: jest.fn().mockImplementation((_transport, identity, initialName, callbacks) => {
    let name = initialName;
    return ({
    get nickname() { return name; }, rename: jest.fn(value => { name = value; }),
    sendPublic: jest.fn(async content => ({ id: 'public-one', peer: peerId(identity.noisePublicKey), name, content, timestamp: Date.now(), outgoing: true, delivery: 'sent' })),
    id: peerId(identity.noisePublicKey), callbacks,
    start: jest.fn(async () => { callbacks.peer({ id, name: 'Carrier', fingerprint: bytesToHex(sha256(key)), noisePublicKey: bytesToHex(key), signingPublicKey: bytesToHex(sign), secure: true, lastSeen: Date.now(), direct: true, capabilities: 1 }); }),
    stop: jest.fn(async () => {}), setCapabilities: jest.fn(), directPeers: () => [id], authenticatedDirect: () => true,
    authenticateDirect: jest.fn(async () => {}), sendExtension: jest.fn(async () => {}), sendPrivate: jest.fn(async () => {}), sendReceipt: jest.fn(async () => {}),
  }); }) };
});
let records: ReturnType<typeof memoryStorage>;
const secrets = new Map<string, string>(), history = new Map<string, string>();
function session() { return jest.mocked(BitchatSession).mock.results.at(-1)!.value as Pick<BitchatSession, 'id' | 'sendExtension'> & { callbacks: { receipt(id: string, peer: string, status: string): void; extension: jest.Mock } }; }
async function until(check: () => boolean | Promise<boolean>) { const deadline = Date.now() + 3000; while (!await check()) { if (Date.now() > deadline) throw new Error('service test timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } }
beforeEach(async () => {
  await bitchatService.stop(); bitchatService.resetLocalState(); contactsStore.setState({ contacts: [], ready: false });
  let name = 'Outlink1234';
  jest.mocked(platform.preferences.getItem).mockImplementation(async key => key === 'mobile.nickname' ? name : null);
  jest.mocked(platform.preferences.setItem).mockImplementation(async (key, value) => { if (key === 'mobile.nickname') name = value; });
  secrets.clear(); history.clear(); records = memoryStorage(); secrets.set('outlink.mobile.identity', root);
  jest.mocked(platform.secureStorage.getItem).mockImplementation(async key => secrets.get(key) ?? null);
  jest.mocked(platform.secureStorage.setItem).mockImplementation(async (key, value) => { secrets.set(key, value); });
  jest.mocked(platform.records.get).mockImplementation(async (scope, id) => { const value = await records.get(scope, id); return value === null ? null : JSON.stringify(value); });
  jest.mocked(platform.records.set).mockImplementation(async (scope, id, value) => { await records.put(scope, id, JSON.parse(value)); });
  jest.mocked(platform.records.remove).mockImplementation(async (scope, id) => { await records.remove(scope, id); });
  jest.mocked(platform.records.list).mockImplementation(async (scope, before) => before ? [] : (await records.list(scope, 1000)).map((value, index, values) => ({ sequence: values.length - index, value: JSON.stringify(value) })));
  jest.mocked(platform.history.get).mockImplementation(async (room, id) => history.get(room + ':' + id) ?? null);
  jest.mocked(platform.history.save).mockImplementation(async (room, id, value) => { history.set(room + ':' + id, value); });
  await contactsService.restore();
  await contactsService.save({ id: peerId(recipientKey), noiseKey: bytesToHex(recipientKey), signingKey: bytesToHex(ed25519.getPublicKey(new Uint8Array(32).fill(12))), fingerprint: bytesToHex(sha256(recipientKey)), name: 'Bob', favorite: true, verified: false, blocked: false, mutual: false, updatedAt: Date.now() });
});
afterEach(async () => { await bitchatService.stop(); await historyOperation(async () => {}); });
it('queues before courier transport, stores opaque dispatch metadata, and clears it only for the intended recipient acknowledgment', async () => {
  await bitchatService.start(root, 'Alice'); await until(() => !!contactsService.get(carrierId));
  await bitchatService.send('mail while Bob is absent', peerId(recipientKey));
  const scope = 'outbox:' + peerId(recipientKey);
  await until(async () => (await records.get<PendingMessage>(scope, 'outgoing-one'))?.message.delivery === 'carried');
  const entry = (await records.get<PendingMessage>(scope, 'outgoing-one'))!;
  expect(entry.courier?.deposited).toEqual([bytesToHex(carrierKey)]);
  const calls = jest.mocked(session().sendExtension).mock.calls.filter(call => call[0] === BitchatType.courier);
  expect(calls[0].slice(2)).toEqual([carrierId, true]);
  const envelope = decodeCourier(calls[0][1]), opened = openCourier(envelope.ciphertext, recipientSeed);
  expect(text(decodeTlv(opened.payload.subarray(1)).get(1)!)).toBe('mail while Bob is absent');
  session().callbacks.receipt('outgoing-one', carrierId, 'delivered'); await historyOperation(async () => {});
  expect(await records.get(scope, 'outgoing-one')).not.toBeNull();
  session().callbacks.receipt('outgoing-one', peerId(recipientKey), 'delivered');
  await until(async () => await records.get(scope, 'outgoing-one') === null);
  expect(bitchatSessionStore.getState().messages.find(message => message.id === 'outgoing-one')?.delivery).toBe('delivered');
});
it('opens courier mail durably, deduplicates copies, queues a receipt, and rejects deposits without direct authentication', async () => {
  await bitchatService.start(root, 'Alice');
  const identity = JSON.parse(secrets.get(`bitchat.identity.${root}`)!) as { noise: string; signing: string };
  const own = x25519.getPublicKey(Uint8Array.from(Buffer.from(identity.noise, 'hex')));
  const envelope = { tag: courierTags(own)[1], expiry: Date.now() + 86400000, copies: 4,
    ciphertext: sealCourier(join(Uint8Array.of(1), encodeTlv([[0, bytes('incoming')], [1, bytes('sealed incoming')]])), recipientSeed, own) };
  const packet = { version: 1 as const, type: BitchatType.courier, ttl: 7, timestamp: Date.now(), sender: carrierId, recipient: session().id, payload: encodeCourier(envelope) };
  const context = { link: 'carrier-link', authenticated: false };
  expect(await session().callbacks.extension(packet, context)).toBe(true);
  expect(await session().callbacks.extension(packet, context)).toBe(true);
  expect(bitchatSessionStore.getState().messages.filter(message => message.id === 'incoming')).toHaveLength(1);
  expect(privateMessageAlerts.received).toHaveBeenCalledWith(expect.objectContaining({ id: 'incoming', outgoing: false, recipient: session().id }));
  expect(await records.get('acks:' + peerId(recipientKey), 'incoming')).toMatchObject({ status: 'delivered' });
  const otherEnvelope = { ...envelope, tag: courierTags(recipientKey)[1] };
  const deposit = signPacket({ ...packet, payload: encodeCourier(otherEnvelope) }, new Uint8Array(32).fill(13));
  expect(await session().callbacks.extension(deposit, { ...context, noiseKey: carrierKey, signingKey: ed25519.getPublicKey(new Uint8Array(32).fill(13)), boundPeer: carrierId })).toBe(false);
  expect(await records.list('courier', 40)).toHaveLength(0);
});

it('persists mesh-favorite internet receipts across a failed relay write and sends offline favorite notices', async () => {
  const peer = peerId(recipientKey), npubKey = getPublicKey(new Uint8Array(32).fill(2));
  await contactsService.upsert(peer, previous => ({ ...previous!, npub: npubEncode(npubKey) }));
  await bitchatService.start(root, 'Alice'); await bitchatService.enableInternet(true);
  const mailbox = jest.mocked(PrivateMailbox).mock.results.at(-1)!.value as { callbacks: { message(sender: string, payload: InternetPayload): Promise<void> }; send: jest.Mock };
  mailbox.send.mockRejectedValueOnce(new Error('relay rejected'));
  await mailbox.callbacks.message(npubKey, { kind: 'message', id: 'internet-incoming', content: 'offline hello', senderId: peer, recipientId: bitchatSessionStore.getState().id, timestamp: Date.now() });
  expect(privateMessageAlerts.received).toHaveBeenCalledWith(expect.objectContaining({ id: 'internet-incoming', outgoing: false }));
  expect(JSON.parse(history.get('mesh:internet-incoming' + peer)!)).toMatchObject({ content: 'offline hello' });
  expect(await records.get('acks:' + peer, 'internet-incoming')).toMatchObject({ status: 'delivered' });
  await bitchatService.read(peer, 'internet-incoming');
  expect(await records.get('acks:' + peer, 'internet-incoming')).toBeNull();
  expect(mailbox.send).toHaveBeenLastCalledWith(npubKey, expect.objectContaining({ kind: 'receipt', delivery: 'read' }), expect.any(String), peer);
  await bitchatService.favorite(peer, false);
  expect(mailbox.send).toHaveBeenLastCalledWith(npubKey, expect.objectContaining({ kind: 'message', content: expect.stringContaining('[UNFAVORITED]:') }), expect.any(String), peer);
  expect(contactsService.get(peer)?.pendingFavorite).toBeUndefined();
});

it('uses the saved nickname for mesh posts even when setup or resume provides an older name', async () => {
  await bitchatService.start(root, 'Stale setup name');
  expect(bitchatService.connection?.name).toBe('Outlink');
  await saveNickname('Shared updated name');
  await bitchatService.send('public content');
  const active = jest.mocked(BitchatSession).mock.results.at(-1)!.value;
  expect(active.rename).toHaveBeenLastCalledWith('Shared updated name');
  expect((await active.sendPublic.mock.results.at(-1).value).name).toBe('Shared updated name');
  await bitchatService.stop(); await bitchatService.start(root, 'Old resume snapshot');
  expect(bitchatService.connection?.name).toBe('Shared updated name');
});

it('passes newly received public mesh messages to mention handling', async () => {
  await bitchatService.start(root, 'Outlink1234');
  const active = jest.mocked(BitchatSession).mock.results.at(-1)!.value;
  jest.mocked(mentionService.received).mockClear();
  const incoming = { id: 'mention-live', peer: carrierId, name: 'Carrier', content: '@Outlink1234 hello', timestamp: Date.now(), outgoing: false, delivery: 'sent' };
  active.callbacks.message(incoming); active.callbacks.message(incoming);
  expect(mentionService.received).toHaveBeenCalledTimes(1);
  expect(mentionService.received).toHaveBeenCalledWith(incoming, 'mesh', 'public', expect.any(String), expect.any(Array));
});

it('isolates group history and drafts from public chats and clears group memory with history', async () => {
  await bitchatService.start(root, 'Outlink1234');
  const id = await bitchatService.createGroup('Crew');
  expect(meshGroupsStore.getState().groups[0]).toMatchObject({ id, name: 'Crew', status: 'joined' });
  expect(meshGroupsStore.getState().groups[0]).not.toHaveProperty('key');
  const before = meshGroupsStore.getState().historyEpoch;
  meshGroupsStore.setState({ messages: [{ id: 'm', group: id, sender: 'self', name: 'Me', content: 'secret', timestamp: Date.now(), outgoing: true }] });
  bitchatService.clearMessages();
  expect(meshGroupsStore.getState().messages).toEqual([]);
  expect(meshGroupsStore.getState().historyEpoch).toBe(before + 1);
  await bitchatService.stop();
  expect(meshGroupsStore.getState().groups[0].id).toBe(id);
  bitchatService.resetLocalState(); expect(meshGroupsStore.getState().groups).toEqual([]);
});

it('does not deliver or alert on a blocked mesh sender', async () => {
  await bitchatService.start(root, 'Alice');
  await blockedUsers.set(['mesh:' + carrierId], 'Carrier', true);
  const active = session() as unknown as { callbacks: { message(message: unknown): void } };
  jest.mocked(mentionService.received).mockClear(); jest.mocked(privateMessageAlerts.received).mockClear();
  active.callbacks.message({ id: 'blocked-public', peer: carrierId, name: 'Carrier', content: '@Alice blocked', timestamp: Date.now(), outgoing: false, delivery: 'sent' });
  active.callbacks.message({ id: 'blocked-dm', peer: carrierId, recipient: bitchatSessionStore.getState().id, name: 'Carrier', content: 'blocked', timestamp: Date.now(), outgoing: false, delivery: 'delivered' });
  expect(bitchatSessionStore.getState().messages.some(m => m.id.startsWith('blocked-'))).toBe(false);
  expect(mentionService.received).not.toHaveBeenCalled(); expect(privateMessageAlerts.received).not.toHaveBeenCalled();
  await blockedUsers.set(['mesh:' + carrierId], 'Carrier', false);
});

it('deletes a whole private conversation, cancels its outbox, and preserves the contact and other messages', async () => {
  await bitchatService.start(root, 'Alice'); const peer = peerId(recipientKey), contact = structuredClone(contactsService.get(peer));
  const own = bitchatSessionStore.getState().id;
  const outgoing = { id: 'delete-queued', peer: own, recipient: peer, name: 'Alice', content: 'private', timestamp: Date.now(), outgoing: true, delivery: 'queued' as const };
  await records.put('outbox:' + peer, outgoing.id, { message: outgoing, attempts: 0, lastAttempt: 0, expiresAt: Date.now() + 86400000 });
  const publicMessage = { ...outgoing, id: 'public-keep', recipient: undefined };
  bitchatSessionStore.setState({ messages: [outgoing, publicMessage] });
  jest.mocked(platform.history.deleteConversation).mockImplementationOnce(async (_room, _peer, ids) => {
    for (const id of ids ?? []) history.set('mesh:' + id, JSON.stringify({ deleted: true }));
  });
  const olderOther = { ...outgoing, id: 'older-other', recipient: 'cc'.repeat(8), timestamp: outgoing.timestamp - 1 };
  jest.mocked(platform.history.load).mockResolvedValueOnce([{ sequence: 1, value: JSON.stringify(olderOther) }]);
  await bitchatService.deleteConversation(peer);
  expect(platform.history.deleteConversation).toHaveBeenCalledWith('mesh', peer, [outgoing.id + own]);
  expect(bitchatSessionStore.getState().messages).toEqual([olderOther, publicMessage]);
  expect(await records.list('outbox:' + peer, 100)).toEqual([]);
  expect(contactsService.get(peer)).toEqual(contact);
});

it('prepares discovered Nearby identities on demand without automatically saving them permanently', async () => {
  await bitchatService.start(root, 'Alice'); await contactsService.idle();
  await contactsService.remove(carrierId); expect(contactsService.get(carrierId)).toBeUndefined();
  expect(await bitchatService.preparePrivateConversation(carrierId)).toBe(true);
  expect(contactsService.get(carrierId)).toMatchObject({ noiseKey: bytesToHex(carrierKey), favorite: false, verified: false });
  expect(contactsService.get(carrierId)?.saved).not.toBe(true);
  const unknown = 'ee'.repeat(8);
  expect(await bitchatService.preparePrivateConversation(unknown)).toBe(false); expect(contactsService.get(unknown)).toBeUndefined();
});
