import { PushRegistrationService } from '../push-registration.service';

let mockInternetPushEnabled = true;
jest.mock('../push-feature', () => ({ get INTERNET_PUSH_ENABLED() { return mockInternetPushEnabled; } }));

const mockStore = new Map<string, string>();
const mockGetDevice = jest.fn();
const mockUnregister = jest.fn();
const mockPermission = jest.fn();
const mockMutate = jest.fn();
const mockSupports = jest.fn();
const mockRelays = jest.fn();
const mockAccounts = jest.fn();
const mockDestroy = jest.fn();

jest.mock('@/platform', () => ({ platform: {
  pushNotifications: { isAvailable: () => true, getDevice: (...args: unknown[]) => mockGetDevice(...args), unregister: () => mockUnregister() },
  secureStorage: { getItem: jest.fn(async () => null) },
  notifications: { hasPermission: () => mockPermission() },
  deviceCrypto: { randomUUID: async () => 'installation' },
} }));
jest.mock('@/services/preferences/device-preferences.service', () => ({
  getDevicePreference: async (key: string) => mockStore.get(key) ?? null,
  setDevicePreference: async (key: string, value: string) => { mockStore.set(key, value); },
}));
jest.mock('@/services/account/account-access', () => ({
  listAccounts: () => mockAccounts(),
  buildSigner: async (accountPubkey: string) => ({ accountPubkey, destroy: () => mockDestroy() }),
}));
jest.mock('@/services/relay/local-relay-settings', () => ({ loadAccountDmRelays: (pubkey: string) => mockRelays(pubkey) }));
jest.mock('../push-api', () => ({
  ...jest.requireActual('../push-api'),
  mutatePushDevice: (...args: unknown[]) => mockMutate(...args),
  supportsPush: (origin: string) => mockSupports(origin),
}));

const device = { token: '0012abcd', environment: 'sandbox' as const };
const origin = 'https://relay.outlink.invalid';
let service: PushRegistrationService;
beforeEach(() => {
  mockInternetPushEnabled = true;
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockStore.clear();
  mockGetDevice.mockResolvedValue(device);
  mockUnregister.mockResolvedValue(undefined);
  mockPermission.mockResolvedValue(true);
  mockMutate.mockReset().mockResolvedValue(undefined);
  mockSupports.mockResolvedValue(true);
  mockAccounts.mockResolvedValue([{ pubkey: 'a' }, { pubkey: 'b' }]);
  mockRelays.mockResolvedValue(['wss://relay.outlink.invalid']);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  service = new PushRegistrationService();
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it('does not obtain a token, discover relays, or register until explicitly enabled', async () => {
  await service.reconcile();
  expect(mockGetDevice).not.toHaveBeenCalled();
  expect(mockAccounts).not.toHaveBeenCalled();
  expect(mockSupports).not.toHaveBeenCalled();
  expect(mockMutate).not.toHaveBeenCalled();
});

it('also gates registration on OS authorization', async () => {
  mockPermission.mockResolvedValue(false);
  service.setEnabled(true);
  await service.reconcile();
  expect(mockGetDevice).not.toHaveBeenCalled();
  expect(mockMutate).not.toHaveBeenCalled();
});

it('registers every account once, persists installation identity, and updates rotated tokens', async () => {
  service.setEnabled(true);
  await service.reconcile();
  expect(mockMutate.mock.calls.map((call) => call.slice(0, 4))).toEqual([
    [expect.objectContaining({ accountPubkey: 'a' }), origin, 'installation', device],
    [expect.objectContaining({ accountPubkey: 'b' }), origin, 'installation', device],
  ]);
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).some((row: { accountPubkey: string; confirmed: boolean }) => row.accountPubkey === 'a' && row.confirmed)).toBe(true);
  await service.reconcile();
  expect(mockMutate).toHaveBeenCalledTimes(2);
  const rotated = { ...device, token: '0022abcd' };
  mockGetDevice.mockResolvedValue(rotated);
  await service.reconcile();
  expect(mockMutate).toHaveBeenCalledTimes(4);
  expect(mockMutate.mock.calls[3][3]).toEqual(rotated);
  expect(mockStore.get('notifications.apnsInstallationId')).toBe('installation');
  expect(mockSupports).toHaveBeenCalledTimes(1);
  expect(mockDestroy).toHaveBeenCalledTimes(4);
});

it('does not register an unsupported relay or derive origins from paths and insecure URLs', async () => {
  mockRelays.mockResolvedValue(['ws://insecure.example', 'wss://example.com/path', 'wss://relay.outlink.invalid']);
  mockSupports.mockResolvedValue(false);
  service.setEnabled(true);
  await service.reconcile();
  expect(mockSupports.mock.calls).toEqual([[origin]]);
  expect(mockMutate).not.toHaveBeenCalled();
});

