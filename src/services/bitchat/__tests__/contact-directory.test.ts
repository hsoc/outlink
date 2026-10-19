/** @jest-environment node */
import { contactDirectory } from '../compatibility/contact-directory';
import type { Contact } from '../compatibility/contacts';
import type { BitchatMessage, BitchatPeer } from '../bitchat-session';
const contact = (id: string, flags: Partial<Contact> = {}): Contact => ({ id, name: id, noiseKey: '01'.repeat(32), signingKey: '02'.repeat(32), fingerprint: '03'.repeat(32), favorite: false, verified: false, blocked: false, mutual: false, updatedAt: Date.now(), expiresAt: Date.now() + 86400000, ...flags });
const peer = (id: string, lastSeen: number): BitchatPeer => ({ id, name: id, fingerprint: '', secure: false, lastSeen });
const message = (peer: string, recipient: string | undefined, outgoing: boolean): BitchatMessage => ({ id: peer, peer, recipient, outgoing, name: peer, content: '', timestamp: 1, delivery: 'sent' });
it('shows live mesh peers separately from saved and offline discoveries', () => {
  const contacts = [contact('live'), contact('stale'), contact('saved', { saved: true }), contact('blocked', { blocked: true })];
  const peers = [peer('live', 1), peer('stale', 0), peer('blocked', 1)];
  expect(contactDirectory(contacts, peers, [], true, 'mesh', '').map(entry => entry.id)).toEqual(['live']);
  expect(contactDirectory(contacts, peers, [], false, 'mesh', '')).toEqual([]);
  expect(contactDirectory(contacts, peers, [], true, 'saved', '').map(entry => entry.id)).toEqual(['saved', 'blocked']);
});
it('keeps distinct same-name identities searchable without including all discoveries', () => {
  const contacts = [contact('abc', { saved: true, name: 'Alice' }), contact('def', { verified: true, name: 'Alice' }), contact('other')];
  expect(contactDirectory(contacts, [], [], false, 'saved', 'ALICE').map(entry => entry.id)).toEqual(['abc', 'def']);
  expect(contactDirectory(contacts, [], [], false, 'saved', 'def').map(entry => entry.id)).toEqual(['def']);
});
it('lists deduplicated private conversations from loaded history even after contact expiry', () => {
  const contacts = [contact('bob', { expiresAt: 1 }), contact('blocked', { blocked: true })];
  const messages = [message('self', undefined, true), message('self', 'bob', true), { ...message('bob', 'self', false), name: 'Bob from history' }, message('self', 'bob', true), message('blocked', 'self', false)];
  const entries = contactDirectory(contacts, [], messages, false, 'recent', '');
  expect(entries.map(entry => entry.id)).toEqual(['bob']); expect(entries[0].contact).toBeUndefined(); expect(entries[0].name).toBe('Bob from history');
});
