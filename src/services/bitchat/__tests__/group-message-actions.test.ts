/** @jest-environment node */
import { groupMessageAction } from '../group-message-actions';
import { bitchatService, bitchatSessionStore } from '../bitchat.service';
import { contactsService } from '../compatibility/contacts';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { platform } from '@/platform';
import { sessionIntent } from '@/services/history/lifecycle';
import type { GroupMessage } from '../compatibility/group-runtime';
jest.mock('../bitchat.service', () => ({ bitchatService: { preparePrivateConversation: jest.fn(), sendGroup: jest.fn() }, bitchatSessionStore: { getState: jest.fn() } }));
jest.mock('../compatibility/contacts', () => ({ contactsService: { get: jest.fn() } }));
jest.mock('@/services/moderation/blocked-users', () => ({ blockedUsers: { set: jest.fn() } }));
jest.mock('@/platform', () => ({ platform: { clipboard: { writeText: jest.fn() } } }));
jest.mock('@/services/history/lifecycle', () => ({ sessionIntent: jest.fn(() => 0) }));
const fingerprint = 'ab'.repeat(32), peer = fingerprint.slice(0, 16);
const message: GroupMessage = { id: 'message', group: 'creator:group', sender: fingerprint, name: 'Alice', content: 'exact\ntext', timestamp: 1, outgoing: false };
beforeEach(() => {
  jest.resetAllMocks(); jest.mocked(sessionIntent).mockReturnValue(0);
  jest.mocked(bitchatSessionStore.getState).mockReturnValue({ peers: [] } as never);
  jest.mocked(bitchatService.preparePrivateConversation).mockResolvedValue(false);
});
it('copies exact content, and restricts own messages to Copy', async () => {
  await groupMessageAction('copy', { ...message, outgoing: true }, 'Alice', () => true);
  expect(platform.clipboard.writeText).toHaveBeenCalledWith('exact\ntext');
  for (const action of ['message', 'hug', 'slap', 'block'] as const) await groupMessageAction(action, { ...message, outgoing: true }, 'Alice', () => true);
  expect(bitchatService.preparePrivateConversation).not.toHaveBeenCalled();
  expect(bitchatService.sendGroup).not.toHaveBeenCalled(); expect(blockedUsers.set).not.toHaveBeenCalled();
});
it('routes hug and slap to the pressed group with a normalized nickname', async () => {
  await groupMessageAction('hug', message, 'Alice\n  Smith', () => true);
  await groupMessageAction('slap', message, 'Alice#abcd', () => true);
  expect(jest.mocked(bitchatService.sendGroup).mock.calls).toEqual([['creator:group', '/hug Alice Smith'], ['creator:group', '/slap Alice#abcd']]);
  expect(platform.clipboard.writeText).not.toHaveBeenCalled();
});
it('blocks the mesh identity across conversations instead of the display nickname', async () => {
  await groupMessageAction('block', message, 'Alice#abcd', () => true);
  expect(blockedUsers.set).toHaveBeenCalledWith(['mesh:' + peer], 'Alice', true);
  expect(bitchatService.sendGroup).not.toHaveBeenCalled();
});
it('opens the private composer for a roster author even before rediscovery', async () => {
  await expect(groupMessageAction('message', message, 'Alice', () => true)).resolves.toBe(peer);
  expect(bitchatService.preparePrivateConversation).toHaveBeenCalledWith(peer);
  expect(bitchatService.sendGroup).not.toHaveBeenCalled();
});
it('rejects discovered or saved identities that do not match the full group fingerprint', async () => {
  const mismatch = peer + 'cd'.repeat(24);
  jest.mocked(bitchatSessionStore.getState).mockReturnValue({ peers: [{ id: peer, fingerprint: mismatch }] } as never);
  await expect(groupMessageAction('message', message, 'Alice', () => true)).rejects.toThrow('identity mismatch');
  expect(bitchatService.preparePrivateConversation).not.toHaveBeenCalled();
  jest.mocked(bitchatSessionStore.getState).mockReturnValue({ peers: [] } as never);
  jest.mocked(contactsService.get).mockReturnValue({ fingerprint: mismatch } as never);
  await expect(groupMessageAction('message', message, 'Alice', () => true)).rejects.toThrow('identity mismatch');
});
it('does not act on a stale group or navigate after erasure or blur during preparation', async () => {
  await groupMessageAction('hug', message, 'Alice', () => false);
  expect(bitchatService.sendGroup).not.toHaveBeenCalled();
  let current = true;
  jest.mocked(bitchatService.preparePrivateConversation).mockImplementation(async () => { current = false; return true; });
  await expect(groupMessageAction('message', message, 'Alice', () => current)).resolves.toBeUndefined();
  jest.mocked(bitchatService.preparePrivateConversation).mockImplementation(async () => { jest.mocked(sessionIntent).mockReturnValue(1); return true; });
  await expect(groupMessageAction('message', message, 'Alice', () => true)).resolves.toBeUndefined();
});
