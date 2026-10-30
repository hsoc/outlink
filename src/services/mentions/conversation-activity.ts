import { MESSAGE_LIFETIME_MS } from '@/lib/message-retention';
import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { sessionIntent } from '@/services/history/lifecycle';

export const conversationScope = (mode: 'mesh' | 'geo', area = '', peer?: string) =>
  JSON.stringify([mode, mode === 'geo' ? area : '', peer ?? 'public']);
export const conversationActivityStore = createStore<{ unread: Record<string, number> }>(() => ({ unread: {} }));
let visible: { scope: string; epoch: number } | undefined;
/** Focus alone is insufficient: an open thread remains mounted in the background. */
export const conversationActivity = {
  viewing(scope: string) { return visible?.scope === scope && visible.epoch === sessionIntent() && platform.appState?.currentState() === 'active'; },
  focus(scope: string) {
    const token = { scope, epoch: sessionIntent() }; visible = token;
    const read = () => {
      if (!this.viewing(scope)) return;
      conversationActivityStore.setState(state => {
        if (!(scope in state.unread)) return state;
        const unread = { ...state.unread }; delete unread[scope]; return { unread };
      });
    };
    read(); const remove = platform.appState?.addChangeListener(read);
    return () => { remove?.(); if (visible === token) visible = undefined; };
  },
  received(scope: string, timestamp = Date.now()) {
    if (this.viewing(scope)) return;
    conversationActivityStore.setState(state => {
      const unread = { ...state.unread, [scope]: Math.min(timestamp, Date.now()) };
      // Transient indicators are bounded and never store message text or identities on disk.
      for (const key of Object.keys(unread)) if (unread[key] < Date.now() - MESSAGE_LIFETIME_MS) delete unread[key];
      const keys = Object.keys(unread); if (keys.length > 128) delete unread[keys[0]];
      return { unread };
    });
  },
  prune(now = Date.now()) {
    conversationActivityStore.setState(state => {
      const expired = Object.keys(state.unread).filter(key => state.unread[key] <= now - MESSAGE_LIFETIME_MS);
      if (!expired.length) return state;
      const unread = { ...state.unread }; for (const key of expired) delete unread[key]; return { unread };
    });
  },
  clearUnread() { conversationActivityStore.setState({ unread: {} }); },
  reset() { visible = undefined; conversationActivityStore.setState({ unread: {} }); },
};
