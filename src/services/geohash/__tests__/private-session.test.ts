/** @jest-environment node */
import { getPublicKey, type Event } from 'nostr-tools/pure';
import { GeoPrivateSession, type PrivateDependencies } from '../private-session';
import type { GeoSocket } from '../geohash-session';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { PendingMessage } from '@/services/bitchat/compatibility/outbox';
import { memoryStorage } from '@/services/bitchat/test-support/protocol-storage';
import { createPrivateEnvelope, openPrivateEnvelope } from '@/services/bitchat/compatibility/nostr-private';
import { embeddedPrivate, decodeEmbedded } from '@/services/bitchat/compatibility/private-mailbox';

type Socket = GeoSocket & { filter?: string; live: boolean };
function relay() {
  const sockets: Socket[] = [], events: Event[] = [];
  let accept = true, dropFor: string | undefined;
  let duplicate = false;
  const socket = (): GeoSocket => {
    const s: Socket = { live: true, readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null,
      close() { s.live = false; }, send(data) {
        const frame = JSON.parse(data);
        if (frame[0] === 'REQ') { s.filter = frame[2]['#p'][0]; for (const event of events) deliver(s, event); }
        if (frame[0] === 'EVENT') {
          if (accept && frame[1].tags.find((tag: string[]) => tag[0] === 'p')?.[1] !== dropFor) { events.push(frame[1]); for (const target of sockets) { deliver(target, frame[1]); if (duplicate) deliver(target, frame[1]); } }
          queueMicrotask(() => s.onmessage?.({ data: JSON.stringify(['OK', frame[1].id, accept, '']) }));
        }
      } };
    sockets.push(s); queueMicrotask(() => { if (s.live) s.onopen?.(); }); return s;
  };
  function deliver(s: Socket, event: Event) { if (s.live && s.filter === event.tags.find(t => t[0] === 'p')?.[1]) queueMicrotask(() => s.onmessage?.({ data: JSON.stringify(['EVENT', 'private-inbox', event]) })); }
  return { socket, events, drop: (peer?: string) => { dropFor = peer; }, duplicates: () => { duplicate = true; }, reject: () => { accept = false; }, accept: () => { accept = true; }, inject: (event: Event) => { events.push(event); sockets.forEach(s => deliver(s, event)); } };
}
function storage() {
  const records = memoryStorage(), history = new Map<string, BitchatMessage>(), pending = new Map<string, PendingMessage>();
  const changes: BitchatMessage[] = [];
  const deps: PrivateDependencies = { records, outbox: {
    list: async peer => [...pending.values()].filter(e => e.message.recipient === peer),
    get: async (peer, id) => pending.get(peer + id) ?? null,
    put: async (peer, id, entry) => { pending.set(peer + id, structuredClone(entry)); }, remove: async (peer, id) => { pending.delete(peer + id); },
  }, get: async id => history.get(id) ?? null,
    save: async message => { history.set(message.id + message.peer, structuredClone(message)); },
    changed: m => { changes.push(m); }, connection: jest.fn(), error: jest.fn() };
  return { deps, history, pending, records, changes };
}
const sessions: GeoPrivateSession[] = [];
function client(n: number, hub: ReturnType<typeof relay>, state = storage()) {
  const session = new GeoPrivateSession(new Uint8Array(32).fill(n), ['wss://one.example'], state.deps, hub.socket); sessions.push(session); session.start(); return { session, ...state };
}
async function until(check: () => boolean) { const end = Date.now() + 5000; while (!check()) { if (Date.now() > end) throw new Error('Private test timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } }
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
