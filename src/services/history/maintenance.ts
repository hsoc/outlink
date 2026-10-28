import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { messageIsFresh } from '@/lib/message-retention';
import { bitchatSessionStore, meshGroupsStore } from '@/services/bitchat/bitchat.service';
import { geohashStore } from '@/services/geohash/geohash.service';
import { historyOperation } from './history';
import { sessionIntent } from './lifecycle';
export const historyClock = createStore(() => ({ now: Date.now() }));
/** One coalesced maintenance pass; protected records and pending sends are untouched. */
let pending: Promise<void> | undefined;
export function pruneChatHistory(): Promise<void> {
  if (pending) return pending;
  const epoch = sessionIntent();
  return pending = (async () => {
    const now = Date.now(), fresh = (message: { timestamp?: number }) => messageIsFresh(message, now);
    const trim = <T extends { timestamp?: number }>(messages: T[]): T[] => messages.every(fresh) ? messages : messages.filter(fresh);
    bitchatSessionStore.setState(state => ({ messages: trim(state.messages) }));
    geohashStore.setState(state => ({ messages: trim(state.messages), privateMessages: trim(state.privateMessages) }));
    meshGroupsStore.setState(state => ({ messages: trim(state.messages) }));
    historyClock.setState({ now });
    await historyOperation(async () => { if (epoch === sessionIntent()) await platform.history.prune(); });
  })().finally(() => { pending = undefined; });
}
