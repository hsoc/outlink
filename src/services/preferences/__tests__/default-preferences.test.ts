import {
  getDevicePreference,
  setDevicePreference,
} from '@/services/preferences/device-preferences.service';
import {
  DEFAULT_KEY_ROTATION_INTERVAL_DAYS,
  getKeyRotationSettings,
} from '@/services/dm/encryption-key-rotation-prefs';
import {
  DEFAULT_NOTIFICATION_CONTENT_PREFERENCES,
  getBatteryOptimizationPrompted,
  getNotificationContentPreferences,
  getNotificationsEnabled,
  getUnreadIndicatorsEnabled,
  setBatteryOptimizationPrompted,
  setNotificationContentPreferences,
  setNotificationsEnabled,
  setUnreadIndicatorsEnabled,
} from '@/services/notifications/notification-prefs';

jest.mock('@/services/preferences/device-preferences.service', () => ({
  deleteDevicePreference: jest.fn(),
  getDevicePreference: jest.fn(),
  setDevicePreference: jest.fn(),
}));

let mockIsIos = true;
jest.mock('@/lib/platform', () => ({ get IS_IOS() { return mockIsIos; } }));

const getPreference = jest.mocked(getDevicePreference);
const setPreference = jest.mocked(setDevicePreference);

beforeEach(() => {
  mockIsIos = true;
  getPreference.mockReset();
  setPreference.mockReset();
});

test('automatic encryption-key updates default to off, keeping the 30-day interval', async () => {
  getPreference.mockResolvedValueOnce(null);
  await expect(getKeyRotationSettings('account')).resolves.toEqual({
    enabled: false,
    intervalDays: DEFAULT_KEY_ROTATION_INTERVAL_DAYS,
  });
});

test.each([
  ['iOS', true, false],
  ['other platforms', false, true],
] as const)('notifications use the %s default and respect push availability', async (_platform, isIos, defaultEnabled) => {
  mockIsIos = isIos;
  getPreference.mockResolvedValueOnce(null);
  await expect(getNotificationsEnabled()).resolves.toBe(defaultEnabled);

  getPreference.mockResolvedValueOnce('1');
  await expect(getNotificationsEnabled()).resolves.toBe(!isIos);

  getPreference.mockResolvedValueOnce('0');
  await expect(getNotificationsEnabled()).resolves.toBe(false);

  await setNotificationsEnabled(false);
  expect(setPreference).toHaveBeenCalledWith('notifications.enabled', '0');
});

test('unread indicators default on and preserve an explicit disable', async () => {
  getPreference.mockResolvedValueOnce(null);
  await expect(getUnreadIndicatorsEnabled()).resolves.toBe(true);

  getPreference.mockResolvedValueOnce('0');
  await expect(getUnreadIndicatorsEnabled()).resolves.toBe(false);

  await setUnreadIndicatorsEnabled(false);
  expect(setPreference).toHaveBeenCalledWith('notifications.unreadIndicators', '0');
});

test('notification content defaults to fully hidden and persists independent choices', async () => {
  getPreference.mockResolvedValueOnce(null);
  await expect(getNotificationContentPreferences()).resolves.toEqual(
    DEFAULT_NOTIFICATION_CONTENT_PREFERENCES,
  );

  getPreference.mockResolvedValueOnce(
    JSON.stringify({
      showAvatar: true,
      showDisplayName: false,
      showMessageContent: true,
    }),
  );
  await expect(getNotificationContentPreferences()).resolves.toEqual({
    showSender: false,
    showMessageContent: true,
  });

  await setNotificationContentPreferences({
    showSender: true,
    showMessageContent: false,
  });
  expect(setPreference).toHaveBeenCalledWith(
    'notifications.contentPreferences',
    JSON.stringify({
      showSender: true,
      showMessageContent: false,
    }),
  );
});

test('notification content migrates a fully enabled legacy sender preview', async () => {
  getPreference.mockResolvedValueOnce(
    JSON.stringify({
      showAvatar: true,
      showDisplayName: true,
      showMessageContent: false,
    }),
  );

  await expect(getNotificationContentPreferences()).resolves.toEqual({
    showSender: true,
    showMessageContent: false,
  });
});

test('battery-optimization guidance defaults to not prompted and persists once shown', async () => {
  getPreference.mockResolvedValueOnce(null);
  await expect(getBatteryOptimizationPrompted()).resolves.toBe(false);

  getPreference.mockResolvedValueOnce('1');
  await expect(getBatteryOptimizationPrompted()).resolves.toBe(true);

  await setBatteryOptimizationPrompted();
  expect(setPreference).toHaveBeenCalledWith(
    'notifications.batteryOptimizationPrompted',
    '1',
  );
});
