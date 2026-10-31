/** @jest-environment node */
import { actionMessage, actionDisplay, messageUserKey, socialMessage, privateMessageTarget } from '../message-actions';
it('formats requested social actions using a single-line literal nickname', () => {
  expect(socialMessage('hug', 'Alice#1234')).toBe('/hug Alice#1234');
  expect(socialMessage('slap', ' Alice\nSmith ')).toBe('/slap Alice Smith');
  expect(socialMessage('hug', '$&')).toBe('/hug $&');
});
it('binds the same Nostr identity in location and bridged messages without using a nickname', () => {
  const key = 'a'.repeat(64);
  expect(messageUserKey({ pubkey: key } as never)).toBe('nostr:' + key);
  expect(messageUserKey({ peer: 'bridge:' + key, bridge: { pubkey: key } } as never)).toBe('nostr:' + key);
  expect(messageUserKey({ peer: '1234567890abcdef' } as never)).toBe('mesh:1234567890abcdef');
});

it('opens location and Nearby targets without requiring transport/contact readiness and keeps bridge identities distinct', () => {
  expect(privateMessageTarget({ pubkey: 'public-key' } as never, 'geo')).toEqual({ kind: 'geo', peer: 'public-key' });
  expect(privateMessageTarget({ peer: 'rotated-key', channelThread: 'root' } as never, 'geo')).toEqual({ kind: 'geo', peer: 'root' });
  expect(privateMessageTarget({ peer: 'mesh-peer' } as never, 'mesh')).toEqual({ kind: 'mesh', peer: 'mesh-peer' });
  expect(privateMessageTarget({ peer: 'bridge:key', bridge: { pubkey: 'key' } } as never, 'mesh')).toEqual({ kind: 'bridge' });
});

it('encodes commands as Bitchat actions exactly once', () => {
  expect(actionMessage(socialMessage('hug', 'quattro'), 'Outlink')).toBe('* 🫂 Outlink hugs quattro *');
  expect(actionMessage('/slap @Alice', 'Bob')).toBe('* 🐟 Bob slaps Alice around a bit with a large trout *');
  expect(actionMessage('/me waves 👋', 'Bob')).toBe('* Bob waves 👋 *');
  for (const text of ['hello /me waves', '/meeting today', '* 🫂 Bob hugs Alice *', '/unknown x'])
    expect(actionMessage(text, 'Bob')).toBe(text);
  for (const text of ['/me', '/hug ', '/slap @']) expect(() => actionMessage(text, 'Bob')).toThrow();
});
it('displays legacy actions while preserving incoming Bitchat text', () => {
  expect(actionDisplay('/me gives quattro a warm hug 🫂', 'Bob#1234')).toBe('* Bob#1234 gives quattro a warm hug 🫂 *');
  for (const text of ['* 🐟 Bob slaps Alice around a bit with a large trout *', '/meeting', '/me', 'hello'])
    expect(actionDisplay(text, 'Bob')).toBe(text);
});