it('revokes when disabled and retries durable offline revocations after a restart', async () => {
  service.setEnabled(true);
  await service.reconcile();
  mockMutate.mockRejectedValue(new Error('offline'));
  service.setEnabled(false);
  await service.reconcile();
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).every((row: { revoke: boolean }) => row.revoke)).toBe(true);
  expect(mockUnregister).toHaveBeenCalled();
  const restored = new PushRegistrationService();
  mockMutate.mockResolvedValue(undefined);
  mockMutate.mockClear();
  await restored.reconcile();
  expect(mockMutate).toHaveBeenCalledTimes(2);
  expect(mockMutate.mock.calls.every((call) => call[3] === null)).toBe(true);
  expect(mockStore.get('notifications.apnsRegistrations')).toBe('[]');
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).some((row: { accountPubkey: string; confirmed: boolean }) => row.accountPubkey === 'a' && row.confirmed)).toBe(false);
});

it('revokes a possibly accepted PUT after its response was lost', async () => {
  mockAccounts.mockResolvedValue([{ pubkey: 'a' }]);
  mockMutate.mockRejectedValueOnce(new Error('lost response'));
  service.setEnabled(true);
  await service.reconcile();
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).some((row: { accountPubkey: string; confirmed: boolean }) => row.accountPubkey === 'a' && row.confirmed)).toBe(false);
  service.setEnabled(false);
  await service.reconcile();
  expect(mockMutate.mock.calls[1][3]).toBeNull();
});

it('stops an in-flight token acquisition when the user disables notifications', async () => {
  let deliver!: (value: typeof device) => void;
  mockGetDevice.mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
  service.setEnabled(true);
  const enabled = service.reconcile();
  while (!deliver) await Promise.resolve();
  service.setEnabled(false);
  const disabled = service.reconcile();
  deliver(device);
  await Promise.all([enabled, disabled]);
  expect(mockMutate).not.toHaveBeenCalled();
  expect(mockUnregister).toHaveBeenCalled();
});

it('revokes removed relay membership without affecting another account', async () => {
  service.setEnabled(true);
  await service.reconcile();
  mockRelays.mockImplementation(async (pubkey: string) => pubkey === 'a' ? [] : ['wss://relay.outlink.invalid']);
  mockMutate.mockClear();
  await service.reconcile();
  expect(mockMutate.mock.calls).toEqual([[expect.objectContaining({ accountPubkey: 'a' }), origin, 'installation', null]]);
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).some((row: { accountPubkey: string; confirmed: boolean }) => row.accountPubkey === 'b' && row.confirmed)).toBe(true);
});

it('keeps a pending revocation and rejects account removal until the signer can revoke', async () => {
  service.setEnabled(true);
  await service.reconcile();
  mockMutate.mockRejectedValue(new Error('offline'));
  await expect(service.revokeAccount('a')).rejects.toThrow('offline');
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).find((row: { accountPubkey: string }) => row.accountPubkey === 'a').revoke).toBe(true);
  mockMutate.mockResolvedValue(undefined);
  await service.revokeAccount('a');
  await service.reconcile();
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).some((row: { accountPubkey: string; confirmed: boolean }) => row.accountPubkey === 'a' && row.confirmed)).toBe(false);
  service.accountAdded('a');
  await service.reconcile();
  expect(JSON.parse(mockStore.get('notifications.apnsRegistrations')!).some((row: { accountPubkey: string; confirmed: boolean }) => row.accountPubkey === 'a' && row.confirmed)).toBe(true);
});

it('revokes saved registrations without acquiring a token while internet push is disabled', async () => {
  mockInternetPushEnabled = false;
  mockStore.set('notifications.enabled', '1');
  mockStore.set('notifications.apnsInstallationId', 'installation');
  mockStore.set('notifications.apnsRegistrations', JSON.stringify([{ accountPubkey: 'a', origin, ...device, confirmed: true, revoke: false }]));
  service.setEnabled(true);
  await service.reconcile();
  expect(mockGetDevice).not.toHaveBeenCalled();
  expect(mockSupports).not.toHaveBeenCalled();
  expect(mockUnregister).toHaveBeenCalled();
  expect(mockMutate).toHaveBeenCalledWith(expect.anything(), origin, 'installation', null);
});

it('ignores a saved opt-in during cold reconciliation while push is disabled', async () => {
  mockInternetPushEnabled = false;
  mockStore.set('notifications.enabled', '1');
  await service.reconcile();
  expect(mockGetDevice).not.toHaveBeenCalled();
  expect(mockAccounts).not.toHaveBeenCalled();
});
