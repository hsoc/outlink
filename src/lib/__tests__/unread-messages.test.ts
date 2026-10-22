/** @jest-environment node */
import { unreadPrivateMessages } from '../unread-messages';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
const incoming: BitchatMessage = { id: 'one', peer: 'alice', recipient: 'me', name: 'Alice', content: 'secret', timestamp: 0, outgoing: false, delivery: 'delivered' };
it('counts only unread received private messages, grouped by sender', () => {
  const messages = [incoming, { ...incoming, id: 'two' }, { ...incoming, peer: 'bob' }, { ...incoming, recipient: undefined }, { ...incoming, outgoing: true }, { ...incoming, delivery: 'read' as const }];
  expect([...unreadPrivateMessages(messages, new Set(['bob']))]).toEqual([['alice', { name: 'Alice', count: 2 }]]);
  expect(unreadPrivateMessages([{ ...incoming, delivery: 'read' }], new Set()).size).toBe(0);
});
