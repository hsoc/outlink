import { createStore } from 'zustand/vanilla';
import { randomBytes } from '@noble/hashes/utils.js';
import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
import { sessionIntent } from '@/services/history/lifecycle';
export const NICKNAME_KEY = 'mobile.nickname';
/** UI subscribers observe only names whose persistence has completed. */
export const nicknameStore = createStore<{ name: string }>(() => ({ name: '' }));
export const resetNickname = () => nicknameStore.setState({ name: '' });
function publish(name: string): string { nicknameStore.setState({ name }); return name; }
export function validateNickname(input: string): string {
  const name = input.trim();
  if (!name || new TextEncoder().encode(name).length > 64) throw new Error('Name must fit 64 UTF-8 bytes');
  return name;
}
/** Uniform four-digit suffix; keep leading zeros and reject biased samples. */
export function randomNickname(entropy: (length: number) => Uint8Array = randomBytes): string {
  while (true) {
    const bytes = entropy(2), value = bytes[0] * 256 + bytes[1];
    if (value < 60000) return `Outlink${String(value % 10000).padStart(4, '0')}`;
  }
}
function unchanged(epoch: number) { if (epoch !== sessionIntent()) throw new Error('Name update canceled by identity wipe'); }
/** Serialize initial generation, edits and full-data erasure; never publish an unsaved default. */
export function ensureNickname(): Promise<string> {
  const epoch = sessionIntent();
  return historyOperation(async () => {
    unchanged(epoch);
    const saved = await platform.preferences.getItem(NICKNAME_KEY);
    unchanged(epoch);
    if (saved?.trim()) return publish(validateNickname(saved));
    const name = randomNickname();
    await platform.preferences.setItem(NICKNAME_KEY, name);
    unchanged(epoch); return publish(name);
  });
}
export function saveNickname(input: string): Promise<string> {
  const name = validateNickname(input), epoch = sessionIntent();
  return historyOperation(async () => {
    unchanged(epoch);
    await platform.preferences.setItem(NICKNAME_KEY, name);
    unchanged(epoch); return publish(name);
  });
}
