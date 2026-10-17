/** @jest-environment node */
import { x25519 } from '@noble/curves/ed25519.js';
import type { ProximityTransportPort } from '@/platform';
import { BitchatSession, type BitchatMessage, type BitchatPeer } from '../bitchat-session';
import { bytes, decodePacket, encodePacket, BitchatType, signPacket } from '../bitchat-wire';

type Radio = { port: ProximityTransportPort; listeners: Map<string, Set<(event: Record<string, unknown>) => void>>;
  neighbors: Map<string, Radio>; id: string; wire: Uint8Array[] };
function radio(id: string, frameSize = 185): Radio {
  const listeners = new Map<string, Set<(e: Record<string, unknown>) => void>>(), neighbors = new Map<string, Radio>();
  const wire: Uint8Array[] = [];
  return { id, listeners, neighbors, wire, port: {
    isAvailable: () => true, requestPermissions: async () => true,
    configureProtocolAsync: jest.fn(async () => {}), maximumFrameSizeAsync: async () => frameSize,
    startAdvertisingAsync: async () => {}, updateProfileAsync: async () => {}, preferPeripheralAsync: async () => {},
    startScanAsync: async () => {}, stopScanAsync: async () => {}, stopSessionAsync: async () => {
      for (const neighbor of neighbors.values()) {
        neighbor.neighbors.delete(id);
        neighbor.listeners.get('onConnection')?.forEach(fn => fn({ endpointId: id, state: 'disconnected' }));
      }
      neighbors.clear();
    },
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
function node(id: string, n: number, frameSize = 185) {
  const r = radio(id, frameSize), peers = new Map<string, BitchatPeer>(), messages: BitchatMessage[] = [];
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
  await until(() => (a.peers.get(c.session.id)?.lastSeen ?? 0) > 0 && (c.peers.get(a.session.id)?.lastSeen ?? 0) > 0);
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

it.each([64, 185, 512])('exchanges fragmented signed public and encrypted private UTF-8 at a %i-byte GATT value size', async frameSize => {
  const a = node('Alice', 1, frameSize), b = node('Bob', 2, frameSize);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => a.peers.has(b.session.id) && b.peers.has(a.session.id));
  const content = '💬'.repeat(63) + 'abc';
  await a.session.sendPublic(content); await until(() => b.messages.length === 1);
  await a.session.sendPrivate(b.session.id, content, 'private-mtu');
  await until(() => b.messages.length === 2 && a.receipts.some(receipt => receipt[2] === 'delivered'));
  expect(b.messages.map(message => message.content)).toEqual([content, content]);
  expect([...a.r.wire, ...b.r.wire].every(wire => wire.length <= frameSize)).toBe(true);
});
it('reestablishes private encryption when the receiver returns with the same identity after disconnecting', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => a.peers.has(b.session.id) && b.peers.has(a.session.id));
  await b.session.sendPrivate(a.session.id, 'before restart', 'before-restart');
  await until(() => a.messages.length === 1);
  await a.session.stop();
  const returned = node('Alice', 1); await returned.session.start(); connect(returned.r, b.r);
  await until(() => returned.peers.has(b.session.id));
  await b.session.sendPrivate(returned.session.id, 'after restart', 'after-restart');
  await until(() => returned.messages.length === 1);
  expect(returned.session.id).toBe(a.session.id);
  expect(returned.messages[0].content).toBe('after restart');
});

it('cancels paced and queued transmissions when the session stops', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => a.peers.has(b.session.id) && b.peers.has(a.session.id));
  const sends = Promise.allSettled(Array.from({ length: 80 }, (_, i) => a.session.sendPublic(`queued-${i}`)));
  await until(() => a.r.wire.length >= 48);
  await a.session.stop();
  const messagesAfterStop = a.messages.length;
  expect((await sends).some(result => result.status === 'rejected')).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(a.messages.length).toBe(messagesAfterStop);
});
it('backfills a public message into a newly joined partition without the original sender present', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => b.peers.has(a.session.id));
  await a.session.sendPublic('message before Carol joined');
  await until(() => b.messages.length === 1);
  await a.session.stop();
  const c = node('Carol', 3); await c.session.start(); connect(b.r, c.r);
  await until(() => c.messages.some(message => message.content === 'message before Carol joined'));
  expect(c.messages.filter(message => message.content === 'message before Carol joined')).toHaveLength(1);
});

