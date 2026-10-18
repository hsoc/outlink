/** @jest-environment node */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { PrekeyRuntime } from '../compatibility/prekey-runtime';
import { decodePrekeys, sealCourier } from '../compatibility/courier';
import { memoryStorage } from '../test-support/protocol-storage';
const bob = { noiseSeed: new Uint8Array(32).fill(2), noisePublicKey: x25519.getPublicKey(new Uint8Array(32).fill(2)), signingSeed: new Uint8Array(32).fill(12) };
const signing = ed25519.getPublicKey(bob.signingSeed), alice = new Uint8Array(32).fill(1);
function fixture() {
  let now = 1700000000000, secret: string | null = null;
  const storage = memoryStorage(), secrets = { get: async () => secret, set: jest.fn(async (value: string) => { secret = value; }) };
  return { storage, secrets, owner: () => new PrekeyRuntime(bob, storage, secrets, () => now), sender: () => new PrekeyRuntime(bob, storage, secrets, () => now), advance: (ms: number) => { now += ms; } };
}
it('persists a signed batch, assigns keys once across restart, and keeps only a fixed redelivery grace after consumption', async () => {
  const f = fixture(), owner = f.owner(), sender = f.sender();
  const wire = await owner.bundle(), bundle = decodePrekeys(wire, signing); expect(bundle.prekeys).toHaveLength(8);
  await sender.ingest(wire, signing);
  const assigned = await sender.assign(bob.noisePublicKey, 'one'); expect(assigned).toBeDefined();
  expect(await f.sender().assign(bob.noisePublicKey, 'one')).toEqual(assigned);
  expect((await sender.assign(bob.noisePublicKey, 'two'))?.id).not.toBe(assigned!.id);
  const ciphertext = sealCourier(Uint8Array.of(1, 2, 3), alice, assigned!.publicKey, assigned!.id);
  expect(await owner.open(ciphertext, assigned!.id)).toMatchObject({ payload: Uint8Array.of(1, 2, 3), changed: true });
  expect((await f.owner().open(ciphertext, assigned!.id)).changed).toBe(false);
  const next = decodePrekeys(await owner.bundle(), signing); expect(next.generatedAt).toBeGreaterThan(bundle.generatedAt); expect(next.prekeys.some(key => key.id === assigned!.id)).toBe(false);
  f.advance(2 * 86400000 + 1); await owner.bundle();
  await expect(owner.open(ciphertext, assigned!.id)).rejects.toThrow('unavailable');
});
it('does not consume a prekey on invalid ciphertext and propagates secure-storage failure before publication', async () => {
  const f = fixture(), owner = f.owner(), bundle = decodePrekeys(await owner.bundle(), signing), prekey = bundle.prekeys[0];
  const ciphertext = sealCourier(Uint8Array.of(1), alice, prekey.publicKey, prekey.id); ciphertext[ciphertext.length - 1] ^= 1;
  await expect(owner.open(ciphertext, prekey.id)).rejects.toThrow();
  expect(decodePrekeys(await owner.bundle(), signing).prekeys.some(key => key.id === prekey.id)).toBe(true);
  f.secrets.set.mockRejectedValueOnce(new Error('keychain unavailable')); await expect(owner.bundle()).rejects.toThrow('keychain');
});
it('serializes concurrent assignments, replenishes below low water, rejects forged/stale bundles and preserves used IDs across top-ups', async () => {
  const f = fixture(), owner = f.owner(), sender = f.sender(), wire = await owner.bundle(); await sender.ingest(wire, signing);
  const assignments = await Promise.all(Array.from({ length: 8 }, (_, i) => sender.assign(bob.noisePublicKey, String(i))));
  expect(new Set(assignments.map(key => key!.id)).size).toBe(8); expect(await sender.assign(bob.noisePublicKey, 'exhausted')).toBeUndefined();
  for (const key of assignments.slice(0, 6)) await owner.open(sealCourier(Uint8Array.of(1), alice, key!.publicKey, key!.id), key!.id);
  const fresh = await owner.bundle(); expect(decodePrekeys(fresh, signing).prekeys).toHaveLength(8); await sender.ingest(fresh, signing);
  const added = await sender.assign(bob.noisePublicKey, 'new'); expect(added!.id).toBeGreaterThan(8);
  const forged = fresh.slice(); forged[forged.length - 1] ^= 1; await expect(sender.ingest(forged, signing)).rejects.toThrow();
  f.advance(7 * 86400000 + 1000); expect(await sender.assign(bob.noisePublicKey, 'stale')).toBeUndefined();
});
