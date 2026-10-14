import { Platform } from 'react-native';
import { pushNotificationsAdapter as adapter } from '../push-notifications';

const mockEnvironment = jest.fn();
const mockReleaseType = jest.fn();
const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockRemove = jest.fn();
const mockAddListener = jest.fn();
let mockNative: Record<string, unknown> | null;
let mockApplicationId = 'io.github.hsoc.outlink.dev';
jest.mock('expo-application', () => ({
  get applicationId() { return mockApplicationId; },
  getIosPushNotificationServiceEnvironmentAsync: () => mockEnvironment(),
  getIosApplicationReleaseTypeAsync: () => mockReleaseType(),
  ApplicationReleaseType: { APP_STORE: 3 },
}));
jest.mock('../local-notifications', () => ({ loadLocalNotifications: () => mockNative }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockEnvironment.mockResolvedValue('development');
  mockApplicationId = 'io.github.hsoc.outlink.dev';
  mockReleaseType.mockResolvedValue(3);
  mockRegister.mockResolvedValue('0012ABcd');
  mockAddListener.mockReturnValue({ remove: mockRemove });
  mockNative = { notificationProcessorVersion: 1, registerPushAsync: mockRegister, unregisterPushAsync: mockUnregister, addListener: mockAddListener };
});
afterEach(() => { jest.restoreAllMocks(); });

it.each([
  ['development', 'sandbox'], ['production', 'production'],
])('maps signed %s APNs to %s and preserves every token byte', async (signed, expected) => {
  mockEnvironment.mockResolvedValue(signed);
  mockApplicationId = signed === 'development' ? 'io.github.hsoc.outlink.dev' : 'io.github.hsoc.outlink';
  await expect(adapter.getDevice()).resolves.toEqual({ token: '0012abcd', environment: expected });
  expect(mockRegister).toHaveBeenCalledTimes(1);
});

it('uses production APNs for a store installation with its embedded profile removed', async () => {
  mockEnvironment.mockResolvedValue(null);
  mockApplicationId = 'io.github.hsoc.outlink';
  await expect(adapter.getDevice()).resolves.toEqual({ token: '0012abcd', environment: 'production' });
});

it('does not register when the environment cannot be established', async () => {
  mockEnvironment.mockResolvedValue(null);
  mockReleaseType.mockResolvedValue(0);
  await expect(adapter.getDevice()).rejects.toThrow('no APNs environment');
  expect(mockRegister).not.toHaveBeenCalled();
});

it('rejects a development bundle signed for production APNs because the relay has no matching topic', async () => {
  mockEnvironment.mockResolvedValue('production');
  await expect(adapter.getDevice()).rejects.toThrow('configured relay topic');
  expect(mockRegister).not.toHaveBeenCalled();
});

it.each(['<0012 abcd>', 'ExponentPushToken[abc]', 'abc', '', 'aa'.repeat(129)])('rejects malformed native token %s', async (token) => {
  mockRegister.mockResolvedValue(token);
  await expect(adapter.getDevice()).rejects.toThrow('Invalid native APNs token');
});

it('forwards token changes and unsubscribes', () => {
  const listener = jest.fn();
  const dispose = adapter.addTokenChangedListener(listener);
  expect(mockAddListener).toHaveBeenCalledWith('onPushTokenChanged', listener);
  dispose();
  expect(mockRemove).toHaveBeenCalledTimes(1);
});

it('tolerates older native builds and leaves Android registration unavailable', async () => {
  mockNative = {};
  expect(adapter.isAvailable()).toBe(false);
  await expect(adapter.getDevice()).resolves.toBeNull();
  mockNative = { notificationProcessorVersion: 1, registerPushAsync: mockRegister };
  jest.replaceProperty(Platform, 'OS', 'android');
  expect(adapter.isAvailable()).toBe(false);
  await expect(adapter.getDevice()).resolves.toBeNull();
  expect(mockRegister).not.toHaveBeenCalled();
});
