import english from '@/i18n/en.json';
import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
import { sessionIntent } from '@/services/history/lifecycle';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
export const PRIVATE_MESSAGE_PREFERENCE = 'mobile.privateMessageNotifications';
let pending = Promise.resolve(), revision = 0, queued = 0, lastAlert = -Infinity;
const seen = new Set<string>();
let copy = { channelName: english.mobile.private_message_notifications, body: english.mobile.private_message_alert };
export const privateMessageAlerts = {
  setCopy(value: typeof copy) { copy = value; },
  async enabled() { return await platform.preferences.getItem(PRIVATE_MESSAGE_PREFERENCE) === 'true'; },
  async configure(enabled: boolean) {
    const epoch = sessionIntent();
    if (enabled && !await platform.mentionNotifications.requestPermission(copy.channelName, 'private')) return false;
    await historyOperation(async () => {
      if (epoch !== sessionIntent()) throw new Error('Notification setting canceled by identity wipe');
      await platform.preferences.setItem(PRIVATE_MESSAGE_PREFERENCE, String(enabled));
    });
    if (!enabled) await this.clear().catch(() => {});
    return true;
  },
  received(message: BitchatMessage) {
    if (message.outgoing || !message.recipient || message.delivery === 'read' || queued >= 32) return;
    const id = 'private-' + bytesToHex(sha256(new TextEncoder().encode(message.peer + ':' + message.id)));
    if (seen.has(id)) return;
    seen.add(id); if (seen.size > 512) seen.delete(seen.values().next().value!);
    const epoch = sessionIntent(), version = revision; ++queued;
    pending = pending.catch(() => {}).then(async () => {
      if (epoch !== sessionIntent() || version !== revision || Date.now() - lastAlert < 10000 || !await this.enabled()) return;
      if (epoch !== sessionIntent() || version !== revision) return;
      await platform.mentionNotifications.show({ id, title: 'Outlink', body: copy.body, channelName: copy.channelName, kind: 'private' });
      lastAlert = Date.now();
    }).catch(() => { /* Native alert failures must not interrupt private delivery. */ }).finally(() => { --queued; });
  },
  async clear() { ++revision; await pending; seen.clear(); lastAlert = -Infinity; await platform.mentionNotifications?.clear('private'); },
  async idle() { await pending; },
};
