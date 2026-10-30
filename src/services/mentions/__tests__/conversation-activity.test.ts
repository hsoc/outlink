/** @jest-environment node */
import { conversationActivity, conversationActivityStore, conversationScope } from '../conversation-activity';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
let mockState = 'active';
const mockListeners = new Set<() => void>();
jest.mock('@/platform', () => ({ platform: { appState: { currentState: () => mockState, addChangeListener: (listener: () => void) => { mockListeners.add(listener); return () => mockListeners.delete(listener); } } } }));
beforeEach(() => { mockState = 'active'; mockListeners.clear(); conversationActivity.reset(); });
it('silences only the focused foreground conversation and clears its dot on return', () => {
  const publicRoom = conversationScope('mesh'), dm = conversationScope('mesh', '', 'alice');
  const blur = conversationActivity.focus(publicRoom);
  expect(conversationActivity.viewing(publicRoom)).toBe(true);
  expect(conversationActivity.viewing(dm)).toBe(false);
  conversationActivity.received(publicRoom);
  expect(conversationActivityStore.getState().unread).toEqual({});
  mockState = 'background'; conversationActivity.received(publicRoom);
  expect(conversationActivity.viewing(publicRoom)).toBe(false);
  expect(conversationActivityStore.getState().unread[publicRoom]).toBeDefined();
  mockState = 'active'; mockListeners.forEach(listener => listener());
  expect(conversationActivityStore.getState().unread).toEqual({});
  blur(); expect(conversationActivity.viewing(publicRoom)).toBe(false);
});
it('a stale cleanup cannot blur a newly focused thread; wipe invalidates visibility', () => {
  const first = conversationScope('geo', 'u4pruy'), second = conversationScope('geo', 'u4pruy', 'alice');
  const blur = conversationActivity.focus(first); const next = conversationActivity.focus(second); blur();
  expect(conversationActivity.viewing(second)).toBe(true);
  invalidateSessionIntent(); expect(conversationActivity.viewing(second)).toBe(false); next();
});
it('bounds transient unread scopes', () => {
  for (let i = 0; i < 200; ++i) conversationActivity.received(conversationScope('geo', String(i)));
  expect(Object.keys(conversationActivityStore.getState().unread)).toHaveLength(128);
});
it('expires public/group activity with six-hour retention', () => {
  const scope = conversationScope('mesh'), now = Date.now();
  conversationActivity.received(scope, now - 21600000 + 1);
  expect(conversationActivityStore.getState().unread[scope]).toBeDefined();
  conversationActivity.prune(now + 1);
  expect(conversationActivityStore.getState().unread).toEqual({});
});
