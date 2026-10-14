/** @jest-environment node */
import { x25519 } from '@noble/curves/ed25519.js';
import type { ProximityTransportPort } from '@/platform';
import { BitchatSession, type BitchatMessage, type BitchatPeer } from '../bitchat-session';
import { bytes, decodePacket, encodePacket, BitchatType } from '../bitchat-wire';

type Radio = { port: ProximityTransportPort; listeners: Map<string, Set<(event: Record<string, unknown>) => void>>;
  neighbors: Map<string, Radio>; id: string; wire: Uint8Array[] };
function radio(id: string): Radio {
  const listeners = new Map<string, Set<(e: Record<string, unknown>) => void>>(), neighbors = new Map<string, Radio>();
  const wire: Uint8Array[] = [];
  return { id, listeners, neighbors, wire, port: {
    isAvailable: () => true, requestPermissions: async () => true,
    configureProtocolAsync: jest.fn(async () => {}), maximumFrameSizeAsync: async () => 185,
    startAdvertisingAsync: async () => {}, updateProfileAsync: async () => {}, preferPeripheralAsync: async () => {},
    startScanAsync: async () => {}, stopScanAsync: async () => {}, stopSessionAsync: async () => {},
    refreshPeerProfileAsync: async () => {},
    async sendAsync(endpoint, payload) {
      wire.push(payload.slice());
      const target = neighbors.get(endpoint);
      if (!target) throw new Error('Offline');
      queueMicrotask(() => target.listeners.get('onMessage')?.forEach((fn) => fn({ endpointId: id, payload: payload.slice() })));
    },
    addListener(name, listener) {
      let group = listeners.get(name); if (!group) { group = new Set(); listeners.set(name, group); }
      group.add(listener); return { remove: () => { group!.delete(listener); } };
    },
  } };
}
function connect(a: Radio, b: Radio) {
  a.neighbors.set(b.id, b); b.neighbors.set(a.id, a);
  a.listeners.get('onPeer')?.forEach((fn) => fn({ endpointId: b.id, profile: new Uint8Array() }));
  b.listeners.get('onPeer')?.forEach((fn) => fn({ endpointId: a.id, profile: new Uint8Array() }));
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Mesh test timed out'); await new Promise((r) => setTimeout(r, 10)); }
}
const sessions: BitchatSession[] = [];
function node(id: string, n: number) {
  const r = radio(id), peers = new Map<string, BitchatPeer>(), messages: BitchatMessage[] = [];
  const receipts: [string, string, string][] = [];
  const noiseSeed = new Uint8Array(32).fill(n);
  let counter = 1;
  const session = new BitchatSession(r.port,
    { noiseSeed, noisePublicKey: x25519.getPublicKey(noiseSeed), signingSeed: new Uint8Array(32).fill(n + 10) }, id,
    { peer: (p) => peers.set(p.id, { ...p }), message: (m) => messages.push(m),
      receipt: (message, sender, status) => receipts.push([message, sender, status]), error: jest.fn() },
    (length) => new Uint8Array(length).fill(counter++));
  sessions.push(session); return { r, session, peers, messages, receipts };
}
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.stop())); });
it('discovers signed identities through a relay and delivers a public message once across a cycle', async () => {
  const a = node('Alice', 1), b = node('Bob', 2), c = node('Carol', 3);
  await Promise.all([a.session.start(), b.session.start(), c.session.start()]);
  connect(a.r, b.r); connect(b.r, c.r); connect(c.r, a.r);
  await until(() => c.peers.has(a.session.id) && b.peers.has(a.session.id));
  await a.session.sendPublic('Hello mesh');
  await until(() => c.messages.length === 1 && b.messages.length === 1);
  await new Promise((r) => setTimeout(r, 50));
  expect(c.messages).toHaveLength(1); expect(c.messages[0].content).toBe('Hello mesh');
  expect(a.messages).toHaveLength(1);
});
it('negotiates Noise across an intermediate node, hides private plaintext from it, and exchanges receipts', async () => {
  const a = node('Alice', 1), b = node('Bob', 2), c = node('Carol', 3);
  await Promise.all([a.session.start(), b.session.start(), c.session.start()]);
  connect(a.r, b.r); connect(b.r, c.r);
  await until(() => a.peers.has(c.session.id) && c.peers.has(a.session.id));
  await a.session.sendPrivate(c.session.id, 'secret message', 'private-1');
  await until(() => c.messages.length === 1 && a.receipts.some((r) => r[2] === 'delivered'));
  expect(b.messages).toHaveLength(0);
  expect(b.r.wire.every((wire) => !Buffer.from(wire).includes(Buffer.from('secret message')))).toBe(true);
  expect(c.messages[0]).toMatchObject({ id: 'private-1', content: 'secret message', recipient: c.session.id });
  await c.session.markRead(a.session.id, 'private-1');
  await until(() => a.receipts.some((r) => r[2] === 'read'));
  expect(a.peers.get(c.session.id)?.secure).toBe(true);
});
it('rejects tampered public signatures and a forged announcement without surfacing it as chat', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => b.peers.has(a.session.id));
  await a.session.sendPublic('valid'); await until(() => b.messages.length === 1);
  const original = a.r.wire.find((wire) => wire[1] === BitchatType.message)!;
  const decoded = await decodePacket(original);
  const forged = encodePacket({ ...decoded, payload: bytes('forged') });
  b.r.listeners.get('onMessage')!.forEach((fn) => fn({ endpointId: a.r.id, payload: forged }));
  await new Promise((r) => setTimeout(r, 50));
  expect(b.messages).toHaveLength(1);
});
it('rejects oversized outgoing UTF-8 before transmission and restores the bearer on stop', async () => {
  const a = node('Alice', 1); await a.session.start();
  await expect(a.session.sendPublic('💬'.repeat(64))).rejects.toThrow('255');
  await a.session.stop();
  expect(a.r.port.configureProtocolAsync).toHaveBeenLastCalledWith('nearby');
});

it('resolves simultaneous private initiations without changing the authenticated peer', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => a.peers.has(b.session.id) && b.peers.has(a.session.id));
  await Promise.all([
    a.session.sendPrivate(b.session.id, 'alice private', 'a-private'),
    b.session.sendPrivate(a.session.id, 'bob private', 'b-private'),
  ]);
  await until(() => a.messages.some((m) => !m.outgoing) && b.messages.some((m) => !m.outgoing));
  expect(a.messages.find((m) => !m.outgoing)?.content).toBe('bob private');
  expect(b.messages.find((m) => !m.outgoing)?.content).toBe('alice private');
});
