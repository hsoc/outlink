/** @jest-environment node */
import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils.js';
import legacy from './fixtures/LegacyPrivateEnvelope733098bb.json';
import legacyKey from './fixtures/LegacyPrivateEnvelope733098bbRecipientKey.json';
import android from './fixtures/AndroidLegacyPrivateEnvelopeB7f0b33d.json';
import androidMeta from './fixtures/AndroidLegacyPrivateEnvelopeB7f0b33dMetadata.json';
import { createPrivateEnvelope, openPrivateEnvelope, encryptPrivateContent, decryptPrivateContent } from '../compatibility/nostr-private';
it('decrypts the upstream frozen iOS private envelope without modifying its bytes', () => {
  expect(openPrivateEnvelope(legacy, hexToBytes(legacyKey.recipient_private_key))).toMatchObject({ content: 'legacy fixture from 733098bb', sender: '2e3d79df7047204f02b726c574e256f8de1dd80510f7dcb8b0d12df13acb87e6' });
});
it('decrypts the upstream Android private envelope without modifying its bytes', () => {
  expect(openPrivateEnvelope(android, hexToBytes(androidMeta.recipient_private_key))).toMatchObject({ content: 'legacy fixture from Android b7f0b33d', sender: androidMeta.sender_public_key });
});
it('round trips odd/even public-key parities and rejects wrong recipients or modified envelopes', () => {
  for (const scalar of [1, 2, 3, 6]) {
    const sender = hexToBytes(scalar.toString(16).padStart(64, '0')), recipient = hexToBytes('02'.repeat(32));
    const event = createPrivateEnvelope('hello 💬', sender, getPublicKey(recipient));
    expect(openPrivateEnvelope(event, recipient)).toMatchObject({ content: 'hello 💬', sender: getPublicKey(sender) });
    expect(() => openPrivateEnvelope({ ...event, content: event.content + 'x' }, recipient)).toThrow();
    expect(() => openPrivateEnvelope(event, sender)).toThrow();
  }
});
it('rejects forged inner identity, signed rumors, and alternate recipient tags even under valid outer signatures', () => {
  const sender = hexToBytes('01'.repeat(32)), recipient = hexToBytes('02'.repeat(32)), wrap = hexToBytes('03'.repeat(32));
  const pubkey = getPublicKey(sender), target = getPublicKey(recipient);
  for (const rumor of [
    { kind: 14, pubkey: getPublicKey(wrap), tags: [], created_at: 1, content: 'forged' },
    { kind: 14, pubkey, tags: [], created_at: 1, content: 'signed rumor', sig: '00'.repeat(64) },
    { kind: 14, pubkey, tags: [['p', pubkey]], created_at: 1, content: 'wrong recipient' },
  ]) {
    const seal = finalizeEvent({ kind: 13, tags: [], created_at: 1, content: encryptPrivateContent(JSON.stringify(rumor), sender, target) }, sender);
    const event = finalizeEvent({ kind: 1059, tags: [['p', target]], created_at: 1, content: encryptPrivateContent(JSON.stringify(seal), wrap, target) }, wrap);
    expect(() => openPrivateEnvelope(event, recipient)).toThrow();
  }
});
it('does not accept standard NIP-44 or unauthenticated malformed content as the custom envelope format', () => {
  expect(() => decryptPrivateContent('not-v2', hexToBytes('02'.repeat(32)), getPublicKey(hexToBytes('01'.repeat(32))))).toThrow();
});
