import { conversationActivity, conversationScope } from './conversation-activity';
import { nearbyAlerts } from './nearby-alerts';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { nicknameMentionLabels } from '@/lib/nicknames';
import english from '@/i18n/en.json';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { platform } from '@/platform';
import { mentionMatcher } from '@/lib/mentions';
import { ensureNickname } from '@/services/preferences/nickname';
import { historyOperation } from '@/services/history/history';
import { sessionIntent } from '@/services/history/lifecycle';
export const MENTION_PREFERENCE = 'mobile.mentionNotifications';
type Message = { id: string; content: string; timestamp: number; outgoing: boolean; recipient?: string; peer?: string; pubkey?: string; bridge?: { pubkey: string } };
let revision = 0, queued = 0, pending: Promise<void> = Promise.resolve(), lastAlert = -Infinity;
const seen = new Set<string>();
let copy = { channelName: english.mobile.mention_notifications, meshBody: english.mobile.mention_alert_mesh, geoBody: english.mobile.mention_alert_geo };
export const mentionService = {
  setCopy(value: typeof copy) { copy = value; },
  async enabled() { return await platform.preferences.getItem(MENTION_PREFERENCE) === 'true'; },
  async configure(enabled: boolean) {
    const epoch = sessionIntent();
    if (enabled && !await platform.mentionNotifications.requestPermission(copy.channelName)) return false;
    await historyOperation(async () => {
      if (epoch !== sessionIntent()) throw new Error('Mention setting canceled by identity wipe');
      await platform.preferences.setItem(MENTION_PREFERENCE, String(enabled));
    });
    if (!enabled) await this.clear().catch(() => {});
    return true;
  },
  received(message: Message, mode: 'mesh' | 'geo', scope: string, key = message.id, ownIdentities: string[] = []) {
    const now = Date.now();
    if (message.outgoing || message.recipient || mode === 'geo' && !message.content.includes('@') || message.timestamp < now - 90_000 || message.timestamp > now + 60_000 || queued >= 32) return;
    const conversation = conversationScope(mode, scope);
    if (conversationActivity.viewing(conversation)) return;
    const id = 'mention-' + bytesToHex(sha256(new TextEncoder().encode(`${mode}:${scope}:${key}`)));
    if (seen.has(id)) return;
    seen.add(id); if (seen.size > 512) seen.delete(seen.values().next().value!);
    const epoch = sessionIntent(), version = revision, nearbyVersion = nearbyAlerts.revision(); ++queued;
    pending = pending.catch(() => {}).then(async () => {
      if (epoch !== sessionIntent() || version !== revision) return;
      const allNearby = mode === 'mesh' && await nearbyAlerts.active();
      if (!allNearby && Date.now() - lastAlert < 10000) return;
      if (!allNearby && (!message.content.includes('@') || !await this.enabled())) return;
      const name = allNearby ? '' : await ensureNickname();
      if (epoch !== sessionIntent() || version !== revision || conversationActivity.viewing(conversation) || !allNearby && !([name, ...ownIdentities.flatMap(id => nicknameMentionLabels(name, id))].some(label => mentionMatcher(label)(message.content)))) return;
      const blockedKey = mode === 'geo' ? 'nostr:' + message.pubkey : message.bridge ? 'nostr:' + message.bridge.pubkey : 'mesh:' + message.peer;
      if (blockedUsers.has(blockedKey)) return;
      const show = allNearby ? nearbyAlerts.show.bind(nearbyAlerts) : platform.mentionNotifications.show.bind(platform.mentionNotifications);
      await show({ id, title: 'Outlink', body: allNearby ? english.mobile.nearby_message_alert : mode === 'mesh' ? copy.meshBody : copy.geoBody, channelName: allNearby ? english.mobile.nearby_notifications : copy.channelName, ...(allNearby ? { kind: 'nearby' as const } : {}) }, () => epoch === sessionIntent() && version === revision && (!allNearby || nearbyVersion === nearbyAlerts.revision()) && !conversationActivity.viewing(conversation)); lastAlert = Date.now();
    }).catch(() => { /* Notification failure must not reject or discard chat messages. */ }).finally(() => { --queued; });
  },
  async clear() {
    ++revision; await pending; seen.clear(); lastAlert = -Infinity;
    await platform.mentionNotifications?.clear();
  },
  async idle() { await pending; },
};
