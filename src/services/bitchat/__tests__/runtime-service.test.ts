/** @jest-environment node */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { bitchatService, bitchatSessionStore } from '../bitchat.service';
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
jest.mock('@/services/geohash/geohash.service', () => ({ geohashService: { acceptCarrier: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: { proximityTransport: {}, records: { get: jest.fn(), set: jest.fn(), remove: jest.fn(), list: jest.fn() },
  history: { save: jest.fn(), load: jest.fn(async () => []), get: jest.fn() }, preferences: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
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
  return { BitchatSession: jest.fn().mockImplementation((_transport, identity, _name, callbacks) => ({
    id: peerId(identity.noisePublicKey), callbacks,
    start: jest.fn(async () => { callbacks.peer({ id, name: 'Carrier', fingerprint: bytesToHex(sha256(key)), noisePublicKey: bytesToHex(key), signingPublicKey: bytesToHex(sign), secure: true, lastSeen: Date.now(), direct: true, capabilities: 1 }); }),
    stop: jest.fn(async () => {}), setCapabilities: jest.fn(), directPeers: () => [id], authenticatedDirect: () => true,
    authenticateDirect: jest.fn(async () => {}), sendExtension: jest.fn(async () => {}), sendPrivate: jest.fn(async () => {}), sendReceipt: jest.fn(async () => {}),
  })) };
});
let records: ReturnType<typeof memoryStorage>;
const secrets = new Map<string, string>(), history = new Map<string, string>();
function session() { return jest.mocked(BitchatSession).mock.results.at(-1)!.value as Pick<BitchatSession, 'id' | 'sendExtension'> & { callbacks: { receipt(id: string, peer: string, status: string): void; extension: jest.Mock } }; }
async function until(check: () => boolean | Promise<boolean>) { const deadline = Date.now() + 3000; while (!await check()) { if (Date.now() > deadline) throw new Error('service test timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } }
beforeEach(async () => {
  await bitchatService.stop(); bitchatService.resetLocalState(); contactsStore.setState({ contacts: [], ready: false });
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
  expect(JSON.parse(history.get('mesh:internet-incoming' + peer)!)).toMatchObject({ content: 'offline hello' });
  expect(await records.get('acks:' + peer, 'internet-incoming')).toMatchObject({ status: 'delivered' });
  await bitchatService.read(peer, 'internet-incoming');
  expect(await records.get('acks:' + peer, 'internet-incoming')).toBeNull();
  expect(mailbox.send).toHaveBeenLastCalledWith(npubKey, expect.objectContaining({ kind: 'receipt', delivery: 'read' }), expect.any(String), peer);
  await bitchatService.favorite(peer, false);
  expect(mailbox.send).toHaveBeenLastCalledWith(npubKey, expect.objectContaining({ kind: 'message', content: expect.stringContaining('[UNFAVORITED]:') }), expect.any(String), peer);
  expect(contactsService.get(peer)?.pendingFavorite).toBeUndefined();
});
