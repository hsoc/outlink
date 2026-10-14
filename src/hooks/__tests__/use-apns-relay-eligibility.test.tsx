import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useApnsRelayEligibility } from '../use-apns-relay-eligibility';

let mockIos = true;
let mockPubkey: string | null = 'self';
let mockQuery = { isResolved: false, data: [] as { relayUrl: string }[], error: undefined as Error | undefined };
const mockWhere = jest.fn(() => ({}));
jest.mock('@/db/client', () => ({ db: { select: () => ({ from: () => ({ where: mockWhere }) }) } }));
jest.mock('@/db/use-live-query', () => ({ useLiveQuery: () => mockQuery }));
jest.mock('@/lib/platform', () => ({ get IS_IOS() { return mockIos; } }));
jest.mock('@/services/notifications/push-api', () => ({ APNS_RELAY_URL: 'wss://relay.outlink.invalid/' }));
jest.mock('@/stores/active-account.store', () => ({
  useActiveAccount: (select: (state: { activePubkey: string | null }) => unknown) => select({ activePubkey: mockPubkey }),
}));

let renderer: ReactTestRenderer;
let result: ReturnType<typeof useApnsRelayEligibility>;
function Harness() {
  const eligibility = useApnsRelayEligibility();
  useEffect(() => { result = eligibility; }, [eligibility]);
  return null;
}
beforeEach(() => {
  mockIos = true;
  mockPubkey = 'self';
  mockQuery = { isResolved: false, data: [], error: undefined };
});
afterEach(() => { act(() => renderer?.unmount()); });
async function render() { await act(async () => { renderer = create(<Harness />); }); }

it('disables during loading and follows saved relay removal and restoration', async () => {
  await render();
  expect(result).toEqual({ eligible: false, resolved: false });
  mockQuery = { isResolved: true, data: [{ relayUrl: 'wss://relay.outlink.invalid' }], error: undefined };
  await act(async () => { renderer.update(<Harness />); });
  expect(result.eligible).toBe(true);
  mockQuery.data = [];
  await act(async () => { renderer.update(<Harness />); });
  expect(result).toEqual({ eligible: false, resolved: true });
  mockQuery.data = [{ relayUrl: 'wss://relay.outlink.invalid/' }];
  await act(async () => { renderer.update(<Harness />); });
  expect(result.eligible).toBe(true);
});

it('rejects retained results during an account change', async () => {
  mockQuery = { isResolved: true, data: [{ relayUrl: 'wss://relay.outlink.invalid' }], error: undefined };
  await render();
  mockPubkey = 'other';
  mockQuery.isResolved = false;
  await act(async () => { renderer.update(<Harness />); });
  expect(result.eligible).toBe(false);
});

it('leaves Android and desktop controls available', async () => {
  mockIos = false;
  await render();
  expect(result).toEqual({ eligible: true, resolved: true });
});

it('does not allow enabling after a query failure', async () => {
  mockQuery = { isResolved: true, data: [], error: new Error('unavailable') };
  await render();
  expect(result.eligible).toBe(false);
});
