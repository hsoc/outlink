/** @jest-environment node */
import { dmShortcuts, locationDmNames } from '../dm-shortcuts';
it('puts the selected conversation and unread senders ahead of recent threads without duplicate buttons', () => {
  const unread = new Map([['alice', { name: 'Alice', count: 3 }], ['bob', { name: 'Bob', count: 1 }]]);
  expect(dmShortcuts(unread, 'bob', new Map([['alice', 'Alice#abcd']]), ['alice', 'old', 'blocked'], new Set(['blocked']))).toEqual([
    { peer: 'bob', name: 'Bob', count: 1 }, { peer: 'alice', name: 'Alice#abcd', count: 3 }, { peer: 'old', name: 'old', count: 0 },
  ]);
  expect(dmShortcuts(new Map(), 'alice', new Map([['alice', 'Alice']]))).toEqual([{ peer: 'alice', name: 'Alice', count: 0 }]);
});
it('keeps blocked senders out of unread/recent shortcuts while retaining an explicitly selected thread without a badge', () => {
  const unread = new Map([['blocked', { name: 'Blocked', count: 4 }]]), blocked = new Set(['blocked']);
  expect(dmShortcuts(unread, undefined, new Map(), ['blocked'], blocked)).toEqual([]);
  expect(dmShortcuts(unread, 'blocked', new Map(), [], blocked)).toEqual([{ peer: 'blocked', name: 'Blocked', count: 0 }]);
});
it('uses an exact area public key or proven alias for a Location name, never a matching nickname from another key', () => {
  const threads = [{ peer: 'root', head: 'new', keys: ['root', 'old', 'new'] }];
  const messages = [{ peer: 'old', channelThread: 'root', name: 'old-key', outgoing: false }, { peer: 'new', channelThread: 'root', name: 'My own name', outgoing: true }];
  const names = locationDmNames([{ identity: 'new', name: 'Alice' }, { identity: 'unrelated', name: 'Alice' }], messages, threads);
  expect(names.get('root')).toBe('Alice'); expect(names.get('unrelated')).toBe('Alice');
  expect(locationDmNames([{ identity: 'unrelated', name: 'Alice' }], messages, threads).get('root')).toBe('old-key');
  expect(locationDmNames([], messages, threads).get('root')).toBe('old-key');
  expect(locationDmNames([], [], []).size).toBe(0);
});
