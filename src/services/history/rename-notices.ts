import { createStore } from 'zustand/vanilla';
import { displayNickname, duplicateNicknames, nicknameKey } from '@/lib/nicknames';

type Participant = { name: string; identity: string };
type Notice = { id: number; identity: string; before: string; after: string };
export const renameNotices = createStore<{ scopes: Record<string, Notice[]> }>(() => ({ scopes: {} }));
let sequence = 0;

export function recordRename(scope: string, previous: Participant, name: string, participants: Participant[]) {
  const before = displayNickname(previous.name, previous.identity);
  const after = displayNickname(name, previous.identity);
  if (before === after) return;
  const qualified = duplicateNicknames(participants).has(nicknameKey(previous.name));
  const notice = { id: ++sequence, identity: previous.identity, before: displayNickname(previous.name, previous.identity, qualified), after };
  renameNotices.setState(({ scopes }) => {
    const next = { ...scopes };
    const recent = next[scope] ?? [];
    delete next[scope];
    next[scope] = [...recent, notice].slice(-3);
    return { scopes: Object.fromEntries(Object.entries(next).slice(-32)) };
  });
}

export function dismissRenames(scope: string) {
  renameNotices.setState(({ scopes }) => {
    if (!scopes[scope]) return { scopes };
    const next = { ...scopes };
    delete next[scope];
    return { scopes: next };
  });
}

export const clearRenameNotices = () => renameNotices.setState({ scopes: {} });
