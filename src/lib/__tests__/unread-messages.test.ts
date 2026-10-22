/** @jest-environment node */
import { unreadPrivateMessages, unreadLocationMessages } from '../unread-messages';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
const incoming: BitchatMessage = { id: 'one', peer: 'alice', recipient: 'me', name: 'Alice', content: 'secret', timestamp: 0, outgoing: false, delivery: 'delivered' };
it('counts only unread received private messages, grouped by sender', () => {
  const messages = [incoming, { ...incoming, id: 'two' }, { ...incoming, peer: 'bob' }, { ...incoming, recipient: undefined }, { ...incoming, outgoing: true }, { ...incoming, delivery: 'read' as const }];
  expect([...unreadPrivateMessages(messages, new Set(['bob']))]).toEqual([['alice', { name: 'Alice', count: 2 }]]);
  expect(unreadPrivateMessages([{ ...incoming, delivery: 'read' }], new Set()).size).toBe(0);
});

it('groups rotated location identities by their stable thread and hides blocked threads', () => {
  const threads = [{ peer: 'root', head: 'new', keys: ['old', 'new'], blocked: false }];
  const messages = [{ ...incoming, peer: 'old', channelThread: 'root' }, { ...incoming, id: 'two', peer: 'new' }];
  expect([...unreadLocationMessages(messages, threads)]).toEqual([['root', { name: 'Alice', count: 2 }]]);
  expect(unreadLocationMessages(messages, [{ ...threads[0], blocked: true }]).size).toBe(0);
  expect(unreadLocationMessages([{ ...messages[0], delivery: 'read' }], threads).size).toBe(0);
});
