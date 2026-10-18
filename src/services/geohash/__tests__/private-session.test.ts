/** @jest-environment node */
import { getPublicKey, type Event } from 'nostr-tools/pure';
import { migrationProof, validMigration } from '../identity-migration';
import type { ChannelIdentitySet } from '../channel-identities';
import { GeoPrivateSession, type PrivateDependencies } from '../private-session';
import type { GeoSocket } from '../geohash-session';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { PendingMessage } from '@/services/bitchat/compatibility/outbox';
import { memoryStorage } from '@/services/bitchat/test-support/protocol-storage';
import { createPrivateEnvelope, openPrivateEnvelope } from '@/services/bitchat/compatibility/nostr-private';
import { embeddedPrivate, decodeEmbedded } from '@/services/bitchat/compatibility/private-mailbox';

type Socket = GeoSocket & { filter?: string[]; live: boolean };
function relay() {
  const sockets: Socket[] = [], events: Event[] = [];
  let accept = true, dropFor: string | undefined;
  let duplicate = false;
  const socket = (): GeoSocket => {
    const s: Socket = { live: true, readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null,
      close() { s.live = false; }, send(data) {
        const frame = JSON.parse(data);
        if (frame[0] === 'REQ') { s.filter = frame[2]['#p']; for (const event of events) deliver(s, event); }
        if (frame[0] === 'EVENT') {
          if (accept && frame[1].tags.find((tag: string[]) => tag[0] === 'p')?.[1] !== dropFor) { events.push(frame[1]); for (const target of sockets) { deliver(target, frame[1]); if (duplicate) deliver(target, frame[1]); } }
          queueMicrotask(() => s.onmessage?.({ data: JSON.stringify(['OK', frame[1].id, accept, '']) }));
        }
      } };
    sockets.push(s); queueMicrotask(() => { if (s.live) s.onopen?.(); }); return s;
  };
  function deliver(s: Socket, event: Event) { if (s.live && s.filter?.includes(event.tags.find(t => t[0] === 'p')?.[1] ?? '')) queueMicrotask(() => s.onmessage?.({ data: JSON.stringify(['EVENT', 'private-inbox', event]) })); }
  return { socket, events, drop: (peer?: string) => { dropFor = peer; }, duplicates: () => { duplicate = true; }, reject: () => { accept = false; }, accept: () => { accept = true; }, inject: (event: Event) => { events.push(event); sockets.forEach(s => deliver(s, event)); } };
}
function storage() {
  const records = memoryStorage(), history = new Map<string, BitchatMessage>(), pending = new Map<string, PendingMessage>();
  const changes: BitchatMessage[] = [];
  const deps: PrivateDependencies = { records, outbox: {
    list: async peer => [...pending.values()].filter(e => (e.message.channelThread ?? e.message.recipient) === peer),
    get: async (peer, id) => pending.get(peer + id) ?? null,
    put: async (peer, id, entry) => { pending.set(peer + id, structuredClone(entry)); }, remove: async (peer, id) => { pending.delete(peer + id); },
  }, get: async id => history.get(id) ?? null,
    save: async message => { history.set(message.id + message.peer, structuredClone(message)); },
    changed: m => { changes.push(m); }, connection: jest.fn(), error: jest.fn() };
  return { deps, history, pending, records, changes };
}
const sessions: GeoPrivateSession[] = [];
function client(n: number, hub: ReturnType<typeof relay>, state = storage(), rotating = false, identities?: ChannelIdentitySet) {
  if (rotating) state.deps.hash = 'u4pruy';
  const session = new GeoPrivateSession(new Uint8Array(32).fill(n), ['wss://one.example'], state.deps, hub.socket, identities); sessions.push(session); session.start(); return { ...state, session };
}
async function until(check: () => boolean | Promise<boolean>) { const end = Date.now() + 5000; while (!await check()) { if (Date.now() > end) throw new Error('Private test timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
afterEach(async () => { for (const s of sessions.splice(0)) { s.stop(); await s.idle(); } });
it('delivers encrypted area private text after sender departure and authenticates delivery/read receipts', async () => {
  const hub = relay(), a = client(1, hub), bobKey = getPublicKey(new Uint8Array(32).fill(2));
  await a.session.send(bobKey, 'private while offline');
  await until(() => hub.events.length > 0 && [...a.history.values()].some(m => m.delivery === 'sent'));
  const envelope = openPrivateEnvelope(hub.events[0], new Uint8Array(32).fill(2));
  const embedded = await decodeEmbedded(envelope.content); expect(embedded?.recipientId).toBeUndefined();
  expect(JSON.stringify(hub.events)).not.toContain('private while offline');
  const message = [...a.history.values()][0];
  // A different authenticated sender cannot acknowledge Bob's pending message.
  hub.inject(createPrivateEnvelope(embeddedPrivate({ kind: 'receipt', id: message.id, delivery: 'read', senderId: '', timestamp: Date.now() }), new Uint8Array(32).fill(3), a.session.pubkey));
  await new Promise(resolve => setTimeout(resolve, 30)); expect(a.pending.size).toBe(1);
  a.session.stop(); await a.session.idle();
  const b = client(2, hub); await until(() => b.history.size === 1 && hub.events.length >= 3);
  expect([...b.history.values()][0].content).toBe('private while offline');
  await b.session.read(a.session.pubkey, message.id);
  await until(() => [...b.history.values()][0].delivery === 'read');
  const restarted = client(1, hub, a);
  await until(() => restarted.pending.size === 0 && [...restarted.history.values()][0].delivery === 'read');
  expect(b.history.size).toBe(1); expect(b.deps.error).not.toHaveBeenCalled();
});
it('persists failed read receipts and sends them after a cold restart', async () => {
  const hub = relay(), a = client(1, hub), b = client(2, hub);
  await a.session.send(b.session.pubkey, 'read later'); await until(() => b.history.size === 1 && a.pending.size === 0);
  hub.reject(); const message = [...b.history.values()][0];
  await b.session.read(a.session.pubkey, message.id);
  await until(() => (b.deps.error as jest.Mock).mock.calls.length > 0);
  expect((await b.records.list<{ status: string }>('geo-acks', 200))[0].status).toBe('read');
  b.session.stop(); await b.session.idle(); hub.accept();
  client(2, hub, b);
  await until(() => [...a.history.values()][0].delivery === 'read');
});
it('bounds content and cancels composition racing shutdown before outbox writes', async () => {
  const hub = relay(), a = client(1, hub), peer = getPublicKey(new Uint8Array(32).fill(2));
  await expect(a.session.send(peer, 'x'.repeat(4097))).rejects.toThrow();
  const pending = a.session.send(peer, 'cancel'); a.session.stop();
  await expect(pending).rejects.toThrow('stopped'); await a.session.idle(); expect(a.pending.size).toBe(0);
});

it('retries the original message after a lost acknowledgment without duplicate history or regressing read state', async () => {
  const hub = relay(), a = client(1, hub), b = client(2, hub);
  hub.drop(a.session.pubkey); hub.duplicates();
  await a.session.send(b.session.pubkey, 'ack was lost');
  await until(() => b.history.size === 1 && a.pending.size === 1 && hub.events.length > 0);
  const message = [...b.history.values()][0];
  await b.session.read(a.session.pubkey, message.id);
  await until(() => [...b.history.values()][0].delivery === 'read');
  await b.session.flush(); await new Promise(resolve => setTimeout(resolve, 20)); await b.session.flush();
  expect(await b.records.list('geo-acks', 200)).toHaveLength(0); expect(a.pending.size).toBe(1);
  hub.drop();
  // Age the persisted attempt rather than replacing the outbox's captured clock.
  for (const entry of a.pending.values()) entry.lastAttempt -= 31000;
  await a.session.flush(); await until(() => a.pending.size === 0 && [...a.history.values()][0].delivery === 'read');
  expect(b.history.size).toBe(1); expect([...b.history.values()][0].delivery).toBe('read');
  expect(hub.events.filter(e => e.tags[0][1] === b.session.pubkey).length).toBeGreaterThanOrEqual(2);
});

function identitySet(current: number, retired: number[]): ChannelIdentitySet {
  const item = (n: number) => ({ key: new Uint8Array(32).fill(n), pubkey: getPublicKey(new Uint8Array(32).fill(n)), created: Date.now() });
  return { current: item(current), retired: retired.map(n => ({ ...item(n), expires: Date.now() + 172800000 })), rotateAt: Date.now() + 86400000 };
}
it('authenticates migration privately and preserves conversation roots when both participants rotate', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), b = client(2, hub, storage(), true);
  const oldA = a.session.pubkey, oldB = b.session.pubkey;
  await a.session.send(oldB, 'established thread'); await until(() => b.history.size === 1 && a.pending.size === 0);
  await Promise.all([a.session.replaceIdentities(identitySet(4, [1])), b.session.replaceIdentities(identitySet(5, [2]))]);
  await until(async () => (await a.records.get<{ local: string }>('geo-peers', oldB))?.local === a.session.pubkey && (await b.records.get<{ local: string }>('geo-peers', oldA))?.local === b.session.pubkey);
  // Drive coalesced control work without waiting for the periodic maintenance interval.
  for (let i = 0; i < 3; i++) { await Promise.all([a.session.flush(), b.session.flush()]); await new Promise(resolve => setTimeout(resolve, 10)); }
  expect(await a.records.get('geo-peers', oldB)).toMatchObject({ peer: oldB, head: b.session.pubkey, local: a.session.pubkey });
  expect(await b.records.get('geo-peers', oldA)).toMatchObject({ peer: oldA, head: a.session.pubkey, local: b.session.pubkey });
  await a.session.send(oldB, 'after rotation'); await until(() => b.history.size === 2 && a.pending.size === 0);
  expect([...b.history.values()].map(m => m.channelThread)).toEqual([oldA, oldA]);
  expect([...b.history.values()][1]).toMatchObject({ peer: a.session.pubkey, recipient: b.session.pubkey });
  expect(hub.events.every(event => event.kind === 1059)).toBe(true);
  expect(JSON.stringify(hub.events)).not.toContain('outlink/channel-rotation/v1');
});
it('keeps old queued mail and full-key receipt ownership while migration is pending', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), b = client(2, hub, storage(), true);
  const oldA = a.session.pubkey, oldB = b.session.pubkey; hub.drop(oldA);
  await a.session.send(oldB, 'old-key pending mail'); await until(() => b.history.size === 1 && a.pending.size === 1);
  await a.session.replaceIdentities(identitySet(4, [1]));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect([...a.pending.values()][0].message.peer).toBe(oldA);
  hub.drop(); for (const entry of a.pending.values()) entry.lastAttempt -= 31000;
  await a.session.flush(); await until(() => a.pending.size === 0);
  expect([...a.history.values()][0].peer).toBe(oldA); expect(b.history.size).toBe(1);
});
it('rejects unknown, wrong-channel, forged and conflicting identity migrations', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), b = client(2, hub, storage(), true);
  const oldA = a.session.pubkey, oldB = b.session.pubkey;
  await a.session.send(oldB, 'known peer'); await until(() => b.history.size === 1 && a.pending.size === 0);
  const inject = (key: number, proof: ReturnType<typeof migrationProof>) => hub.inject(createPrivateEnvelope(embeddedPrivate({ kind: 'rotation', id: proof.id, proof, senderId: '', timestamp: Date.now() }), new Uint8Array(32).fill(key), oldB));
  const proof = migrationProof('u4pruy', oldA, new Uint8Array(32).fill(4), Date.now(), Date.now() + 86400000);
  inject(3, proof); inject(1, { ...proof, content: proof.content + 'x' });
  inject(1, migrationProof('ezs42', oldA, new Uint8Array(32).fill(4), Date.now(), Date.now() + 86400000));
  await new Promise(resolve => setTimeout(resolve, 40)); expect(await b.records.get('geo-peers', oldA)).toMatchObject({ head: oldA });
  expect(validMigration(proof, 'u4pruy', oldA)).not.toBeNull();
  expect(await decodeEmbedded(embeddedPrivate({ kind: 'rotation', id: proof.id, proof, senderId: '', timestamp: Date.now() }))).toMatchObject({ kind: 'rotation' });
  inject(1, proof); await until(async () => (await b.records.get<{ head: string }>('geo-peers', oldA))?.head === proof.pubkey);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(await b.records.get('geo-peers', oldA)).toMatchObject({ head: proof.pubkey });
  inject(1, migrationProof('u4pruy', oldA, new Uint8Array(32).fill(6), Date.now(), Date.now() + 86400000));
  await new Promise(resolve => setTimeout(resolve, 30)); expect(await b.records.get('geo-peers', oldA)).toMatchObject({ head: proof.pubkey });
  expect(b.history.size).toBe(1);
});
it('requires explicit recovery after grace expiry instead of silently changing an unsupported contact identity', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), peer = getPublicKey(new Uint8Array(32).fill(2));
  await a.session.send(peer, 'old conversation'); await until(() => a.history.size === 1);
  await a.session.replaceIdentities(identitySet(4, []));
  await expect(a.session.send(peer, 'cannot silently migrate')).rejects.toThrow('expired');
  await a.session.useCurrentIdentity(peer); await a.session.send(peer, 'explicitly restarted');
  await until(() => a.history.size === 2); expect([...a.history.values()][1].peer).toBe(a.session.pubkey);
});