it('verifies both identity keys with an encrypted nonce challenge and rejects a changed live signing pin', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => !!a.peers.get(b.session.id)?.lastSeen && !!b.peers.get(a.session.id)?.lastSeen);
  const bob = a.peers.get(b.session.id)!;
  await a.session.verifyContact(bob.id, bob.noisePublicKey!, bob.signingPublicKey!);
  expect(a.peers.get(bob.id)?.secure).toBe(true);
  expect(a.messages).toHaveLength(0); expect(b.messages).toHaveLength(0);
  await expect(a.session.verifyContact(bob.id, bob.noisePublicKey!, '00'.repeat(32))).rejects.toThrow('live peer');
});

it('accepts the explicit all-FF public recipient without rewriting signed bytes', async () => {
  const a = node('Alice', 1), b = node('Bob', 2);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => !!b.peers.get(a.session.id)?.lastSeen);
  const packet = signPacket({ version: 1, type: BitchatType.message, ttl: 7, timestamp: Date.now(), sender: a.session.id, recipient: 'ffffffffffffffff', payload: bytes('explicit broadcast') }, new Uint8Array(32).fill(11));
  b.r.listeners.get('onMessage')!.forEach(fn => fn({ endpointId: a.r.id, payload: encodePacket(packet) }));
  await until(() => b.messages.some(message => message.content === 'explicit broadcast'));
  expect(b.messages.find(message => message.content === 'explicit broadcast')?.recipient).toBeUndefined();
});

it('originates and follows a signed v2 route across mutually confirmed topology', async () => {
  const a = node('Alice', 1, 512), b = node('Bob', 2, 512), c = node('Carol', 3, 512);
  await Promise.all([a.session.start(), b.session.start(), c.session.start()]); connect(a.r, b.r); connect(b.r, c.r);
  await until(() => a.session.routeTo(c.session.id)?.[0] === b.session.id && c.session.routeTo(a.session.id)?.[0] === b.session.id);
  await a.session.sendPrivate(c.session.id, 'routed private message', 'routed-1');
  await until(() => c.messages.some(message => message.id === 'routed-1') && a.receipts.some(receipt => receipt[0] === 'routed-1' && receipt[2] === 'delivered'));
  const routed = await Promise.all(a.r.wire.filter(wire => wire[1] === BitchatType.handshake).map(wire => decodePacket(wire)));
  expect(routed.some(packet => packet.version === 2 && packet.route?.[0] === b.session.id && packet.signature?.length === 64)).toBe(true);
  expect(b.messages).toHaveLength(0);
});

it('exchanges connection probes across a relay and cancels pending probes when stopped', async () => {
  const a = node('Alice', 1, 512), b = node('Bob', 2, 512), c = node('Carol', 3, 512);
  await Promise.all([a.session.start(), b.session.start(), c.session.start()]); connect(a.r, b.r); connect(b.r, c.r);
  await until(() => !!a.peers.get(c.session.id)?.lastSeen && !!c.peers.get(a.session.id)?.lastSeen);
  const result = await a.session.ping(c.session.id);
  expect(result.hops).toBe(2); expect(result.rttMs).toBeGreaterThanOrEqual(0);
  expect(a.messages).toHaveLength(0); expect(b.messages).toHaveLength(0); expect(c.messages).toHaveLength(0);
  const pending = a.session.ping('00'.repeat(8)), stopped = expect(pending).rejects.toThrow('stopped');
  await a.session.stop(); await stopped;
});
it('budgets unsigned ping replies per ingress even if a sender rotates claimed IDs', async () => {
  const a = node('Alice', 1, 512), b = node('Bob', 2, 512);
  await Promise.all([a.session.start(), b.session.start()]); connect(a.r, b.r);
  await until(() => !!b.peers.get(a.session.id)?.lastSeen);
  for (let i = 1; i <= 9; i++) {
    const payload = new Uint8Array(9).fill(i); payload[8] = 7;
    const probe = encodePacket({ version: 1, type: BitchatType.ping, ttl: 7, sender: i.toString(16).padStart(16, '0'), recipient: b.session.id, timestamp: Date.now(), payload });
    b.r.listeners.get('onMessage')!.forEach(fn => fn({ endpointId: a.r.id, payload: probe }));
  }
  await until(() => b.r.wire.filter(wire => wire[1] === BitchatType.pong).length === 5);
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(b.r.wire.filter(wire => wire[1] === BitchatType.pong)).toHaveLength(5);
});
