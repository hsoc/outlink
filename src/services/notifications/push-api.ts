import { base64 } from '@scure/base';

import { platform } from '@/platform';
import type { PushDevice } from '@/platform/ports/push-notifications';
import type { Signer } from '@/services/signer/signer.interface';

/** Reserved placeholders: internet push stays disabled until a service is configured. */
export const APNS_RELAY_URL = 'wss://relay.outlink.invalid/';
export const APNS_HTTP_ORIGIN = 'https://relay.outlink.invalid';

export class PushApiError extends Error {
  constructor(readonly status: number) { super(`Push API returned ${status}`); }
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function supportsPush(origin: string): Promise<boolean> {
  const response = await request(`${origin}/`, { headers: { Accept: 'application/nostr+json' } });
  if (!response.ok) throw new PushApiError(response.status);
  const info = await response.json();
  return Array.isArray(info?.supported_nips) && info.supported_nips.includes(98) &&
    info?.outlink?.push?.version === 1;
}

/** Resolve only the deployed APNs relay's ID payload; no push-supplied destination is used. */
export async function fetchApnsGiftWrap(signer: Signer, eventId: string): Promise<unknown> {
  if (!/^[0-9a-f]{64}$/.test(eventId)) throw new Error('Invalid gift-wrap event ID');
  const url = `${APNS_HTTP_ORIGIN}/v1/events/${eventId}`;
  const event = await signer.signEvent({
    kind: 27235, content: '', created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', 'GET']],
  });
  const response = await request(url, {
    method: 'GET',
    headers: { Authorization: `Nostr ${base64.encode(new TextEncoder().encode(JSON.stringify(event)))}` },
    cache: 'no-store',
  });
  if (response.status !== 200) throw new PushApiError(response.status);
  const giftWrap = await response.json();
  if (giftWrap?.id !== eventId) throw new Error('APNs event response ID mismatch');
  return giftWrap;
}

/** Every attempt signs anew, including retries after an uncertain mutation outcome. */
export async function mutatePushDevice(
  signer: Signer, origin: string, installationId: string, device: PushDevice | null,
  shouldSend: () => boolean = () => true,
): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(installationId)) throw new Error('Invalid installation ID');
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) throw new Error('Invalid push origin');
  const url = `${origin}/v1/push/devices/${installationId}`;
  const method = device ? 'PUT' : 'DELETE';
  const body = device ? JSON.stringify({ device_token: device.token, environment: device.environment }) : '';
  const payload = await platform.deviceCrypto.sha256Hex(new TextEncoder().encode(body));
  const nonce = await platform.deviceCrypto.randomUUID();
  const event = await signer.signEvent({
    kind: 27235, content: '', created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method], ['payload', payload], ['nonce', nonce]],
  });
  if (!shouldSend()) throw new Error('Push registration cancelled');
  const response = await request(url, {
    method,
    headers: {
      Authorization: `Nostr ${base64.encode(new TextEncoder().encode(JSON.stringify(event)))}`,
      ...(device ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(device ? { body } : {}),
  });
  if (response.status !== 204) throw new PushApiError(response.status);
}