it('keeps the old sending identity until a new-inbox acknowledgment and resumes pending migration after restart', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), b = client(2, hub, storage(), true);
  const oldA = a.session.pubkey, peer = b.session.pubkey, keys = identitySet(4, [1]);
  await a.session.send(peer, 'before migration'); await until(() => a.pending.size === 0 && b.history.size === 1);
  hub.drop(keys.current.pubkey); await a.session.replaceIdentities(keys);
  await until(async () => (await b.records.get<{ head: string }>('geo-peers', oldA))?.head === keys.current.pubkey);
  expect(await a.records.get('geo-peers', peer)).toMatchObject({ local: oldA });
  const notice = (await a.records.get<{ payload: { id: string } }>('geo-migrations', `proof:${peer}`))!;
  const ack = { kind: 'rotation-ack' as const, id: notice.payload.id, previous: oldA, next: keys.current.pubkey, senderId: '', timestamp: Date.now() };
  // A known peer replying to the wrong local inbox cannot confirm new-key possession.
  hub.inject(createPrivateEnvelope(embeddedPrivate(ack), new Uint8Array(32).fill(2), oldA));
  await new Promise(resolve => setTimeout(resolve, 20)); expect(await a.records.get('geo-peers', peer)).toMatchObject({ local: oldA });
  await a.session.send(peer, 'still uses old key'); await until(() => b.history.size === 2);
  expect([...b.history.values()][1].peer).toBe(oldA);
  a.session.stop(); await a.session.idle(); hub.drop();
  const restarted = client(4, hub, a, true, keys);
  const pending = (await a.records.get<Record<string, unknown>>('geo-migrations', `proof:${peer}`))!;
  await a.records.put('geo-migrations', `proof:${peer}`, { ...pending, lastAttempt: 0 });
  await restarted.session.flush(); await until(async () => (await a.records.get<{ local: string }>('geo-peers', peer))?.local === keys.current.pubkey);
  await restarted.session.send(peer, 'new key after acknowledgment'); await until(() => b.history.size === 3);
  expect([...b.history.values()][2]).toMatchObject({ peer: keys.current.pubkey, channelThread: oldA });
});

