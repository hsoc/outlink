import { createStore } from 'zustand/vanilla';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { decode } from 'nostr-tools/nip19';
import { peerId } from '../bitchat-wire';
import { putRecord, readRecords, removeRecord } from './storage';
import { verifyLink } from './verification';
export type Contact = { id: string; noiseKey: string; signingKey: string; fingerprint: string; name: string;
  saved?: boolean; expiresAt?: number; favorite: boolean; verified: boolean; blocked: boolean; mutual: boolean; theirFavorite?: boolean; pendingFavorite?: boolean; npub?: string; updatedAt: number };
export const contactsStore = createStore<{ contacts: Contact[]; ready: boolean }>(() => ({ contacts: [], ready: false }));
export const DISCOVERY_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const isSavedContact = (contact: Contact) => contact.saved === true || contact.favorite || contact.verified || contact.blocked;
export const contactAvailable = (contact: Contact, now = Date.now()) => isSavedContact(contact) || (contact.expiresAt ?? 0) > now;
function validate(contact: Contact): Contact {
  if (!/^[0-9a-f]{64}$/.test(contact.noiseKey) || !/^[0-9a-f]{64}$/.test(contact.signingKey) ||
      contact.id !== peerId(hexToBytes(contact.noiseKey)) || contact.fingerprint !== bytesToHex(sha256(hexToBytes(contact.noiseKey)))) throw new Error('Invalid contact identity');
  if (contact.expiresAt !== undefined && (!Number.isFinite(contact.expiresAt) || contact.expiresAt < 0)) throw new Error('Invalid contact expiry');
  return contact;
}
let pending = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> { const operation = pending.then(task); pending = operation.then(() => {}, () => {}); return operation; }
async function persist(contact: Contact) {
  contact = { ...contact, expiresAt: isSavedContact(contact) ? undefined : contact.expiresAt ?? Date.now() + DISCOVERY_LIFETIME_MS };
  validate(contact);
  const state = contactsStore.getState(), existing = state.contacts.find(c => c.id === contact.id);
  if (existing && (existing.noiseKey !== contact.noiseKey || existing.verified && existing.signingKey !== contact.signingKey)) throw new Error('Contact identity changed');
  if (!existing && state.contacts.length >= 1000) throw new Error('Contact limit reached');
  await putRecord('contacts', contact.id, contact);
  contactsStore.setState(current => ({ contacts: [...current.contacts.filter(c => c.id !== contact.id), contact] }));
}
export const contactsService = {
  idle() { return pending; },
  restore() { return serial(async () => {
    if (contactsStore.getState().ready) return;
    const restored = (await readRecords<Contact>('contacts', 1000)).map(validate), contacts: Contact[] = [];
    const now = Date.now();
    for (const value of restored) {
      // Legacy ordinary discoveries get one bounded upgrade window. Explicit trust survives.
      const contact = !isSavedContact(value) && value.expiresAt === undefined ? { ...value, expiresAt: now + DISCOVERY_LIFETIME_MS } : value;
      if (!contactAvailable(contact, now) && !(await readRecords(`outbox:${contact.id}`, 100)).length) { await removeRecord('contacts', contact.id); continue; }
      if (contact !== value) await putRecord('contacts', contact.id, contact);
      contacts.push(contact);
    }
    contactsStore.setState({ contacts, ready: true });
  }); },
  get(id: string) { return contactsStore.getState().contacts.find(contact => contact.id === id && contactAvailable(contact)); },
  save(contact: Contact) { return serial(() => persist({ ...contact, saved: true })); },
  upsert(id: string, update: (previous?: Contact) => Contact) { return serial(() => persist(update(contactsStore.getState().contacts.find(contact => contact.id === id)))); },
  prune() { return serial(async () => {
    const candidates = contactsStore.getState().contacts.filter(contact => !contactAvailable(contact)), expired: Contact[] = [];
    // Keep queue key metadata until the outbox settles, even though it is no longer a directory contact.
    for (const contact of candidates) if (!(await readRecords(`outbox:${contact.id}`, 100)).length) expired.push(contact);
    for (const contact of expired) await removeRecord('contacts', contact.id);
    if (expired.length) {
      const ids = new Set(expired.map(contact => contact.id));
      contactsStore.setState(state => ({ contacts: state.contacts.filter(contact => !ids.has(contact.id)) }));
    }
  }); },
  keepForDelivery(id: string) { return serial(async () => {
    const contact = contactsStore.getState().contacts.find(current => current.id === id && contactAvailable(current));
    if (!contact) throw new Error('Unknown contact');
    if (!isSavedContact(contact)) await persist({ ...contact, expiresAt: Math.max(contact.expiresAt ?? 0, Date.now() + DISCOVERY_LIFETIME_MS + 60000) });
  }); },
  async importVerification(link: string) {
    const qr = verifyLink(link);
    if (qr.npub && decode(qr.npub).type !== 'npub') throw new Error('Invalid Nostr identity');
    await this.upsert(qr.id, previous => ({ ...previous, id: qr.id, saved: true, noiseKey: qr.noiseKeyHex, signingKey: qr.signKeyHex,
      fingerprint: qr.fingerprint, name: qr.nickname, favorite: previous?.favorite ?? true, verified: previous?.verified === true && previous.signingKey === qr.signKeyHex,
      blocked: previous?.blocked ?? false, mutual: previous?.mutual ?? false, npub: qr.npub ?? previous?.npub, updatedAt: Date.now() }));
    return this.get(qr.id)!;
  },
  async remove(id: string) {
    await serial(async () => { await removeRecord('contacts', id); contactsStore.setState(state => ({ contacts: state.contacts.filter(contact => contact.id !== id) })); });
  },
};
