import { socialMessage } from '@/lib/message-actions';
import { nicknameBase } from '@/lib/nicknames';
import { platform } from '@/platform';
import { sessionIntent } from '@/services/history/lifecycle';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { bitchatService, bitchatSessionStore } from './bitchat.service';
import { contactsService } from './compatibility/contacts';
import type { GroupMessage } from './compatibility/group-runtime';

type Action = 'copy' | 'message' | 'hug' | 'slap' | 'block';

/** Group authors use full fingerprints; never resolve an action by their nickname. */
export async function groupMessageAction(action: Action, message: GroupMessage, name: string, current: () => boolean): Promise<string | undefined> {
  const epoch = sessionIntent();
  const valid = () => current() && epoch === sessionIntent();
  if (!valid()) return;
  if (action === 'copy') { await platform.clipboard.writeText(message.content); return; }
  if (message.outgoing) return;
  if (!/^[0-9a-f]{64}$/.test(message.sender)) throw new Error('Invalid group author');
  const peer = message.sender.slice(0, 16);
  if (action === 'block') { await blockedUsers.set(['mesh:' + peer], nicknameBase(name), true); return; }
  if (action === 'message') {
    const discovered = bitchatSessionStore.getState().peers.find(candidate => candidate.id === peer);
    if (discovered && discovered.fingerprint !== message.sender) throw new Error('Group author identity mismatch');
    await bitchatService.preparePrivateConversation(peer);
    if (!valid()) return;
    const contact = contactsService.get(peer);
    if (contact && contact.fingerprint !== message.sender) throw new Error('Group author identity mismatch');
    return peer;
  }
  await bitchatService.sendGroup(message.group, socialMessage(action, name));
}
