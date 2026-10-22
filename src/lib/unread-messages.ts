import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
/** The current bounded message window, never a full history scan. */
export function unreadPrivateMessages(messages: BitchatMessage[], blocked: Set<string>): Map<string, { name: string; count: number }> {
  const unread = new Map<string, { name: string; count: number }>();
  for (const message of messages) if (!message.outgoing && message.recipient && message.delivery === 'delivered' && !blocked.has(message.peer)) {
    unread.set(message.peer, { name: message.name, count: (unread.get(message.peer)?.count ?? 0) + 1 });
  }
  return unread;
}
