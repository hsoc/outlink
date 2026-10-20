/** @jest-environment node */
import { mentionService, MENTION_PREFERENCE } from '../mentions';
import { platform } from '@/platform';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
jest.mock('@/platform', () => ({ platform: { preferences: { getItem: jest.fn(), setItem: jest.fn() }, mentionNotifications: { requestPermission: jest.fn(async () => true), show: jest.fn(async () => {}), clear: jest.fn(async () => {}) } } }));
const prefs = new Map<string, string>();
const message = (id = 'one') => ({ id, content: 'hi @Outlink1234', timestamp: Date.now(), outgoing: false });
beforeEach(async () => {
  await mentionService.clear(); jest.clearAllMocks(); prefs.clear();
  prefs.set('mobile.nickname', 'Outlink1234'); prefs.set(MENTION_PREFERENCE, 'true');
  jest.mocked(platform.preferences.getItem).mockImplementation(async key => prefs.get(key) ?? null);
  jest.mocked(platform.preferences.setItem).mockImplementation(async (key, value) => { prefs.set(key, value); });
  jest.mocked(platform.mentionNotifications.requestPermission).mockResolvedValue(true);
});
it('alerts once for a mesh mention and for a subsequent location mention', async () => {
  let now = Date.now(); const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    mentionService.received(message(), 'mesh', 'public'); await mentionService.idle();
    expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(1);
    const preview = jest.mocked(platform.mentionNotifications.show).mock.calls[0][0];
    expect(preview.body).toBe('Someone mentioned you in Public Mesh.');
    expect(JSON.stringify(preview)).not.toContain('Outlink1234');
    now += 10001; mentionService.received(message('two'), 'geo', 'u4pruy'); await mentionService.idle();
    expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(2);
    expect(jest.mocked(platform.mentionNotifications.show).mock.calls[0][0].id).not.toBe(jest.mocked(platform.mentionNotifications.show).mock.calls[1][0].id);
  } finally { clock.mockRestore(); }
});
it('deduplicates alerts and rate limits new message IDs', async () => {
  mentionService.received(message(), 'mesh', 'public'); await mentionService.idle();
  mentionService.received(message(), 'mesh', 'public'); mentionService.received(message('two'), 'mesh', 'public'); await mentionService.idle();
  expect(platform.mentionNotifications.show).toHaveBeenCalledTimes(1);
});
it('ignores self messages, private messages, old history and nickname substrings', async () => {
  mentionService.received({ ...message(), outgoing: true }, 'mesh', 'public');
  mentionService.received({ ...message('private'), recipient: 'bob' }, 'mesh', 'public');
  mentionService.received({ ...message('old'), timestamp: Date.now() - 120000 }, 'geo', 'u4pruy');
  mentionService.received({ ...message('substring'), content: '@Outlink12345' }, 'geo', 'u4pruy');
  await mentionService.idle(); expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
});
it('requires explicit permission and keeps the option off on denial', async () => {
  prefs.delete(MENTION_PREFERENCE); jest.mocked(platform.mentionNotifications.requestPermission).mockResolvedValueOnce(false);
  expect(await mentionService.configure(true)).toBe(false); expect(await mentionService.enabled()).toBe(false);
  mentionService.received(message(), 'mesh', 'public'); await mentionService.idle(); expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
});
it('persists the option and clears mention notifications when disabled', async () => {
  await mentionService.configure(true); expect(await mentionService.enabled()).toBe(true);
  await mentionService.configure(false); expect(await mentionService.enabled()).toBe(false);
  expect(platform.mentionNotifications.clear).toHaveBeenCalledTimes(1);
});
it('cancels a delayed candidate overtaken by an identity wipe', async () => {
  let release!: (value: string) => void;
  jest.mocked(platform.preferences.getItem).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  mentionService.received(message(), 'geo', 'u4pruy');
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  invalidateSessionIntent(); release('true'); await mentionService.clear();
  expect(platform.mentionNotifications.show).not.toHaveBeenCalled();
});
it('waits for an already submitted alert before removing its native notification', async () => {
  const events: string[] = []; let release!: () => void;
  jest.mocked(platform.mentionNotifications.show).mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); events.push('shown'); });
  jest.mocked(platform.mentionNotifications.clear).mockImplementationOnce(async () => { events.push('cleared'); });
  mentionService.received(message(), 'mesh', 'public');
  for (let i = 0; i < 100 && !release; i++) await Promise.resolve();
  expect(release).toBeDefined(); const clearing = mentionService.clear(); release(); await clearing;
  expect(events).toEqual(['shown', 'cleared']);
});
it('does not reject chat processing when the OS refuses an alert', async () => {
  jest.mocked(platform.mentionNotifications.show).mockRejectedValueOnce(new Error('OS denied'));
  mentionService.received(message(), 'mesh', 'public'); await expect(mentionService.idle()).resolves.toBeUndefined();
});

it('does not restore the preference after a permission prompt is overtaken by erasure', async () => {
  prefs.set(MENTION_PREFERENCE, 'false'); let release!: (value: boolean) => void;
  jest.mocked(platform.mentionNotifications.requestPermission).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const configuring = mentionService.configure(true); const rejected = expect(configuring).rejects.toThrow('identity wipe');
  invalidateSessionIntent(); release(true); await rejected;
  expect(await mentionService.enabled()).toBe(false);
});

it('keeps the option disabled even when native notification cleanup fails', async () => {
  jest.mocked(platform.mentionNotifications.clear).mockRejectedValueOnce(new Error('OS cleanup unavailable'));
  await expect(mentionService.configure(false)).resolves.toBe(true);
  expect(await mentionService.enabled()).toBe(false);
});
