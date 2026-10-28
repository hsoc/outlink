/** @jest-environment node */
import { pruneChatHistory } from '../maintenance';
import { bitchatSessionStore, meshGroupsStore } from '@/services/bitchat/bitchat.service';
import { geohashStore } from '@/services/geohash/geohash.service';
import { MESSAGE_LIFETIME_MS } from '@/lib/message-retention';
import { platform } from '@/platform';
jest.mock('@/platform', () => ({ platform: { history: { prune: jest.fn(async () => {}) } } }));
jest.mock('@/services/bitchat/bitchat.service', () => {
  const { createStore } = jest.requireActual('zustand/vanilla');
  return { bitchatSessionStore: createStore(() => ({ messages: [] })), meshGroupsStore: createStore(() => ({ messages: [], groups: ['retained membership'] })) };
});
jest.mock('@/services/geohash/geohash.service', () => {
  const { createStore } = jest.requireActual('zustand/vanilla');
  return { geohashStore: createStore(() => ({ messages: [], privateMessages: [] })) };
});
it('expires loaded mesh/public/private/group histories without clearing membership or waiting for disk success', async () => {
  const expired = { timestamp: Date.now() - MESSAGE_LIFETIME_MS - 1 }, fresh = { timestamp: Date.now() };
  bitchatSessionStore.setState({ messages: [expired, fresh] as never[] });
  meshGroupsStore.setState({ messages: [expired, fresh] as never[] });
  geohashStore.setState({ messages: [expired, fresh] as never[], privateMessages: [expired, fresh] as never[] });
  jest.mocked(platform.history.prune).mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(pruneChatHistory()).rejects.toThrow();
  expect(bitchatSessionStore.getState().messages).toEqual([fresh]);
  expect(meshGroupsStore.getState().messages).toEqual([fresh]);
  expect(meshGroupsStore.getState().groups).toEqual(['retained membership']);
  expect(geohashStore.getState().messages).toEqual([fresh]);
  expect(geohashStore.getState().privateMessages).toEqual([fresh]);
});
