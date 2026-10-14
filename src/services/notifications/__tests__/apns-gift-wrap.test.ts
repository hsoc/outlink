import { resolveApnsGiftWrap } from '../apns-gift-wrap';
import { APNS_RELAY_URL } from '../push-api';

let mockInternetPushEnabled = true;
jest.mock('../push-feature', () => ({ get INTERNET_PUSH_ENABLED() { return mockInternetPushEnabled; } }));

const mockProcessed = jest.fn();
const mockAccount = jest.fn();
const mockSigner = jest.fn();
const mockFetch = jest.fn();
const mockDestroy = jest.fn();
jest.mock('@/services/account/account.service', () => ({
  getAccount: (...args: unknown[]) => mockAccount(...args),
  buildSigner: (...args: unknown[]) => mockSigner(...args),
}));
jest.mock('@/services/dm/sync-store', () => ({
  isGiftWrapProcessed: (...args: unknown[]) => mockProcessed(...args),
}));
jest.mock('../push-api', () => ({
  APNS_RELAY_URL: 'wss://relay.outlink.invalid/',
  fetchApnsGiftWrap: (...args: unknown[]) => mockFetch(...args),
}));

const account = 'a'.repeat(64);
const eventId = 'b'.repeat(64);
const event = {
  id: eventId, kind: 1059, pubkey: 'c'.repeat(64), created_at: 100,
  sig: 'd'.repeat(128), content: 'encrypted', tags: [['p', account]],
};
const signer = { destroy: mockDestroy };
const idPayload = { type: 'id', data: { id: eventId, p: account } };

beforeEach(() => {
  mockInternetPushEnabled = true;
  jest.clearAllMocks();
  mockProcessed.mockReset().mockResolvedValue(false);
  mockAccount.mockResolvedValue({ pubkey: account });
  mockSigner.mockResolvedValue(signer);
  mockFetch.mockReset().mockResolvedValue(event);
});

it('skips a processed ID before reading the account, opening a signer, or fetching', async () => {
  mockProcessed.mockResolvedValue(true);
  await expect(resolveApnsGiftWrap(idPayload)).resolves.toEqual([]);
  expect(mockProcessed).toHaveBeenCalledWith(eventId, account);
  expect(mockAccount).not.toHaveBeenCalled();
  expect(mockSigner).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('resolves a new ID using its recipient account and the fixed APNs relay source', async () => {
  await expect(resolveApnsGiftWrap({ ...idPayload, relay: 'https://untrusted.example' }))
    .resolves.toEqual([{ accountPubkey: account, event, sourceRelay: APNS_RELAY_URL }]);
  expect(mockSigner).toHaveBeenCalledWith(account);
  expect(mockFetch).toHaveBeenCalledWith(signer, eventId);
  expect(mockDestroy).toHaveBeenCalledTimes(1);
});

it('skips shared intake if the live receiver processed the event during the fetch', async () => {
  mockProcessed.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await expect(resolveApnsGiftWrap(idPayload)).resolves.toEqual([]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('passes an inline event without fetching or opening a signer', async () => {
  await expect(resolveApnsGiftWrap({ type: 'event', data: event }))
    .resolves.toEqual([{ accountPubkey: account, event, sourceRelay: APNS_RELAY_URL }]);
  expect(mockFetch).not.toHaveBeenCalled();
  expect(mockSigner).not.toHaveBeenCalled();
});

it('skips a processed inline event', async () => {
  mockProcessed.mockResolvedValue(true);
  await expect(resolveApnsGiftWrap({ type: 'event', data: event })).resolves.toEqual([]);
  expect(mockAccount).not.toHaveBeenCalled();
});

it('does not fetch for an account that is no longer installed', async () => {
  mockAccount.mockResolvedValue(null);
  await expect(resolveApnsGiftWrap(idPayload)).resolves.toEqual([]);
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([null, { type: 'unknown', data: event }, { type: 'id', data: { id: '../events', p: account } },
  { type: 'event', data: { ...event, tags: [null] } }])('ignores malformed payload %j', async (payload) => {
  await expect(resolveApnsGiftWrap(payload)).resolves.toEqual([]);
  expect(mockProcessed).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('rejects a fetched event addressed to a different account', async () => {
  mockFetch.mockResolvedValue({ ...event, tags: [['p', 'e'.repeat(64)]] });
  await expect(resolveApnsGiftWrap(idPayload)).rejects.toThrow('Invalid APNs gift-wrap response');
  expect(mockDestroy).toHaveBeenCalledTimes(1);
});

it('cleans up the signer after a network failure without marking the event processed', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  await expect(resolveApnsGiftWrap(idPayload)).rejects.toThrow('offline');
  expect(mockDestroy).toHaveBeenCalledTimes(1);
});

it('ignores incoming pushes before account lookup or network access when disabled', async () => {
  mockInternetPushEnabled = false;
  await expect(resolveApnsGiftWrap(idPayload)).resolves.toEqual([]);
  await expect(resolveApnsGiftWrap({ type: 'event', data: event })).resolves.toEqual([]);
  expect(mockAccount).not.toHaveBeenCalled();
  expect(mockSigner).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});