it('can mark historical old-key messages read locally after expiry without forging a new-key receipt', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), b = client(2, hub, storage(), true);
  const peer = b.session.pubkey; await b.session.send(a.session.pubkey, 'historical private text');
  await until(() => a.history.size === 1 && b.pending.size === 0);
  const message = [...a.history.values()][0]; await a.session.replaceIdentities(identitySet(4, []));
  const sent = hub.events.length; await a.session.read(peer, message.id, message.peer); await a.session.flush();
  expect([...a.history.values()][0].delivery).toBe('read'); expect(hub.events).toHaveLength(sent);
});

it('does not let an expired remote signing key impersonate the migrated conversation', async () => {
  const hub = relay(), a = client(1, hub, storage(), true), b = client(2, hub, storage(), true), original = a.session.pubkey;
  await a.session.send(b.session.pubkey, 'original identity'); await until(() => b.history.size === 1 && a.pending.size === 0);
  await a.session.replaceIdentities(identitySet(4, [1]));
  await until(async () => (await b.records.get<{ head: string }>('geo-peers', original))?.head === a.session.pubkey);
  const clock = Date.now, shifted = jest.spyOn(Date, 'now').mockImplementation(() => clock() + 172800001);
  try {
    hub.inject(createPrivateEnvelope(embeddedPrivate({ kind: 'message', id: 'expired-key-attack', content: 'not the current identity', senderId: '', timestamp: Date.now() }), new Uint8Array(32).fill(1), b.session.pubkey));
    await new Promise(resolve => setTimeout(resolve, 30)); expect(b.history.size).toBe(1);
  } finally { shifted.mockRestore(); }
});
