type Unread = ReadonlyMap<string, { name: string; count: number }>;
export type DmShortcut = { peer: string; name: string; count: number };

/** Keep the selected thread, then unread senders, ahead of bounded recent threads. */
export function dmShortcuts(unread: Unread, selected: string | undefined, names: ReadonlyMap<string, string>, recent: readonly string[] = [], blocked: ReadonlySet<string> = new Set()): DmShortcut[] {
  const peers = new Set([...(selected ? [selected] : []), ...unread.keys(), ...recent]);
  return [...peers].filter(peer => peer === selected || !blocked.has(peer)).map(peer => ({
    peer, name: names.get(peer) ?? unread.get(peer)?.name ?? peer.slice(0, 8), count: blocked.has(peer) ? 0 : unread.get(peer)?.count ?? 0,
  }));
}

/** Display names may follow only exact keys and proven aliases inside the loaded area. */
export function locationDmNames(publicNames: readonly { identity: string; name: string }[], messages: readonly { peer: string; name: string; outgoing: boolean; channelThread?: string }[], threads: readonly { peer: string; head: string; keys: string[] }[]): Map<string, string> {
  const names = new Map<string, string>(), aliases = new Map<string, string>();
  for (const thread of threads) for (const key of [thread.peer, thread.head, ...thread.keys]) aliases.set(key, thread.peer);
  for (const message of messages) if (!message.outgoing) names.set(message.channelThread ?? aliases.get(message.peer) ?? message.peer, message.name);
  for (const entry of publicNames) names.set(aliases.get(entry.identity) ?? entry.identity, entry.name);
  return names;
}
