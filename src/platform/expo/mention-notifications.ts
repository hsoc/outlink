import { Platform } from 'react-native';
// Import only local APIs: the package barrel includes remote token registration effects.
import { getPermissionsAsync, requestPermissionsAsync } from 'expo-notifications/build/NotificationPermissions';
import { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';
import { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
import { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
import { getPresentedNotificationsAsync } from 'expo-notifications/build/getPresentedNotificationsAsync';
import { dismissNotificationAsync } from 'expo-notifications/build/dismissNotificationAsync';
import { getAllScheduledNotificationsAsync } from 'expo-notifications/build/getAllScheduledNotificationsAsync';
import { cancelScheduledNotificationAsync } from 'expo-notifications/build/cancelScheduledNotificationAsync';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications/build/NotificationChannelManager.types';
import type { MentionNotificationsPort } from '../ports/mention-notifications';
const channel = 'outlink-mentions';
setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) });
async function ensureChannel(name: string) {
  if (Platform.OS === 'android') await setNotificationChannelAsync(channel, {
    name, importance: AndroidImportance.HIGH,
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE, sound: 'default',
  });
}
export const mentionNotificationsAdapter: MentionNotificationsPort = {
  async requestPermission(channelName) {
    await ensureChannel(channelName);
    return (await requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })).granted;
  },
  async show({ id, title, body, channelName }) {
    if (!(await getPermissionsAsync()).granted) return;
    await ensureChannel(channelName);
    await scheduleNotificationAsync({ identifier: id, content: {
      title, body,
      sound: 'default', data: { outlinkMention: true },
    }, trigger: Platform.OS === 'android' ? { channelId: channel } : null });
  },
  async clear() {
    for (const item of await getAllScheduledNotificationsAsync()) if (item.content.data?.outlinkMention === true) await cancelScheduledNotificationAsync(item.identifier);
    for (const item of await getPresentedNotificationsAsync()) if (item.request.content.data?.outlinkMention === true) await dismissNotificationAsync(item.request.identifier);
  },
};
