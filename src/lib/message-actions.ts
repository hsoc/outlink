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
