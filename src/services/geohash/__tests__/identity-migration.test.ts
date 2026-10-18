/** @jest-environment node */
import { getPublicKey } from 'nostr-tools/pure';
import { migrationProof, validMigration } from '../identity-migration';
import { embeddedPrivate, decodeEmbedded } from '@/services/bitchat/compatibility/private-mailbox';
it('binds new-key possession, old sender, area, expiry and exact proof bytes', () => {
  const old = getPublicKey(new Uint8Array(32).fill(1)), next = new Uint8Array(32).fill(2), now = Date.now();
  const proof = migrationProof('u4pruy', old, next, now, now + 86400000);
  expect(validMigration(proof, 'u4pruy', old, now)?.pubkey).toBe(getPublicKey(next));
  expect(validMigration(proof, 'ezs42', old, now)).toBeNull();
  expect(validMigration(proof, 'u4pruy', getPublicKey(next), now)).toBeNull();
  expect(validMigration({ ...proof, pubkey: old }, 'u4pruy', old, now)).toBeNull();
  expect(validMigration({ ...proof, content: proof.content + 'x' }, 'u4pruy', old, now)).toBeNull();
  expect(validMigration(proof, 'u4pruy', old, now + 86400000)).toBeNull();
  expect(validMigration(proof, 'u4pruy', old, now - 60001)).toBeNull();
});
it('uses a bounded private control type, random embedded hints and no recipient peer ID', async () => {
  const proof = migrationProof('u4pruy', getPublicKey(new Uint8Array(32).fill(1)), new Uint8Array(32).fill(2), Date.now(), Date.now() + 86400000);
  const payload = { kind: 'rotation' as const, id: proof.id, proof, senderId: '', timestamp: Date.now() };
  const first = await decodeEmbedded(embeddedPrivate(payload)), second = await decodeEmbedded(embeddedPrivate(payload));
  expect(first).toMatchObject({ kind: 'rotation', id: proof.id, proof: JSON.parse(JSON.stringify(proof)) });
  expect(first?.recipientId).toBeUndefined(); expect(first?.senderId).not.toBe(second?.senderId);
});
