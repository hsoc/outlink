import type { MentionNotificationsPort } from '@/platform/ports/mention-notifications';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { conversationActivity } from './conversation-activity';
import type { GroupMessage } from '@/services/bitchat/compatibility/group-runtime';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import english from '@/i18n/en.json';
import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
import { sessionIntent } from '@/services/history/lifecycle';
export const NEARBY_ALERT_PREFERENCE = 'mobile.allNearbyNotifications';
let pending = Promise.resolve(), queued = 0, revision = 0;
const seen = new Set<string>();
const submissions = new Set<Promise<void>>();
export const groupConversationScope = (id: string) => JSON.stringify(['mesh', 'group', id]);
export const nearbyAlerts = {
  revision() { return revision; },
  async show(alert: Parameters<MentionNotificationsPort['show']>[0], shouldShow: () => boolean) {
    if (!shouldShow()) return;
    const operation = platform.mentionNotifications.show(alert, shouldShow);
    submissions.add(operation);
    try { await operation; } finally { submissions.delete(operation); }
  },
  group(message: GroupMessage) {
    if (message.outgoing || queued >= 32) return;
    const scope = groupConversationScope(message.group);
    conversationActivity.received(scope, message.timestamp);
    if (conversationActivity.viewing(scope)) return;
    const id = 'nearby-group-' + bytesToHex(sha256(new TextEncoder().encode(message.group + ':' + message.sender + ':' + message.id)));
    if (seen.has(id)) return;
    seen.add(id); if (seen.size > 512) seen.delete(seen.values().next().value!);
    const epoch = sessionIntent(), version = revision; ++queued;
    pending = pending.catch(() => {}).then(async () => {
      if (!await this.active() || epoch !== sessionIntent() || version !== revision || conversationActivity.viewing(scope) || blockedUsers.has('mesh:' + message.sender.slice(0, 16))) return;
      await this.show({ id, title: 'Outlink', body: english.mobile.nearby_message_alert, channelName: english.mobile.nearby_notifications, kind: 'nearby' }, () => epoch === sessionIntent() && version === revision && !conversationActivity.viewing(scope));
    }).catch(() => {}).finally(() => { --queued; });
  },
  async idle() { await pending; },
  async clear() { ++revision; await pending; await Promise.allSettled([...submissions]); seen.clear(); await platform.mentionNotifications.clear('nearby'); },
  async enabled() { return await platform.preferences.getItem(NEARBY_ALERT_PREFERENCE) === 'true'; },
  async active() {
    if (platform.appState?.currentState() !== 'background' || !platform.backgroundConnectivity?.supported() || !await this.enabled()) return false;
    const running = await platform.backgroundConnectivity.running();
    return running && platform.appState.currentState() === 'background';
  },
  async configure(enabled: boolean) {
    const epoch = sessionIntent();
    if (enabled && !await platform.mentionNotifications.requestPermission(english.mobile.nearby_notifications, 'nearby')) return false;
    await historyOperation(async () => {
      if (epoch !== sessionIntent()) throw new Error('Notification setting canceled by identity wipe');
      await platform.preferences.setItem(NEARBY_ALERT_PREFERENCE, String(enabled));
    });
    if (!enabled) await this.clear().catch(() => {});
    return true;
  },
};
