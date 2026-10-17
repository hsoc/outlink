import { createStore } from 'zustand/vanilla';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { decode } from 'nostr-tools/nip19';
import { peerId } from '../bitchat-wire';
import { putRecord, readRecords, removeRecord } from './storage';
import { verifyLink } from './verification';
export type Contact = { id: string; noiseKey: string; signingKey: string; fingerprint: string; name: string;
  favorite: boolean; verified: boolean; blocked: boolean; mutual: boolean; theirFavorite?: boolean; pendingFavorite?: boolean; npub?: string; updatedAt: number };
export const contactsStore = createStore<{ contacts: Contact[]; ready: boolean }>(() => ({ contacts: [], ready: false }));
function validate(contact: Contact): Contact {
  if (!/^[0-9a-f]{64}$/.test(contact.noiseKey) || !/^[0-9a-f]{64}$/.test(contact.signingKey) ||
      contact.id !== peerId(hexToBytes(contact.noiseKey)) || contact.fingerprint !== bytesToHex(sha256(hexToBytes(contact.noiseKey)))) throw new Error('Invalid contact identity');
  return contact;
}
export const contactsService = {
  async restore() {
    if (contactsStore.getState().ready) return;
    const contacts = (await readRecords<Contact>('contacts', 1000)).map(validate);
    contactsStore.setState({ contacts, ready: true });
  },
  get(id: string) { return contactsStore.getState().contacts.find(contact => contact.id === id); },
  async save(contact: Contact) {
    validate(contact);
    const state = contactsStore.getState(), existing = state.contacts.find(c => c.id === contact.id);
    if (existing && (existing.noiseKey !== contact.noiseKey || existing.verified && existing.signingKey !== contact.signingKey)) throw new Error('Contact identity changed');
    if (!existing && state.contacts.length >= 1000) throw new Error('Contact limit reached');
    await putRecord('contacts', contact.id, contact);
    contactsStore.setState(current => ({ contacts: [...current.contacts.filter(c => c.id !== contact.id), contact] }));
  },
  async importVerification(link: string) {
    const qr = verifyLink(link);
    if (qr.npub && decode(qr.npub).type !== 'npub') throw new Error('Invalid Nostr identity');
    const previous = this.get(qr.id);
    const contact: Contact = { ...previous, id: qr.id, noiseKey: qr.noiseKeyHex, signingKey: qr.signKeyHex,
      fingerprint: qr.fingerprint, name: qr.nickname, favorite: previous?.favorite ?? true, verified: previous?.verified === true && previous.signingKey === qr.signKeyHex,
      blocked: previous?.blocked ?? false, mutual: previous?.mutual ?? false, npub: qr.npub ?? previous?.npub, updatedAt: Date.now() };
    await this.save(contact); return contact;
  },
  async remove(id: string) {
    await removeRecord('contacts', id);
    contactsStore.setState(state => ({ contacts: state.contacts.filter(contact => contact.id !== id) }));
  },
};
