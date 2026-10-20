/** @jest-environment node */
import { createTripleTap } from '@/lib/triple-tap';
import { panicWipe } from '../panic';
import { platform } from '@/platform';
import { bitchatService, bitchatSessionStore } from '../bitchat.service';
import { geohashService } from '@/services/geohash/geohash.service';
import { workspaceStore } from '@/services/history/workspace';
import { contactsStore } from '../compatibility/contacts';
import { resetMobileIdentity } from '../mobile-identity';
jest.mock('@/platform', () => ({ platform: { wipeLocalData: jest.fn(async () => {}), mentionNotifications: { clear: jest.fn(async () => {}) } } }));
jest.mock('../bitchat.service', () => {
  const { createStore } = jest.requireActual('zustand/vanilla');
  return { bitchatSessionStore: createStore(() => ({ busy: false, error: false })), bitchatService: { stop: jest.fn(async () => {}), resetLocalState: jest.fn() } };
});
jest.mock('@/services/geohash/geohash.service', () => {
  const { createStore } = jest.requireActual('zustand/vanilla');
  return { geohashStore: createStore(() => ({ hash: 'old' })), geohashService: { stop: jest.fn(), idle: jest.fn(async () => {}), clearMessages: jest.fn() } };
});
jest.mock('@/services/history/workspace', () => {
  const { createStore } = jest.requireActual('zustand/vanilla'); return { workspaceStore: createStore(() => ({ ready: true, drafts: { old: 'secret' }, internet: true })) };
});
jest.mock('../compatibility/contacts', () => {
  const { createStore } = jest.requireActual('zustand/vanilla'); return { contactsStore: createStore(() => ({ contacts: ['old'], ready: true })) };
});
jest.mock('../mobile-identity', () => ({ resetMobileIdentity: jest.fn(async () => {}) }));
it('coalesces confirmed wipe operations and stops transports before deleting keys and resetting local state', async () => {
  const first = panicWipe(), second = panicWipe(); expect(first).toBe(second); await first;
  expect(bitchatService.stop).toHaveBeenCalledTimes(1); expect(geohashService.stop).toHaveBeenCalledTimes(1);
  expect(platform.wipeLocalData).toHaveBeenCalledTimes(1); expect(resetMobileIdentity).toHaveBeenCalledTimes(1);
  expect(jest.mocked(bitchatService.stop).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(platform.wipeLocalData).mock.invocationCallOrder[0]);
  expect(jest.mocked(platform.wipeLocalData).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(bitchatService.resetLocalState).mock.invocationCallOrder[0]);
  expect(workspaceStore.getState()).toMatchObject({ ready: true, internet: false, drafts: {}, mode: 'mesh', hash: '' });
  expect(contactsStore.getState()).toMatchObject({ contacts: [], ready: false });
});
it('surfaces failed deletion, remains disconnected, and allows an explicit retry', async () => {
  jest.mocked(platform.wipeLocalData).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(panicWipe()).rejects.toThrow('storage unavailable');
  expect(bitchatSessionStore.getState()).toMatchObject({ busy: false, error: true });
  expect(workspaceStore.getState().ready).toBe(false);
  await panicWipe(); expect(workspaceStore.getState().ready).toBe(true);
});

it('invokes the same full wipe only after the third quick activation', async () => {
  let pending: Promise<void> | undefined;
  const gesture = createTripleTap(() => { pending = panicWipe(); }, () => 100);
  const before = jest.mocked(platform.wipeLocalData).mock.calls.length;
  workspaceStore.setState({ ready: true, drafts: { secret: 'draft' }, internet: true });
  gesture.tap(); gesture.tap();
  expect(platform.wipeLocalData).toHaveBeenCalledTimes(before); expect(pending).toBeUndefined();
  gesture.tap(); await pending;
  expect(platform.wipeLocalData).toHaveBeenCalledTimes(before + 1);
  expect(workspaceStore.getState()).toMatchObject({ ready: true, drafts: {}, internet: false });
  expect(contactsStore.getState()).toMatchObject({ contacts: [], ready: false });
});

it('does not let failed notification dismissal block identity and key erasure', async () => {
  const before = jest.mocked(platform.wipeLocalData).mock.calls.length;
  jest.mocked(platform.mentionNotifications.clear).mockRejectedValueOnce(new Error('OS notification service unavailable'));
  await expect(panicWipe()).resolves.toBeUndefined();
  expect(platform.wipeLocalData).toHaveBeenCalledTimes(before + 1);
  expect(workspaceStore.getState()).toMatchObject({ ready: true, drafts: {}, internet: false });
});
