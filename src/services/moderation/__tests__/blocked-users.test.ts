/** @jest-environment node */
import { blockedUsers, blockedUsersStore } from '../blocked-users';
import { platform } from '@/platform';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
jest.mock('@/platform', () => ({ platform: { records: { get: jest.fn(), set: jest.fn() } } }));
const first = 'nostr:' + 'a'.repeat(64), next = 'nostr:' + 'b'.repeat(64);
let saved: string | null;
beforeEach(() => {
  invalidateSessionIntent(); blockedUsers.reset(); saved = null; jest.clearAllMocks();
  jest.mocked(platform.records.get).mockImplementation(async () => saved);
  jest.mocked(platform.records.set).mockImplementation(async (_scope, _id, value) => { saved = value; });
});
it('persists related identities as one block and supports unblocking after restart', async () => {
  await blockedUsers.set([first, next, first], 'Alice', true);
  expect(blockedUsers.has(first)).toBe(true); expect(blockedUsers.has(next)).toBe(true);
  expect(blockedUsersStore.getState().users).toHaveLength(2);
  blockedUsers.reset(); await blockedUsers.restore(); expect(blockedUsers.has(first)).toBe(true);
  await blockedUsers.set([first, next], 'Alice', false); expect(blockedUsersStore.getState().users).toEqual([]);
});
it('does not publish failed writes or allow malformed identity keys', async () => {
  jest.mocked(platform.records.set).mockRejectedValueOnce(new Error('disk'));
  await expect(blockedUsers.set([first], 'Alice', true)).rejects.toThrow('disk'); expect(blockedUsers.has(first)).toBe(false);
  await expect(blockedUsers.set(['nostr:Alice'], 'Alice', true)).rejects.toThrow('identity');
});
it('does not republish rules after a wipe overtakes an in-flight block write', async () => {
  let release!: () => void;
  jest.mocked(platform.records.set).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const writing = blockedUsers.set([first], 'Alice', true);
  while (!release) await Promise.resolve();
  invalidateSessionIntent(); blockedUsers.reset(); release(); await writing;
  expect(blockedUsersStore.getState().users).toEqual([]);
});
