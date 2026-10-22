/** @jest-environment node */
import { privateMessageAlerts, PRIVATE_MESSAGE_PREFERENCE } from '../private-messages';
import { platform } from '@/platform';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
jest.mock('@/platform', () => ({ platform: { preferences: { getItem: jest.fn(), setItem: jest.fn() }, mentionNotifications: { requestPermission: jest.fn(async () => true), show: jest.fn(async () => {}), clear: jest.fn(async () => {}) } } }));
const message = (id = 'one'): BitchatMessage => ({ id, peer: 'alice', recipient: 'me', name: 'Alice', content: 'secret', timestamp: Date.now() - 3600000, outgoing: false, delivery: 'delivered' });
beforeEach(async () => { await privateMessageAlerts.clear(); jest.clearAllMocks(); jest.mocked(platform.preferences.getItem).mockResolvedValue('true'); });
it('alerts on fresh receipt even for delayed private delivery with no mention and hides private metadata', async () => {
  privateMessageAlerts.received(message()); await privateMessageAlerts.idle();
  const alert = jest.mocked(platform.mentionNotifications.show).mock.calls[0][0];
  expect(alert.kind).toBe('private'); expect(alert.body).toBe('You received a private message in Nearby.');
  expect(JSON.stringify(alert)).not.toMatch(/Alice|secret|alice/);
});
it('ignores public, outgoing, read and duplicate messages and rate limits bursts', async () => {
  privateMessageAlerts.received({ ...message(), recipient: undefined }); privateMessageAlerts.received({ ...message(), outgoing: true });
  privateMessageAlerts.received({ ...message(), delivery: 'read' }); await privateMessageAlerts.idle();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
  privateMessageAlerts.received(message()); privateMessageAlerts.received(message()); privateMessageAlerts.received(message('two'));
  await privateMessageAlerts.idle(); expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(1);
});
it('defaults off and leaves the preference unchanged on permission denial', async () => {
  jest.mocked(platform.preferences.getItem).mockResolvedValue(null);
  expect(await privateMessageAlerts.enabled()).toBe(false);
  privateMessageAlerts.received(message()); await privateMessageAlerts.idle(); expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
  jest.mocked(platform.mentionNotifications.requestPermission).mockResolvedValueOnce(false);
  expect(await privateMessageAlerts.configure(true)).toBe(false); expect(platform.preferences.setItem).not.toHaveBeenCalled();
});
it('cancels an alert whose preference load races identity erasure', async () => {
  let release!: (value: string) => void;
  jest.mocked(platform.preferences.getItem).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  privateMessageAlerts.received(message()); await Promise.resolve(); await Promise.resolve();
  invalidateSessionIntent(); release('true'); await privateMessageAlerts.clear();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled(); expect(platform.mentionNotifications.clear).toHaveBeenLastCalledWith('private');
});
it('persists explicit enable and disable independently of mentions', async () => {
  expect(await privateMessageAlerts.configure(true)).toBe(true);
  expect(platform.preferences.setItem).toHaveBeenCalledWith(PRIVATE_MESSAGE_PREFERENCE, 'true');
  await privateMessageAlerts.configure(false); expect(platform.preferences.setItem).toHaveBeenLastCalledWith(PRIVATE_MESSAGE_PREFERENCE, 'false');
});
it('alerts for location arrivals without exposing the sender, area or message text', async () => {
  privateMessageAlerts.received(message(), 'geo', 'u4pruy'); await privateMessageAlerts.idle();
  const alert = jest.mocked(platform.mentionNotifications.show).mock.calls[0][0];
  expect(alert.body).toBe('You received a private message in Location channels.');
  expect(JSON.stringify(alert)).not.toMatch(/Alice|secret|alice|u4pruy/);
});
it('scopes duplicate IDs by transport and location channel', async () => {
  let now = Date.now(); const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    privateMessageAlerts.received(message()); await privateMessageAlerts.idle(); now += 10001;
    privateMessageAlerts.received(message(), 'geo', 'u4pruy'); await privateMessageAlerts.idle(); now += 10001;
    privateMessageAlerts.received(message(), 'geo', 'u4pruy'); await privateMessageAlerts.idle();
    privateMessageAlerts.received(message(), 'geo', 'u4pru'); await privateMessageAlerts.idle();
    expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(3);
    const ids = jest.mocked(platform.mentionNotifications.show).mock.calls.map(([alert]) => alert.id);
    expect(new Set(ids).size).toBe(3);
  } finally { clock.mockRestore(); }
});
