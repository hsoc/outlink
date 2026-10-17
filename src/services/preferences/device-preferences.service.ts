import { platform } from '@/platform';
export const getDevicePreference = (key: string, _legacyKey?: string) => platform.preferences.getItem(key);
export const setDevicePreference = (key: string, value: string) => platform.preferences.setItem(key, value);
export const deleteDevicePreference = (key: string) => platform.preferences.deleteItem(key);
export async function trySetDevicePreference(key: string, value: string): Promise<void> {
  try { await setDevicePreference(key, value); } catch { console.warn('[preferences] Save failed'); }
}
