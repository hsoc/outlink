import { displayNickname } from '@/lib/nicknames';
import type { BitchatMessage, BitchatPeer } from '../bitchat-session';
import { contactAvailable, isSavedContact, type Contact } from './contacts';
export type ContactDirectoryEntry = { id: string; name: string; online: boolean; contact?: Contact };
export type ContactDirectoryTab = 'mesh' | 'saved' | 'recent';
/** Bounded to current contacts/peers and the loaded history window, never a full history scan. */
export function contactDirectory(contacts: Contact[], peers: BitchatPeer[], messages: BitchatMessage[], active: boolean,
  tab: ContactDirectoryTab, query: string): ContactDirectoryEntry[] {
  const available = new Map(contacts.filter(contact => contactAvailable(contact)).map(contact => [contact.id, contact]));
  const live = new Map(peers.filter(peer => active && peer.lastSeen > 0).map(peer => [peer.id, peer]));
  const found = new Map<string, ContactDirectoryEntry>();
  const add = (id: string, fallback: string) => {
    const contact = available.get(id), peer = live.get(id);
    if (contact?.blocked && tab !== 'saved') return;
    found.set(id, { id, name: peer?.name ?? contact?.name ?? (fallback === id ? found.get(id)?.name ?? fallback : fallback), online: !!peer && !contact?.blocked, contact });
  };
  if (tab === 'mesh') for (const peer of live.values()) add(peer.id, peer.name);
  if (tab === 'saved') for (const contact of available.values()) if (isSavedContact(contact)) add(contact.id, contact.name);
  if (tab === 'recent') for (const message of messages) if (message.recipient) {
    const id = message.outgoing ? message.recipient : message.peer;
    add(id, message.outgoing ? id : message.name);
  }
  const search = query.trim().toLowerCase();
  return [...found.values()].filter(entry => displayNickname(entry.name, entry.id).toLowerCase().includes(search) || entry.id.includes(search));
}
