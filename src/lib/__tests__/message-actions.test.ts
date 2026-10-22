/** @jest-environment node */
import { messageUserKey, socialMessage } from '../message-actions';
it('formats requested social actions using a single-line literal nickname', () => {
  expect(socialMessage('hug', 'Alice#1234')).toBe('/me gives Alice#1234 a warm hug 🫂');
  expect(socialMessage('slap', ' Alice\nSmith ')).toBe('/me slaps Alice Smith around a bit with a large trout 🐟');
  expect(socialMessage('hug', '$&')).toBe('/me gives $& a warm hug 🫂');
});
it('binds the same Nostr identity in location and bridged messages without using a nickname', () => {
  const key = 'a'.repeat(64);
  expect(messageUserKey({ pubkey: key } as never)).toBe('nostr:' + key);
  expect(messageUserKey({ peer: 'bridge:' + key, bridge: { pubkey: key } } as never)).toBe('nostr:' + key);
  expect(messageUserKey({ peer: '1234567890abcdef' } as never)).toBe('mesh:1234567890abcdef');
});
