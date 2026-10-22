/** @jest-environment node */
import { MessageOutbox, type PendingMessage, type OutboxStorage } from '../compatibility/outbox';
import type { BitchatMessage } from '../bitchat-session';
function fixture() {
  let now = 100000;
  const records = new Map<string, PendingMessage>(), changed: BitchatMessage[] = [];
  const key = (peer: string, id: string) => `${peer}:${id}`;
  const storage: OutboxStorage = {
    list: async peer => [...records].filter(([id]) => id.startsWith(peer + ':')).map(([, entry]) => structuredClone(entry)),
    get: async (peer, id) => structuredClone(records.get(key(peer, id)) ?? null),
    put: async (peer, id, entry) => { records.set(key(peer, id), structuredClone(entry)); },
    remove: async (peer, id) => { records.delete(key(peer, id)); },
  };
  const outbox = new MessageOutbox(storage, message => changed.push(message), () => now);
  const message = (id: string): BitchatMessage => ({ id, peer: 'alice', recipient: 'bob', name: 'Alice', content: id, timestamp: now++, outgoing: true, delivery: 'sending' });
  return { records, storage, changed, outbox, message, advance(ms: number) { now += ms; } };
}
it('persists before sending, preserves queued mail while offline and across reconstruction, and binds receipts to the recipient', async () => {
  const f = fixture(); await f.outbox.enqueue('bob', f.message('one'));
  const deliver = jest.fn(async () => { expect(f.records.has('bob:one')).toBe(true); });
  await f.outbox.flush('bob', deliver, () => false);
  expect(deliver).not.toHaveBeenCalled(); expect(f.records.get('bob:one')?.attempts).toBe(0);
  const reopened = new MessageOutbox(f.storage, message => f.changed.push(message), () => 100001);
  await reopened.flush('bob', deliver);
  expect(deliver).toHaveBeenCalledTimes(1); expect(f.changed.at(-1)?.delivery).toBe('sent');
  await reopened.acknowledge('mallory', 'one', 'delivered'); expect(f.records.has('bob:one')).toBe(true);
  await reopened.acknowledge('bob', 'one', 'read'); expect(f.records.size).toBe(0); expect(f.changed.at(-1)?.delivery).toBe('read');
});
it('does not downgrade an acknowledgment arriving inside transmission or resurrect its queue entry', async () => {
  const f = fixture(); await f.outbox.enqueue('bob', f.message('fast'));
  await f.outbox.flush('bob', async () => { await f.outbox.acknowledge('bob', 'fast', 'delivered'); });
  expect(f.changed.at(-1)?.delivery).toBe('delivered'); expect(f.records.size).toBe(0);
});
it('serializes concurrent enqueues to enforce the per-contact quota and rejects ID reuse', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 104 }, (_, id) => f.outbox.enqueue('bob', f.message(String(id)))));
  expect(f.records.size).toBe(100); expect(f.changed.filter(message => message.delivery === 'failed')).toHaveLength(4);
  await expect(f.outbox.enqueue('bob', { ...f.message('103'), content: 'changed' })).rejects.toThrow('reused');
  await expect(f.outbox.enqueue('carol', f.message('wrong'))).rejects.toThrow('recipient');
});
it('throttles retries, stops at the attempt budget, and expires offline entries', async () => {
  const f = fixture(); await f.outbox.enqueue('bob', f.message('retry'));
  const deliver = jest.fn(async () => { throw new Error('disconnected'); });
  await f.outbox.flush('bob', deliver); await f.outbox.flush('bob', deliver); expect(deliver).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 8; ++i) { f.advance(30000); await f.outbox.flush('bob', deliver); }
  expect(deliver).toHaveBeenCalledTimes(8); expect(f.records.size).toBe(0); expect(f.changed.at(-1)?.delivery).toBe('failed');
  await f.outbox.enqueue('bob', f.message('expired')); f.advance(86400001);
  await f.outbox.flush('bob', deliver, () => false); expect(f.records.size).toBe(0);
});
it('coalesces concurrent flushes and cancels the remaining batch on stop', async () => {
  const f = fixture(); await f.outbox.enqueue('bob', f.message('first')); await f.outbox.enqueue('bob', f.message('second'));
  const deliver = jest.fn(async () => { f.outbox.cancelFlushes(); });
  await Promise.all([f.outbox.flush('bob', deliver), f.outbox.flush('bob', deliver)]); await f.outbox.idle();
  expect(deliver).toHaveBeenCalledTimes(1); expect(f.records.get('bob:second')?.attempts).toBe(0);
});

it('keeps a stable conversation scope separate from full wire-recipient authorization', async () => {
  const f = fixture(), message = { ...f.message('rotated'), channelThread: 'bob-original', recipient: 'bob-new' };
  await f.outbox.enqueue('bob-original', message);
  await expect(f.outbox.acknowledge('bob-original', message.id, 'read')).rejects.toThrow('identity mismatch');
  await expect(f.outbox.acknowledge('bob-original', message.id, 'read', 'mallory')).rejects.toThrow('identity mismatch');
  await expect(f.outbox.enqueue('bob-original', { ...message, recipient: 'bob-another' })).rejects.toThrow('reused');
  await f.outbox.acknowledge('bob-original', message.id, 'read', 'bob-new'); expect(f.records.size).toBe(0);
});
it('discards only the selected peer and does not resurrect an in-flight delivery', async () => {
  const f = fixture(); await f.outbox.enqueue('bob', f.message('one')); await f.outbox.enqueue('bob', f.message('two'));
  await f.outbox.enqueue('carol', { ...f.message('other'), recipient: 'carol' });
  let release!: () => void;
  const deliver = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const flushing = f.outbox.flush('bob', deliver);
  while (!release) await Promise.resolve();
  const discarded = await f.outbox.discard('bob');
  expect(discarded.map(message => message.id)).toEqual(['one', 'two']);
  release(); await flushing;
  expect(deliver).toHaveBeenCalledTimes(1); expect(await f.storage.list('bob')).toEqual([]);
  expect(await f.storage.list('carol')).toHaveLength(1);
  expect(f.changed.some(message => message.delivery === 'sent')).toBe(false);
});
