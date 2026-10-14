import { base64 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools';

import { fetchApnsGiftWrap, mutatePushDevice, supportsPush, PushApiError } from '../push-api';

let mockNonce = 0;
jest.mock('@/platform', () => {
  const { sha256 } = jest.requireActual('@noble/hashes/sha2.js');
  const { bytesToHex } = jest.requireActual('@noble/hashes/utils.js');
  return { platform: { deviceCrypto: {
    randomUUID: async () => `nonce-${++mockNonce}`,
    sha256Hex: async (body: Uint8Array) => bytesToHex(sha256(body)),
  } } };
});

const key = generateSecretKey();
const signer = {
  getPublicKey: jest.fn(),
  signEvent: jest.fn(async (template) => finalizeEvent(template, key)),
};
const origin = 'https://relay.outlink.invalid';
const device = { token: '0012abcd', environment: 'sandbox' as const };
const mockFetch = jest.fn();
const originalFetch = global.fetch;
beforeAll(() => { global.fetch = mockFetch; });
afterAll(() => { global.fetch = originalFetch; });
beforeEach(() => { mockFetch.mockReset(); mockFetch.mockResolvedValue({ status: 204 }); });

function authEvent(call = 0) {
  const init = mockFetch.mock.calls[call][1];
  return JSON.parse(new TextDecoder().decode(base64.decode(init.headers.Authorization.slice(6))));
}

it('signs the exact transmitted PUT bytes with the identity and accepts an empty 204', async () => {
  await mutatePushDevice(signer, origin, 'installation-1', device);
  const [url, init] = mockFetch.mock.calls[0];
  const event = authEvent();
  expect(url).toBe(`${origin}/v1/push/devices/installation-1`);
  expect(init.body).toBe('{"device_token":"0012abcd","environment":"sandbox"}');
  expect(init.method).toBe('PUT');
  expect(verifyEvent(event)).toBe(true);
  expect(event.kind).toBe(27235);
  expect(event.content).toBe('');
  expect(event.tags).toEqual([
    ['u', url], ['method', 'PUT'],
    ['payload', bytesToHex(sha256(new TextEncoder().encode(init.body)))],
    ['nonce', expect.any(String)],
  ]);
});

it('hashes an empty DELETE body and gives each mutation attempt fresh authorization', async () => {
  await mutatePushDevice(signer, origin, 'installation-1', null);
  await mutatePushDevice(signer, origin, 'installation-1', null);
  expect(mockFetch.mock.calls[0][1]).not.toHaveProperty('body');
  expect(authEvent().tags).toContainEqual(['payload', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855']);
  expect(authEvent().tags).toContainEqual(['method', 'DELETE']);
  expect(authEvent().id).not.toBe(authEvent(1).id);
});

it('rejects ordinary non-JSON HTTP failures without attempting to parse them', async () => {
  mockFetch.mockResolvedValue({ status: 404 });
  await expect(mutatePushDevice(signer, origin, 'installation', device)).rejects.toEqual(new PushApiError(404));
});

it('does not send a PUT if consent is withdrawn while signing', async () => {
  let consent = true;
  const slowSigner = {
    ...signer,
    signEvent: async (template: Parameters<typeof finalizeEvent>[0]) => {
      consent = false;
      return finalizeEvent(template, key);
    },
  };
  await expect(mutatePushDevice(slowSigner, origin, 'installation', device, () => consent))
    .rejects.toThrow('Push registration cancelled');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('discovers the exact supported API version and NIP-98 capability', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ supported_nips: [98], outlink: { push: { version: 1 } } }) });
  await expect(supportsPush(origin)).resolves.toBe(true);
  expect(mockFetch.mock.calls[0]).toEqual([`${origin}/`, expect.objectContaining({ headers: { Accept: 'application/nostr+json' } })]);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ supported_nips: [], outlink: { push: { version: 1 } } }) });
  await expect(supportsPush(origin)).resolves.toBe(false);
});

it('fetches an ID from the fixed endpoint with a signed bodyless NIP-98 GET', async () => {
  const id = 'a'.repeat(64);
  mockFetch.mockResolvedValue({ status: 200, json: async () => ({ id, kind: 1059 }) });
  await expect(fetchApnsGiftWrap(signer, id)).resolves.toEqual({ id, kind: 1059 });
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toBe(`https://relay.outlink.invalid/v1/events/${id}`);
  expect(init.method).toBe('GET');
  expect(init).not.toHaveProperty('body');
  expect(authEvent().tags).toEqual([['u', url], ['method', 'GET']]);
  expect(verifyEvent(authEvent())).toBe(true);
});

it('rejects a mismatched event ID and a non-JSON HTTP error', async () => {
  const id = 'a'.repeat(64);
  mockFetch.mockResolvedValue({ status: 200, json: async () => ({ id: 'b'.repeat(64) }) });
  await expect(fetchApnsGiftWrap(signer, id)).rejects.toThrow('ID mismatch');
  mockFetch.mockResolvedValue({ status: 404 });
  await expect(fetchApnsGiftWrap(signer, id)).rejects.toEqual(new PushApiError(404));
});
