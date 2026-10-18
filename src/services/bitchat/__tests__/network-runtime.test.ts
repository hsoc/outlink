/** @jest-environment node */
import { finalizeEvent, type Event } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils.js';
import { NetworkRuntime, type NetworkConfig } from '../compatibility/network-runtime';
import { bridgeEvent, courierDrop, encodeCarrier, decodeCarrier } from '../compatibility/network-protocol';
import { courierTags } from '../compatibility/courier';
import { createGeohashEvent } from '@/services/geohash/geohash-protocol';
import type { GeoSocket } from '@/services/geohash/geohash-session';
import { memoryStorage } from '../test-support/protocol-storage';
const key = new Uint8Array(32).fill(1), other = new Uint8Array(32).fill(2), ownNoise = new Uint8Array(32).fill(3);
function fixture(options: Partial<NetworkConfig> = {}) {
  const storage = memoryStorage(), sent: unknown[][] = [], callbacks = { geo: jest.fn(), bridge: jest.fn(), published: jest.fn(), open: jest.fn(async () => true), handover: jest.fn(async () => {}), send: jest.fn(async (_payload: Uint8Array, _peer?: string) => {}), hasRadio: jest.fn(() => false), connected: jest.fn(), error: jest.fn(), peers: jest.fn(() => [] as { id: string; key: Uint8Array; capabilities: number; authenticated: boolean; verified: boolean }[]) };
  const config: NetworkConfig = { gateway: true, bridge: true, hash: 'u4pruy', cell: 'u4pruy', relays: ['wss://example.com'], ...options };
  let socket!: GeoSocket;
  const runtime = new NetworkRuntime(config, key.slice(), { ...callbacks, ownKey: ownNoise }, storage, () => {
    socket = { readyState: 1, onopen: null, onclose: null, onmessage: null, onerror: null, send: data => { sent.push(JSON.parse(data)); }, close: () => {} }; return socket;
  });
  return { runtime, callbacks, storage, sent, async start(connect = true) { await runtime.start(); if (connect && socket) socket.onopen!(); },
    event(event: unknown) { socket.onmessage!({ data: JSON.stringify(['EVENT', 'mesh-network', event]) }); },
    accept(event: Event, accepted = true) { socket.onmessage!({ data: JSON.stringify(['OK', event.id, accepted, '']) }); },
  };
}
async function until(check: () => boolean) { const deadline = Date.now() + 3000; while (!check()) { if (Date.now() > deadline) throw new Error('network test timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } }
const fixtures: ReturnType<typeof fixture>[] = [];
function setup(options: Partial<NetworkConfig> = {}) { const f = fixture(options); fixtures.push(f); return f; }
afterEach(async () => { for (const f of fixtures.splice(0)) { f.runtime.stop(); await f.runtime.idle(); } });
it('publishes signed mesh-only geohash uplinks once and downlinks remote messages without internet/mesh echoes', async () => {
  const f = setup(); await f.start();
  const local = createGeohashEvent(other, 'u4pruy', 'Alice', 'local geo');
  await f.runtime.receive(encodeCarrier({ direction: 1, hash: 'u4pruy', event: local }), 'physical-link', true);
  await until(() => f.sent.some(frame => frame[0] === 'EVENT' && (frame[1] as Event).id === local.id));
  f.event(local); f.accept(local); await f.runtime.idle(); expect(f.callbacks.send).not.toHaveBeenCalled();
  await f.runtime.receive(encodeCarrier({ direction: 1, hash: 'u4pruy', event: local }), 'physical-link', true);
  expect(f.sent.filter(frame => frame[0] === 'EVENT')).toHaveLength(1);
  const remote = createGeohashEvent(other, 'u4pruy', 'Bob', 'remote geo'); f.event(remote); await f.runtime.idle();
  await until(() => f.callbacks.send.mock.calls.length > 0);
  expect(decodeCarrier(f.callbacks.send.mock.calls[0][0])).toMatchObject({ direction: 2, event: remote });
  const before = f.sent.filter(frame => frame[0] === 'EVENT').length;
  await f.runtime.receive(encodeCarrier({ direction: 2, hash: 'u4pruy', event: remote }), 'second-gateway', false);
  await f.runtime.receive(encodeCarrier({ direction: 1, hash: 'u4pruy', event: remote }), 'physical-link', true);
  expect(f.sent.filter(frame => frame[0] === 'EVENT')).toHaveLength(before);
});
it('requires bridge consent, honors nearby-only, marks remote messages and rejects forged channel events', async () => {
  const f = setup(); await f.start();
  await f.runtime.publicMessage('radio only', 'Alice', '01'.repeat(8), Date.now(), true); expect(await f.storage.list('network-uplink', 20)).toHaveLength(0);
  await f.runtime.publicMessage('cross mesh', 'Alice', '01'.repeat(8), Date.now(), false);
  await until(() => f.sent.some(frame => frame[0] === 'EVENT'));
  const own = f.sent.find(frame => frame[0] === 'EVENT')![1] as Event; expect(own.tags).toContainEqual(['r', 'u4pruy']); expect(own.tags.some(tag => tag[0] === 'g')).toBe(false);
  f.event(own); f.accept(own); await f.runtime.idle(); expect(f.callbacks.bridge).not.toHaveBeenCalled();
  const remote = bridgeEvent(other, 'u4pruy', 'Bob', 'other island');
  f.event({ ...remote, content: 'forged' }); f.event(remote); await f.runtime.idle(); expect(f.callbacks.bridge).toHaveBeenCalledTimes(1);
  expect(await f.runtime.receive(encodeCarrier({ direction: 4, hash: 'u4pruy', event: remote }), 'link', true)).toBe(false);
});
it('keeps forwarding opt-in, but accepts passive bridge downlinks and uses an advertised gateway when mesh-only', async () => {
  const f = setup({ gateway: false, bridge: false }); await f.start(); expect(f.sent).toHaveLength(0);
  await f.runtime.publicMessage('private-to-radio', 'Alice', '01'.repeat(8), Date.now(), false); expect(await f.storage.list('network-uplink', 20)).toHaveLength(0);
  const event = bridgeEvent(other, 'u4pruy', 'Bob', 'bridge downlink');
  expect(await f.runtime.receive(encodeCarrier({ direction: 3, hash: 'u4pruy', event }), 'link', true)).toBe(false);
  expect(await f.runtime.receive(encodeCarrier({ direction: 4, hash: 'u4pruy', event }), 'link', false)).toBe(true); expect(f.callbacks.bridge).toHaveBeenCalledTimes(1);
  f.callbacks.peers.mockReturnValue([{ id: 'gateway', key: other, capabilities: 4, authenticated: false, verified: false }]);
  const geo = createGeohashEvent(other, 'u4pruy', 'Alice', 'uplink'); expect(await f.runtime.uplinkGeo(geo, 'u4pruy')).toBe(true);
  expect(decodeCarrier(f.callbacks.send.mock.calls.at(-1)![0]).direction).toBe(1);
});
it('requires relay acceptance for drops, validates recipient tags, retries failed opens and persists inbound dedup', async () => {
  const f = setup(); await f.start();
  const envelope = { tag: courierTags(ownNoise)[1], expiry: Date.now() + 86400000, ciphertext: new Uint8Array(96).fill(4), copies: 4 };
  const pending = f.runtime.publishDrop(envelope), expected = expect(pending).rejects.toThrow('rejected');
  const first = f.sent.at(-1)![1] as Event; expect(first.kind).toBe(1401); f.accept(first, false); await expected;
  const retry = f.runtime.publishDrop(envelope), published = f.sent.at(-1)![1] as Event; f.accept(published); await retry;
  const incoming = courierDrop(envelope); f.callbacks.open.mockResolvedValueOnce(false); f.event(incoming); await f.runtime.idle();
  expect(await f.storage.get('network', 'seen-drops')).toBeNull();
  f.event(incoming); await f.runtime.idle(); expect(await f.storage.get('network', 'seen-drops')).toEqual([expect.objectContaining({ id: incoming.id })]);
  f.event(incoming); await f.runtime.idle(); expect(f.callbacks.open).toHaveBeenCalledTimes(2);
  const mislabeled = finalizeEvent({ kind: 1401, created_at: incoming.created_at, content: incoming.content, tags: [['x', '00'.repeat(16)]] }, other);
  f.event(mislabeled); await f.runtime.idle(); expect(f.callbacks.open).toHaveBeenCalledTimes(2);
  expect(bytesToHex(envelope.tag)).toHaveLength(32);
});
it('serializes uplink quotas, rejects wrong directions/signatures and budgets by physical ingress', async () => {
  const f = setup(); await f.start(false);
  const events = Array.from({ length: 12 }, (_, i) => createGeohashEvent(other, 'u4pruy', 'Alice', 'message ' + i));
  await Promise.all(events.map(event => f.runtime.receive(encodeCarrier({ direction: 1, hash: 'u4pruy', event }), 'same-physical-link', true)));
  expect(await f.storage.list('network-uplink', 20)).toHaveLength(5);
  const event = events[0]; expect(await f.runtime.receive(encodeCarrier({ direction: 1, hash: 'u4pruy', event }), 'different-link', false)).toBe(false);
  const payload = encodeCarrier({ direction: 1, hash: 'u4pruy', event }); payload[payload.length - 8] ^= 1;
  expect(await f.runtime.receive(payload, 'different-link', true)).toBe(false);
});

it('uses matching area-directory relays for bridge traffic and keeps courier subscriptions on the default/private pool', async () => {
  const requests: { url: string; socket: GeoSocket; sent: unknown[][] }[] = [];
  const runtime = new NetworkRuntime({ gateway: true, bridge: true, autoAreaRelays: true, hash: 'u4pruy', cell: 'u4pruy', relays: ['wss://private.example'] }, key.slice(), {
    ownKey: ownNoise, peers: () => [], send: async () => {}, geo: () => {}, bridge: () => {}, hasRadio: () => false,
    open: async () => true, handover: async () => {}, connected: () => {}, error: () => {}, published: () => {},
  }, memoryStorage(), url => {
    const sent: unknown[][] = [], socket: GeoSocket = { readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null, send: data => { sent.push(JSON.parse(data)); }, close: () => {} };
    requests.push({ url, socket, sent }); return socket;
  });
  try {
    await runtime.start(); requests.forEach(request => request.socket.onopen!());
    const privatePool = requests.find(request => request.url === 'wss://private.example/')!;
    expect((privatePool.sent[0].slice(2) as { kinds: number[] }[]).every(filter => filter.kinds.includes(1401))).toBe(true);
    const areaPool = requests.filter(request => request !== privatePool); expect(areaPool.length).toBeGreaterThan(0); expect(areaPool.length).toBeLessThanOrEqual(5);
    for (const request of areaPool) expect(request.sent[0]).toEqual(['REQ', 'mesh-network', expect.objectContaining({ '#g': ['u4pruy'] }), expect.objectContaining({ '#r': ['u4pruy'] })]);
    await runtime.publicMessage('standard relay path', 'Alice', '01'.repeat(8), Date.now(), false);
    await until(() => areaPool.some(request => request.sent.some(frame => frame[0] === 'EVENT')));
    expect(privatePool.sent.some(frame => frame[0] === 'EVENT')).toBe(false);
    const event = areaPool.flatMap(request => request.sent).find(frame => frame[0] === 'EVENT')![1] as Event;
    areaPool[0].socket.onmessage!({ data: JSON.stringify(['OK', event.id, true, '']) }); await runtime.idle();
  } finally { runtime.stop(); await runtime.idle(); }
});

it('joins two separate mesh islands over a relay and passes the signed bridge downlink to a mesh-only phone once', async () => {
  const sockets: GeoSocket[] = [], sentEvents: Event[] = [], downlink = jest.fn(), farIsland = jest.fn(), meshOnly = jest.fn();
  const relay = () => {
    const socket: GeoSocket = { readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null, close: () => {}, send: data => {
      const frame = JSON.parse(data); if (frame[0] !== 'EVENT') return;
      const event = frame[1] as Event; sentEvents.push(event);
      queueMicrotask(() => { socket.onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) }); for (const target of sockets) target.onmessage?.({ data: JSON.stringify(['EVENT', 'mesh-network', event]) }); });
    } }; sockets.push(socket); return socket;
  };
  const passive = new NetworkRuntime({ gateway: false, bridge: false, hash: '', cell: '', relays: ['wss://example.com'] }, ownNoise.slice(), {
    ownKey: ownNoise, peers: () => [], send: async () => {}, geo: () => {}, bridge: meshOnly, hasRadio: () => false, open: async () => true, handover: async () => {}, connected: () => {}, error: () => {}, published: () => {},
  }, memoryStorage());
  const create = (gateway: boolean, secret: Uint8Array) => new NetworkRuntime({ gateway, bridge: true, hash: 'u4pruy', cell: 'u4pruy', relays: ['wss://example.com'] }, secret.slice(), {
    ownKey: ownNoise, peers: () => [], send: async payload => { downlink(payload); await passive.receive(payload, 'gateway-local-link', false); }, geo: () => {}, bridge: farIsland, hasRadio: () => false,
    open: async () => true, handover: async () => {}, connected: () => {}, error: () => {}, published: () => {},
  }, memoryStorage(), relay);
  const a = create(false, key), b = create(true, other);
  try {
    await passive.start(); await a.start(); await b.start(); sockets.forEach(socket => socket.onopen!());
    await a.publicMessage('hello from a separate island', 'Alice', '01'.repeat(8), Date.now(), false);
    await until(() => meshOnly.mock.calls.length === 1);
    expect(farIsland).toHaveBeenCalledTimes(1); expect(sentEvents).toHaveLength(1); expect(downlink).toHaveBeenCalledTimes(1);
    expect(decodeCarrier(downlink.mock.calls[0][0])).toMatchObject({ direction: 4, hash: 'u4pruy', event: { content: 'hello from a separate island' } });
  } finally { a.stop(); b.stop(); passive.stop(); await Promise.all([a.idle(), b.idle(), passive.idle()]); }
});
