import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
/** The current bounded message window, never a full history scan. */
export function unreadPrivateMessages(messages: BitchatMessage[], blocked: Set<string>, threadFor: (message: BitchatMessage) => string = message => message.peer): Map<string, { name: string; count: number }> {
  const unread = new Map<string, { name: string; count: number }>();
  for (const message of messages) if (!message.outgoing && message.recipient && message.delivery === 'delivered' && !blocked.has(message.peer)) {
    const peer = threadFor(message);
    if (blocked.has(peer)) continue;
    unread.set(peer, { name: message.name, count: (unread.get(peer)?.count ?? 0) + 1 });
  }
  return unread;
}

/** Proven rotation aliases count as one private conversation, never as separate senders. */
export function unreadLocationMessages(messages: BitchatMessage[], threads: { peer: string; head: string; keys: string[]; blocked: boolean }[]) {
  const aliases = new Map<string, string>(), blocked = new Set<string>();
  for (const thread of threads) {
    for (const key of [thread.peer, thread.head, ...thread.keys]) { aliases.set(key, thread.peer); if (thread.blocked) blocked.add(key); }
  }
  return unreadPrivateMessages(messages, blocked, message => message.channelThread ?? aliases.get(message.peer) ?? message.peer);
}
