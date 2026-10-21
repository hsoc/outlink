/** @jest-environment node */
import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
import { ensureNickname, NICKNAME_KEY, nicknameStore, randomNickname, resetNickname, saveNickname } from '../nickname';
jest.mock('@/platform', () => ({ platform: { preferences: { getItem: jest.fn(), setItem: jest.fn() } } }));
const values = new Map<string, string>();
beforeEach(async () => {
  await historyOperation(async () => {}); values.clear(); resetNickname(); jest.resetAllMocks();
  (platform.preferences.getItem as jest.Mock).mockImplementation(async (key: string) => values.get(key) ?? null);
  (platform.preferences.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => { values.set(key, value); });
});
it('preserves leading zeros and rejects biased random samples', () => {
  const entropy = jest.fn().mockReturnValueOnce(new Uint8Array([255,255])).mockReturnValueOnce(new Uint8Array([0,7]));
  expect(randomNickname(entropy)).toBe('Outlink0007'); expect(entropy).toHaveBeenCalledTimes(2);
});
it('persists one default across concurrent loads and later visits', async () => {
  const names = await Promise.all([ensureNickname(), ensureNickname()]);
  expect(names[0]).toMatch(/^Outlink\d{4}$/); expect(names[1]).toBe(names[0]);
  expect(await ensureNickname()).toBe(names[0]); expect(platform.preferences.setItem).toHaveBeenCalledTimes(1);
});
it('preserves existing names and validates edits in UTF-8 bytes', async () => {
  values.set(NICKNAME_KEY, 'Existing'); expect(await ensureNickname()).toBe('Existing');
  expect(platform.preferences.setItem).not.toHaveBeenCalled();
  expect(await saveNickname('  Alice  ')).toBe('Alice'); expect(values.get(NICKNAME_KEY)).toBe('Alice');
  expect(() => saveNickname(' ')).toThrow(); expect(() => saveNickname('😀'.repeat(17))).toThrow();
  expect(await saveNickname('😀'.repeat(16))).toBe('😀'.repeat(16));
});
it('does not return an unsaved name when persistence fails', async () => {
  (platform.preferences.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(ensureNickname()).rejects.toThrow('storage unavailable');
  expect(await ensureNickname()).toMatch(/^Outlink\d{4}$/);
});
it('cancels an initial load overtaken by identity erasure', async () => {
  let release!: (value: null) => void;
  (platform.preferences.getItem as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const pending = ensureNickname(); const rejected = expect(pending).rejects.toThrow('identity wipe');
  await Promise.resolve(); await Promise.resolve(); invalidateSessionIntent(); release(null); await rejected;
  expect(platform.preferences.setItem).not.toHaveBeenCalled();
});

it('publishes a saved nickname to existing subscribers without a join or reload', async () => {
  values.set(NICKNAME_KEY, 'Old name'); await ensureNickname();
  const changed = jest.fn(); const unsubscribe = nicknameStore.subscribe(changed);
  try {
    await saveNickname('New name');
    expect(nicknameStore.getState().name).toBe('New name');
    expect(changed).toHaveBeenCalledWith({ name: 'New name' }, { name: 'Old name' });
    expect(platform.preferences.getItem).toHaveBeenCalledTimes(1);
  } finally { unsubscribe(); }
});
it('does not display an unsaved edit while a write is pending or after it fails', async () => {
  values.set(NICKNAME_KEY, 'Saved'); await ensureNickname();
  let rejectWrite!: (error: Error) => void;
  jest.mocked(platform.preferences.setItem).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  const saving = saveNickname('Unsaved'); const rejected = expect(saving).rejects.toThrow('disk');
  await Promise.resolve(); await Promise.resolve();
  expect(nicknameStore.getState().name).toBe('Saved');
  rejectWrite(new Error('disk')); await rejected;
  expect(nicknameStore.getState().name).toBe('Saved');
});
it('serializes an older preference load before a newer save without rolling back the displayed name', async () => {
  let release!: (name: string) => void;
  jest.mocked(platform.preferences.getItem).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const loading = ensureNickname(), saving = saveNickname('Newest');
  await Promise.resolve(); await Promise.resolve(); release('Old snapshot');
  expect(await loading).toBe('Old snapshot'); await saving;
  expect(nicknameStore.getState().name).toBe('Newest');
});
it('does not republish a name when identity erasure overtakes its storage write', async () => {
  let release!: () => void;
  jest.mocked(platform.preferences.setItem).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const saving = saveNickname('Erased'); const rejected = expect(saving).rejects.toThrow('identity wipe');
  await Promise.resolve(); await Promise.resolve();
  invalidateSessionIntent(); resetNickname(); release(); await rejected;
  expect(nicknameStore.getState().name).toBe('');
});
