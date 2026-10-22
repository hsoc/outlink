import english from '@/i18n/en.json';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { GeoMessage } from '@/services/geohash/geohash-session';
export function messageUserKey(message: BitchatMessage | GeoMessage): string {
  return 'pubkey' in message ? 'nostr:' + message.pubkey : message.bridge ? 'nostr:' + message.bridge.pubkey : 'mesh:' + message.peer;
}
export function socialMessage(action: 'hug' | 'slap', name: string): string {
  const label = name.replace(/\s+/gu, ' ').trim();
  return english.mobile[action === 'hug' ? 'action_text_hug' : 'action_text_slap'].replace('{{name}}', () => label);
}

/** A public bridge identity cannot be assumed to be a Bluetooth peer identity. */
export function privateMessageTarget(message: BitchatMessage | GeoMessage, mode: 'mesh' | 'geo'):
  { kind: 'mesh' | 'geo'; peer: string } | { kind: 'bridge' } {
  if (mode === 'geo') return { kind: 'geo', peer: 'pubkey' in message ? message.pubkey : message.channelThread ?? message.peer };
  return 'peer' in message && !message.bridge ? { kind: 'mesh', peer: message.peer } : { kind: 'bridge' };
}
