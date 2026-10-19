/** @jest-environment node */
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { peerId } from '../bitchat-wire';
import { contactsService, contactsStore, DISCOVERY_LIFETIME_MS, isSavedContact, type Contact } from '../compatibility/contacts';
import { putRecord, readRecords, removeRecord } from '../compatibility/storage';
jest.mock('../compatibility/storage', () => ({ putRecord: jest.fn(), readRecords: jest.fn(), removeRecord: jest.fn() }));
const records = new Map<string, Contact>();
let now: number;
const fixture = (value: number, changes: Partial<Contact> = {}): Contact => {
  const noise = new Uint8Array(32).fill(value);
  return { id: peerId(noise), noiseKey: bytesToHex(noise), signingKey: bytesToHex(new Uint8Array(32).fill(value + 1)),
    fingerprint: bytesToHex(sha256(noise)), name: 'Peer ' + value, favorite: false, verified: false, blocked: false, mutual: false, updatedAt: now, ...changes };
};
beforeEach(async () => {
  await contactsService.idle(); records.clear(); contactsStore.setState({ contacts: [], ready: false }); now = 100000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.mocked(putRecord).mockImplementation(async (_scope, id, value) => { records.set(id, JSON.parse(JSON.stringify(value))); });
  jest.mocked(removeRecord).mockImplementation(async (_scope, id) => { records.delete(id); });
  jest.mocked(readRecords).mockImplementation(async scope => (scope === 'contacts' ? [...records.values()].map(contact => ({ ...contact })) : []) as never);
});
afterEach(() => jest.restoreAllMocks());
it('expires ordinary discoveries across restart without saving them permanently', async () => {
  const contact = fixture(1); await contactsService.upsert(contact.id, () => contact);
  expect(isSavedContact(contactsService.get(contact.id)!)).toBe(false);
  expect(records.get(contact.id)?.expiresAt).toBe(now + DISCOVERY_LIFETIME_MS);
  contactsStore.setState({ contacts: [], ready: false }); await contactsService.restore();
  expect(contactsService.get(contact.id)).toBeDefined();
  now += DISCOVERY_LIFETIME_MS + 1;
  expect(contactsService.get(contact.id)).toBeUndefined();
  await contactsService.prune(); expect(records.size).toBe(0); expect(contactsStore.getState().contacts).toEqual([]);
});
it('retains explicit saves, favorites, verified identities and blocks indefinitely', async () => {
  const saved = fixture(1); await contactsService.save(saved);
  for (const [index, flag] of ['favorite', 'verified', 'blocked'].entries()) {
    const contact = fixture(index + 2, { [flag]: true }); await contactsService.upsert(contact.id, () => contact);
  }
  now += 10 * DISCOVERY_LIFETIME_MS;
  contactsStore.setState({ contacts: [], ready: false }); await contactsService.restore(); await contactsService.prune();
  expect(contactsStore.getState().contacts).toHaveLength(4);
  expect(contactsStore.getState().contacts.every(isSavedContact)).toBe(true);
});
it('migrates old ordinary discoveries once, preserving explicit trust flags', async () => {
  const temporary = fixture(1), trusted = fixture(2, { verified: true });
  records.set(temporary.id, temporary); records.set(trusted.id, trusted);
  await contactsService.restore(); const expires = records.get(temporary.id)!.expiresAt;
  now += 3600000; contactsStore.setState({ contacts: [], ready: false }); await contactsService.restore();
  expect(records.get(temporary.id)?.expiresAt).toBe(expires);
  expect(records.get(trusted.id)?.expiresAt).toBeUndefined();
});
it('keeps queued-delivery identity keys for a full bounded delivery window without saving the contact', async () => {
  const contact = fixture(1); await contactsService.upsert(contact.id, () => contact);
  now += DISCOVERY_LIFETIME_MS / 2; await contactsService.keepForDelivery(contact.id);
  contactsStore.setState({ contacts: [], ready: false }); await contactsService.restore();
  expect(records.get(contact.id)?.expiresAt).toBe(now + DISCOVERY_LIFETIME_MS + 60000);
  expect(isSavedContact(contactsService.get(contact.id)!)).toBe(false);
});
it('does not claim a successful migration or save after persistence failure', async () => {
  const contact = fixture(1); records.set(contact.id, contact);
  jest.mocked(putRecord).mockRejectedValueOnce(new Error('Disk full'));
  await expect(contactsService.restore()).rejects.toThrow('Disk full');
  expect(contactsStore.getState().ready).toBe(false);
  await contactsService.restore();
  const retained = contactsService.get(contact.id)!;
  jest.mocked(putRecord).mockRejectedValueOnce(new Error('Disk full'));
  await expect(contactsService.save(retained)).rejects.toThrow('Disk full');
  expect(isSavedContact(contactsService.get(contact.id)!)).toBe(false);
});
it('keeps hidden identity metadata until queued mail is settled, then removes the expired discovery', async () => {
  const contact = fixture(1); await contactsService.upsert(contact.id, () => contact);
  now += DISCOVERY_LIFETIME_MS + 1;
  jest.mocked(readRecords).mockResolvedValueOnce([{}] as never);
  await contactsService.prune();
  expect(records.has(contact.id)).toBe(true); expect(contactsService.get(contact.id)).toBeUndefined();
  await contactsService.prune(); expect(records.has(contact.id)).toBe(false);
});
