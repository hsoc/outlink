import { INTERNET_PUSH_ENABLED } from './push-feature';
import type { Event } from 'nostr-tools';

import { buildSigner, getAccount } from '@/services/account/account.service';
import { isGiftWrapProcessed } from '@/services/dm/sync-store';

import { APNS_RELAY_URL, fetchApnsGiftWrap } from './push-api';

const EVENT_ID = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{128}$/;

export type ApnsGiftWrap = {
  accountPubkey: string;
  event: Event;
  sourceRelay: typeof APNS_RELAY_URL;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shape checks only. Event IDs, signatures, seals and rumors are verified by shared intake. */
function giftWrap(value: unknown): value is Event {
  return record(value) && value.kind === 1059 &&
    typeof value.id === 'string' && EVENT_ID.test(value.id) &&
    typeof value.pubkey === 'string' && EVENT_ID.test(value.pubkey) &&
    typeof value.sig === 'string' && SIGNATURE.test(value.sig) &&
    typeof value.content === 'string' && typeof value.created_at === 'number' &&
    Number.isSafeInteger(value.created_at) && value.created_at >= 0 &&
    Array.isArray(value.tags) && value.tags.every((tag) =>
      Array.isArray(tag) && tag.every((part) => typeof part === 'string'));
}

function recipientPubkeys(event: Event): string[] {
  return [...new Set(event.tags.filter((tag) => tag[0] === 'p' && EVENT_ID.test(tag[1] ?? ''))
    .map((tag) => tag[1]))];
}

/**
 * Normalize APNs into the shared intake's event/account/source inputs. A durable
 * processed-ID lookup precedes signer construction, ID fetch and event intake.
 * Returned events remain untrusted until the common verification pipeline accepts them.
 */
export async function resolveApnsGiftWrap(payload: unknown): Promise<ApnsGiftWrap[]> {
  if (!INTERNET_PUSH_ENABLED) return [];
  if (!record(payload) || !record(payload.data)) return [];
  if (payload.type === 'event') {
    if (!giftWrap(payload.data)) return [];
    const resolved: ApnsGiftWrap[] = [];
    for (const accountPubkey of recipientPubkeys(payload.data)) {
      if (await isGiftWrapProcessed(payload.data.id, accountPubkey)) continue;
      if (!await getAccount(accountPubkey)) continue;
      resolved.push({ accountPubkey, event: payload.data, sourceRelay: APNS_RELAY_URL });
    }
    return resolved;
  }
  if (payload.type !== 'id' || typeof payload.data.id !== 'string' ||
    !EVENT_ID.test(payload.data.id) || typeof payload.data.p !== 'string' ||
    !EVENT_ID.test(payload.data.p)) return [];
  const eventId = payload.data.id;
  const accountPubkey = payload.data.p;
  if (await isGiftWrapProcessed(eventId, accountPubkey)) return [];
  if (!await getAccount(accountPubkey)) return [];
  const signer = await buildSigner(accountPubkey);
  let event: unknown;
  try {
    event = await fetchApnsGiftWrap(signer, eventId);
  } finally { await signer.destroy?.(); }
  if (!giftWrap(event) || !recipientPubkeys(event).includes(accountPubkey)) {
    throw new Error('Invalid APNs gift-wrap response');
  }
  // A live subscription may have finished processing while the HTTP request waited.
  if (await isGiftWrapProcessed(eventId, accountPubkey)) return [];
  return [{ accountPubkey, event, sourceRelay: APNS_RELAY_URL }];
}
