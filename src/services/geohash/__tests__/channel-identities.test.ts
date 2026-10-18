/** @jest-environment node */
import { getPublicKey } from 'nostr-tools/pure';
import { ChannelIdentities, CHANNEL_ROTATION_MS as DAY, CHANNEL_GRACE_MS, clearIdentitySet, eraseChannelIdentities } from '../channel-identities';
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }), deleteItem: jest.fn(async (key: string) => { values.delete(key); }) };
}
const root = 'aa'.repeat(32);
it('persists random per-channel keys before use, rotates daily, retains bounded grace keys, and never rolls back', async () => {
  const store = storage(); let now = 1000000000;
  const manager = new ChannelIdentities(store, root, () => now), legacy = new Uint8Array(32).fill(7), legacyPub = getPublicKey(legacy);
  const first = await manager.load('u4pruy', legacy); expect(legacy.every(v => v === 0)).toBe(true);
  expect(first.current.pubkey).not.toBe(legacyPub); expect(first.retired[0].pubkey).toBe(legacyPub);
  const writes = store.setItem.mock.calls.length, same = await manager.load('u4pruy');
  expect(same.current.pubkey).toBe(first.current.pubkey); expect(store.setItem).toHaveBeenCalledTimes(writes);
  const other = await manager.load('ezs42'); expect(other.current.pubkey).not.toBe(first.current.pubkey);
  now += DAY;
  const second = await manager.load('u4pruy'); expect(second.current.pubkey).not.toBe(first.current.pubkey);
  expect(second.retired.map(e => e.pubkey)).toContain(first.current.pubkey); expect(second.retired).toHaveLength(2);
  now += DAY;
  const third = await new ChannelIdentities(store, root, () => now).load('u4pruy');
  expect(third.retired.map(e => e.pubkey)).not.toContain(legacyPub); expect(third.retired).toHaveLength(2);
  now -= DAY;
  const backwards = await manager.load('u4pruy'); expect(backwards.current.pubkey).toBe(third.current.pubkey);
  now += 5 * DAY;
  const late = await manager.load('u4pruy'); expect(late.retired.map(e => e.pubkey)).toEqual([third.current.pubkey]);
  expect(CHANNEL_GRACE_MS).toBe(2 * DAY);
  for (const set of [first, same, other, second, third, backwards, late]) clearIdentitySet(set);
});
it('fails closed on corrupt or uncommitted storage, and panic deletion is retryable', async () => {
  const store = storage(), manager = new ChannelIdentities(store, root);
  store.setItem.mockRejectedValueOnce(new Error('storage failed'));
  await expect(manager.load('u4pruy')).rejects.toThrow('storage failed');
  const keys = await manager.load('u4pruy'); clearIdentitySet(keys);
  const ring = [...store.values.keys()].find(k => k.endsWith('.u4pruy'))!;
  const original = store.values.get(ring)!; store.values.set(ring, '{}');
  await expect(manager.load('u4pruy')).rejects.toThrow(); expect(store.values.get(ring)).toBe('{}'); store.values.set(ring, original);
  store.deleteItem.mockRejectedValueOnce(new Error('keychain busy'));
  await expect(eraseChannelIdentities(store, root)).rejects.toThrow('keychain busy'); expect(store.values.size).toBeGreaterThan(0);
  await eraseChannelIdentities(store, root); expect(store.values.size).toBe(0);
});
it('serializes concurrent first use and enforces the bounded secure-key index', async () => {
  const store = storage(), manager = new ChannelIdentities(store, root);
  const keys = await Promise.all([manager.load('u4pruy'), new ChannelIdentities(store, root).load('u4pruy')]);
  expect(keys[0].current.pubkey).toBe(keys[1].current.pubkey); keys.forEach(clearIdentitySet);
  for (const letter of '0123456789bcdefghjkmnpqrstuvwxyz'.slice(0, 31)) clearIdentitySet(await manager.load(`u${letter}`));
  await expect(manager.load('zzzz')).rejects.toThrow('limit'); await eraseChannelIdentities(store, root); expect(store.values.size).toBe(0);
});
