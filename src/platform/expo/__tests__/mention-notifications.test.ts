/** @jest-environment node */
import { Platform } from 'react-native';
import { mentionNotificationsAdapter } from '../mention-notifications';
import { requestPermissionsAsync, getPermissionsAsync } from 'expo-notifications/build/NotificationPermissions';
import { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
import { getPresentedNotificationsAsync } from 'expo-notifications/build/getPresentedNotificationsAsync';
import { dismissNotificationAsync } from 'expo-notifications/build/dismissNotificationAsync';
import { getAllScheduledNotificationsAsync } from 'expo-notifications/build/getAllScheduledNotificationsAsync';
import { cancelScheduledNotificationAsync } from 'expo-notifications/build/cancelScheduledNotificationAsync';
import { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('expo-notifications/build/NotificationsHandler', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('expo-notifications/build/NotificationPermissions', () => ({ requestPermissionsAsync: jest.fn(async () => ({ granted: true })), getPermissionsAsync: jest.fn(async () => ({ granted: true })) }));
jest.mock('expo-notifications/build/setNotificationChannelAsync', () => ({ setNotificationChannelAsync: jest.fn(async () => {}) }));
jest.mock('expo-notifications/build/scheduleNotificationAsync', () => ({ scheduleNotificationAsync: jest.fn(async () => 'id') }));
jest.mock('expo-notifications/build/getPresentedNotificationsAsync', () => ({ getPresentedNotificationsAsync: jest.fn(async () => []) }));
jest.mock('expo-notifications/build/dismissNotificationAsync', () => ({ dismissNotificationAsync: jest.fn(async () => {}) }));
jest.mock('expo-notifications/build/getAllScheduledNotificationsAsync', () => ({ getAllScheduledNotificationsAsync: jest.fn(async () => []) }));
jest.mock('expo-notifications/build/cancelScheduledNotificationAsync', () => ({ cancelScheduledNotificationAsync: jest.fn(async () => {}) }));
const alert = { id: 'mention-one', title: 'Outlink', body: 'Mention received', channelName: 'Mentions' };
beforeEach(() => { jest.clearAllMocks(); Object.assign(Platform, { OS: 'android' }); });
it('requests permission after creating the Android channel and schedules only a local alert', async () => {
  expect(await mentionNotificationsAdapter.requestPermission('Mentions')).toBe(true);
  expect(jest.mocked(setNotificationChannelAsync).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(requestPermissionsAsync).mock.invocationCallOrder[0]);
  await mentionNotificationsAdapter.show(alert);
  expect(scheduleNotificationAsync).toHaveBeenCalledWith({ identifier: alert.id, content: { title: alert.title, body: alert.body, sound: 'default', data: { outlinkMention: true } }, trigger: { channelId: 'outlink-mentions' } });
});
it('does not submit alerts without permission', async () => {
  jest.mocked(getPermissionsAsync).mockResolvedValueOnce({ granted: false } as never);
  await mentionNotificationsAdapter.show(alert); expect(scheduleNotificationAsync).not.toHaveBeenCalled();
});
it('uses immediate local delivery on iOS', async () => {
  Object.assign(Platform, { OS: 'ios' }); await mentionNotificationsAdapter.show(alert);
  expect(scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ trigger: null }));
  expect(setNotificationChannelAsync).not.toHaveBeenCalled();
});
it('clears only mention notifications and preserves the connectivity notification', async () => {
  jest.mocked(getAllScheduledNotificationsAsync).mockResolvedValueOnce([{ identifier: 'pending', content: { data: { outlinkMention: true } } }, { identifier: 'other', content: { data: {} } }] as never);
  jest.mocked(getPresentedNotificationsAsync).mockResolvedValueOnce([{ request: { identifier: 'mention', content: { data: { outlinkMention: true } } } }, { request: { identifier: 'connectivity', content: { data: {} } } }] as never);
  await mentionNotificationsAdapter.clear(); expect(cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1); expect(cancelScheduledNotificationAsync).toHaveBeenCalledWith('pending');
  expect(dismissNotificationAsync).toHaveBeenCalledTimes(1); expect(dismissNotificationAsync).toHaveBeenCalledWith('mention');
});
