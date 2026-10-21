import { createStore } from 'zustand/vanilla';
import { nicknameBase } from '@/lib/nicknames';
import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
import { sessionIntent } from '@/services/history/lifecycle';
export const NICKNAME_KEY = 'mobile.nickname';
const CUSTOM_LEGACY_NAME = 'mobile.nickname.custom-digits';
/** UI subscribers observe only names whose persistence has completed. */
export const nicknameStore = createStore<{ name: string }>(() => ({ name: '' }));
export const resetNickname = () => nicknameStore.setState({ name: '' });
function publish(name: string): string { nicknameStore.setState({ name }); return name; }
export function validateNickname(input: string): string {
  const name = nicknameBase(input);
  if (!name || new TextEncoder().encode(name).length > 64) throw new Error('Name must fit 64 UTF-8 bytes');
  return name;
}
/** The discriminator is derived from each chat identity at display time. */
export const defaultNickname = () => 'Outlink';
function unchanged(epoch: number) { if (epoch !== sessionIntent()) throw new Error('Name update canceled by identity wipe'); }
/** Serialize initial generation, edits and full-data erasure; never publish an unsaved default. */
export function ensureNickname(): Promise<string> {
  const epoch = sessionIntent();
  return historyOperation(async () => {
    unchanged(epoch);
    const saved = await platform.preferences.getItem(NICKNAME_KEY);
    unchanged(epoch);
    if (saved?.trim()) {
      const legacy = /^Outlink\d{4}$/.test(saved.trim()) && await platform.preferences.getItem(CUSTOM_LEGACY_NAME) !== 'true';
      unchanged(epoch);
      const name = legacy ? defaultNickname() : validateNickname(saved);
      if (name !== saved) await platform.preferences.setItem(NICKNAME_KEY, name);
      unchanged(epoch); return publish(name);
    }
    const name = defaultNickname();
    await platform.preferences.setItem(NICKNAME_KEY, name);
    unchanged(epoch); return publish(name);
  });
}
export function saveNickname(input: string): Promise<string> {
  const name = validateNickname(input), epoch = sessionIntent();
  return historyOperation(async () => {
    unchanged(epoch);
    if (/^Outlink\d{4}$/.test(name)) await platform.preferences.setItem(CUSTOM_LEGACY_NAME, 'true');
    unchanged(epoch);
    await platform.preferences.setItem(NICKNAME_KEY, name);
    unchanged(epoch); return publish(name);
  });
}
