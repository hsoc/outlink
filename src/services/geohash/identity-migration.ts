import { finalizeEvent, getEventHash, verifyEvent, type Event } from 'nostr-tools/pure';
import { normalizeGeohash } from './geohash';
export const MIGRATION_KIND = 30078;
const DOMAIN = 'outlink/channel-rotation/v1';
/** A new-key possession proof is carried only inside an old-key authenticated envelope. */
export function migrationProof(hash: string, previous: string, nextKey: Uint8Array, created: number, expires: number): Event {
  if (!/^[0-9a-f]{64}$/.test(previous) || !Number.isSafeInteger(created) || !Number.isSafeInteger(expires) || expires <= created) throw new Error('Invalid migration');
  return finalizeEvent({ kind: MIGRATION_KIND, created_at: Math.floor(created / 1000), tags: [['d', DOMAIN], ['g', normalizeGeohash(hash)], ['p', previous]],
    content: JSON.stringify({ version: 1, previous, created, expires }) }, nextKey);
}
export function validMigration(value: unknown, hash: string, sender: string, now = Date.now()): Event | null {
  try {
    const event = value as Event;
    if (!event || JSON.stringify(event).length > 2048 || event.kind !== MIGRATION_KIND || !/^[0-9a-f]{64}$/.test(event.pubkey) || event.pubkey === sender ||
        JSON.stringify(event.tags) !== JSON.stringify([['d', DOMAIN], ['g', normalizeGeohash(hash)], ['p', sender]]) || typeof event.content !== 'string') return null;
    const content = JSON.parse(event.content);
    if (content.version !== 1 || content.previous !== sender || !Number.isSafeInteger(content.created) || !Number.isSafeInteger(content.expires) ||
        content.created > now + 60000 || content.created < now - 172800000 || content.expires <= now || content.expires > content.created + 172800000 || event.created_at !== Math.floor(content.created / 1000)) return null;
    return getEventHash(event) === event.id && verifyEvent(event) ? event : null;
  } catch { return null; }
}
