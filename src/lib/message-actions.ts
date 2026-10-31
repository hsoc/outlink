import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { GeoMessage } from '@/services/geohash/geohash-session';
export function messageUserKey(message: BitchatMessage | GeoMessage): string {
  return 'pubkey' in message ? 'nostr:' + message.pubkey : message.bridge ? 'nostr:' + message.bridge.pubkey : 'mesh:' + message.peer;
}
export function socialMessage(action: 'hug' | 'slap', name: string): string {
  const label = name.replace(/\s+/gu, ' ').trim();
  return `/${action} ${label}`;
}

/** A public bridge identity cannot be assumed to be a Bluetooth peer identity. */
export function privateMessageTarget(message: BitchatMessage | GeoMessage, mode: 'mesh' | 'geo'):
  { kind: 'mesh' | 'geo'; peer: string } | { kind: 'bridge' } {
  if (mode === 'geo') return { kind: 'geo', peer: 'pubkey' in message ? message.pubkey : message.channelThread ?? message.peer };
  return 'peer' in message && !message.bridge ? { kind: 'mesh', peer: message.peer } : { kind: 'bridge' };
}

/** Expand commands before transport validation, signing, persistence and local echo. */
export function actionMessage(content: string, sender: string): string {
  const command = /^\/(me|hug|slap)(?:\s+([\s\S]*))?$/u.exec(content);
  if (!command) return content;
  const body = command[2]?.trim();
  if (!body) throw new Error('Action requires text or a nickname');
  const name = sender.replace(/\s+/gu, ' ').trim();
  if (command[1] === 'me') return `* ${name} ${body} *`;
  const target = body.replace(/\s+/gu, ' ').replace(/^@/u, '');
  if (!target) throw new Error('Action requires a nickname');
  return command[1] === 'hug'
    ? `* 🫂 ${name} hugs ${target} *`
    : `* 🐟 ${name} slaps ${target} around a bit with a large trout *`;
}

/** Adapt legacy Outlink actions for display without rewriting received content. */
export function actionDisplay(content: string, sender: string): string {
  const legacy = /^\/me\s+([\s\S]+)$/u.exec(content);
  return legacy?.[1].trim() ? `* ${sender} ${legacy[1].trim()} *` : content;
}
