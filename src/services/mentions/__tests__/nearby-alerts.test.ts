/** @jest-environment node */
import { platform } from '@/platform';
import { nearbyAlerts, NEARBY_ALERT_PREFERENCE, groupConversationScope } from '../nearby-alerts';
import { mentionService } from '../mentions';
import { privateMessageAlerts } from '../private-messages';
import { conversationActivity, conversationScope } from '../conversation-activity';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
let mockState = 'background';
const mockPreferences = new Map<string, string>();
jest.mock('@/platform', () => ({ platform: {
  appState: { currentState: () => mockState, addChangeListener: () => () => {} },
  backgroundConnectivity: { supported: () => true, running: jest.fn(async () => true) },
  preferences: { getItem: jest.fn(async (key: string) => mockPreferences.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { mockPreferences.set(key, value); }) },
  mentionNotifications: { requestPermission: jest.fn(async () => true), show: jest.fn(async () => {}), clear: jest.fn(async () => {}) },
} }));
const message = { id: 'one', peer: 'alice', name: 'Alice', content: 'hello', timestamp: Date.now(), outgoing: false, delivery: 'delivered' as const };
beforeEach(async () => {
  await Promise.all([mentionService.clear(), privateMessageAlerts.clear(), nearbyAlerts.clear()]);
  conversationActivity.reset(); jest.clearAllMocks(); mockState = 'background'; mockPreferences.clear();
  mockPreferences.set(NEARBY_ALERT_PREFERENCE, 'true');
  jest.mocked(platform.backgroundConnectivity.running).mockResolvedValue(true);
});
it('alerts for ordinary Public Mesh messages and DMs with individual alert settings off, once per message', async () => {
  mentionService.received(message, 'mesh', 'public'); mentionService.received(message, 'mesh', 'public');
  privateMessageAlerts.received({ ...message, recipient: 'me' });
  await Promise.all([mentionService.idle(), privateMessageAlerts.idle()]);
  expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(2);
  for (const [alert] of jest.mocked(platform.mentionNotifications.show).mock.calls) {
    expect(alert.kind).toBe('nearby'); expect(JSON.stringify(alert)).not.toMatch(/Alice|hello|alice/);
  }
});
it('does not enable ordinary alerts in foreground, without a running service, or for location broadcasts', async () => {
  mockState = 'active'; mentionService.received(message, 'mesh', 'public'); await mentionService.idle();
  mockState = 'background'; jest.mocked(platform.backgroundConnectivity.running).mockResolvedValue(false);
  mentionService.received({ ...message, id: 'two' }, 'mesh', 'public'); await mentionService.idle();
  jest.mocked(platform.backgroundConnectivity.running).mockResolvedValue(true);
  mentionService.received({ ...message, id: 'three' }, 'geo', 'u4pruy'); await mentionService.idle();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
});
it('suppresses foreground alerts in the viewed DM, preserving alerts for another thread', async () => {
  mockState = 'active'; mockPreferences.set('mobile.privateMessageNotifications', 'true');
  const blur = conversationActivity.focus(conversationScope('mesh', '', 'alice'));
  privateMessageAlerts.received({ ...message, recipient: 'me' }); await privateMessageAlerts.idle();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
  privateMessageAlerts.received({ ...message, peer: 'bob', recipient: 'me' }); await privateMessageAlerts.idle();
  expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(1); blur();
});
it('suppresses viewed public mentions and rechecks visibility after asynchronous preference loads', async () => {
  mockState = 'active'; mockPreferences.set('mobile.mentionNotifications', 'true'); mockPreferences.set('mobile.nickname', 'Alice');
  const blur = conversationActivity.focus(conversationScope('geo', 'u4pruy'));
  mentionService.received({ ...message, content: '@Alice hello' }, 'geo', 'u4pruy'); await mentionService.idle();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled(); blur();
  let release!: (value: string) => void;
  jest.mocked(platform.preferences.getItem).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  privateMessageAlerts.received({ ...message, recipient: 'me' });
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  const close = conversationActivity.focus(conversationScope('mesh', '', 'alice'));
  release('true'); await privateMessageAlerts.idle();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled(); close();
});
it('includes joined group messages, uses generic previews and clears the separate category', async () => {
  nearbyAlerts.group({ ...message, sender: 'abcd'.repeat(16), group: 'team' }); await nearbyAlerts.idle();
  expect(platform.mentionNotifications.show).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nearby' }), expect.any(Function));
  await nearbyAlerts.configure(false);
  expect(mockPreferences.get(NEARBY_ALERT_PREFERENCE)).toBe('false');
  expect(platform.mentionNotifications.clear).toHaveBeenLastCalledWith('nearby');
  mockState = 'active'; const blur = conversationActivity.focus(groupConversationScope('team'));
  nearbyAlerts.group({ ...message, id: 'two', sender: 'abcd'.repeat(16), group: 'team' }); await nearbyAlerts.idle();
  expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(1); blur();
});
it('permission denial and identity erasure cannot enable the setting', async () => {
  mockPreferences.clear(); jest.mocked(platform.mentionNotifications.requestPermission).mockResolvedValueOnce(false);
  expect(await nearbyAlerts.configure(true)).toBe(false);
  let release!: (value: boolean) => void;
  jest.mocked(platform.mentionNotifications.requestPermission).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const operation = nearbyAlerts.configure(true); const rejected = expect(operation).rejects.toThrow('identity wipe');
  invalidateSessionIntent(); release(true); await rejected;
  expect(mockPreferences.has(NEARBY_ALERT_PREFERENCE)).toBe(false);
});
it('does not time-throttle all-Nearby arrivals, and never alerts twice for a public mention', async () => {
  mockPreferences.set('mobile.mentionNotifications', 'true'); mockPreferences.set('mobile.nickname', 'Alice');
  mentionService.received({ ...message, content: '@Alice hello' }, 'mesh', 'public');
  mentionService.received({ ...message, id: 'two' }, 'mesh', 'public');
  await mentionService.idle();
  expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(2);
  expect(jest.mocked(platform.mentionNotifications.show).mock.calls.every(([alert]) => alert.kind === 'nearby')).toBe(true);
});
it('opt-out drains already submitted alerts before native cleanup', async () => {
  const events: string[] = []; let release!: () => void;
  jest.mocked(platform.mentionNotifications.show).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); events.push('shown'); });
  jest.mocked(platform.mentionNotifications.clear).mockImplementationOnce(async () => { events.push('cleared'); });
  mentionService.received(message, 'mesh', 'public');
  for (let i = 0; i < 100 && !release; ++i) await Promise.resolve();
  expect(release).toBeDefined();
  const disabling = nearbyAlerts.configure(false); release();
  await disabling; await mentionService.idle();
  expect(events).toEqual(['shown', 'cleared']);
});
it('Location private visibility follows the proven conversation root after key rotation', async () => {
  mockState = 'active'; mockPreferences.set('mobile.privateMessageNotifications', 'true');
  const blur = conversationActivity.focus(conversationScope('geo', 'u4pruy', 'root'));
  privateMessageAlerts.received({ ...message, peer: 'rotated', channelThread: 'root', recipient: 'me' }, 'geo', 'u4pruy');
  await privateMessageAlerts.idle(); expect(platform.mentionNotifications.show).not.toHaveBeenCalled(); blur();
});
