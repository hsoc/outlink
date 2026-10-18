/** @jest-environment node */
import { base64 } from '@scure/base';
import { CourierRuntime } from '../compatibility/courier-runtime';
import { courierTags, decodeCourier, type CourierEnvelope } from '../compatibility/courier';
import { memoryStorage } from '../test-support/protocol-storage';
const recipient = new Uint8Array(32).fill(2), carrier = new Uint8Array(32).fill(3);
function fixture() {
  let now = 1700000000000; const storage = memoryStorage();
  const runtime = () => new CourierRuntime(storage, () => now);
  const envelope = (id: number, copies = 4): CourierEnvelope => ({ tag: courierTags(recipient, now)[1], expiry: now + 86400000, copies, ciphertext: new Uint8Array(96).fill(id) });
  return { storage, runtime, envelope, advance(ms: number) { now += ms; } };
}
it('persists opaque mail, limits copies across restart/replay, and removes only an accepted direct handover', async () => {
  const f = fixture(), envelope = f.envelope(1); await f.runtime().deposit(envelope, 'sender', 'favorite');
  const send = jest.fn(async () => {}); await f.runtime().encounter(carrier, 'verified', true, send); expect(send).toHaveBeenCalledWith(expect.objectContaining({ copies: 2 }));
  await f.runtime().deposit(envelope, 'sender', 'favorite'); // Replaying the original cannot refill spent copies.
  const saved = await f.storage.list<{ wire: string }>('courier', 40); expect(decodeCourier(base64.decode(saved[0].wire)).copies).toBe(2);
  await f.runtime().encounter(carrier, 'verified', true, send); expect(send).toHaveBeenCalledTimes(1);
  await f.runtime().encounter(recipient, undefined, true, async () => { throw new Error('disconnected'); }); expect(await f.storage.list('courier', 40)).toHaveLength(1);
  await f.runtime().encounter(recipient, undefined, true, send); expect(await f.storage.list('courier', 40)).toHaveLength(0);
});
it('retains remote handovers, enforces cooldown and expiry, and does not spray to the depositor', async () => {
  const f = fixture(); await f.runtime().deposit(f.envelope(1), Buffer.from(carrier).toString('hex'), 'favorite');
  const send = jest.fn(async () => {}); await f.runtime().encounter(carrier, 'favorite', true, send); expect(send).not.toHaveBeenCalled();
  await f.runtime().encounter(recipient, undefined, false, send); await f.runtime().encounter(recipient, undefined, false, send); expect(send).toHaveBeenCalledTimes(1);
  f.advance(600001); await f.runtime().encounter(recipient, undefined, false, send); expect(send).toHaveBeenCalledTimes(2);
  f.advance(86400000); await f.runtime().encounter(recipient, undefined, true, send); expect(send).toHaveBeenCalledTimes(2); expect(await f.storage.list('courier', 40)).toHaveLength(0);
});
it('bounds verified-tier mail without crowding out favorites, per-depositor caps, and lifetime', async () => {
  const f = fixture();
  for (let i = 1; i <= 20; ++i) await f.runtime().deposit(f.envelope(i), 'favorite-' + Math.ceil(i / 5), 'favorite');
  for (let i = 21; i <= 50; ++i) await f.runtime().deposit(f.envelope(i), 'verified-' + i, 'verified');
  const all = await f.storage.list<{ tier: string }>('courier', 40); expect(all).toHaveLength(40); expect(all.filter(entry => entry.tier === 'favorite')).toHaveLength(20);
  const shared = f.runtime();
  await Promise.all(Array.from({ length: 5 }, (_, i) => shared.deposit(f.envelope(i + 60), 'one-peer', 'verified')));
  expect((await f.storage.list<{ depositor: string }>('courier', 40)).filter(entry => entry.depositor === 'one-peer')).toHaveLength(2);
  const invalid = f.envelope(99); invalid.expiry += 120000; expect(await f.runtime().deposit(invalid, 'bad', 'verified')).toBe(false);
});
it('reserves spray budget before ambiguous writes and never republish held mail before relay acceptance/cooldown', async () => {
  const f = fixture(); await f.runtime().deposit(f.envelope(1), 'sender', 'favorite');
  await f.runtime().encounter(carrier, 'verified', true, async () => { throw new Error('ambiguous radio acceptance'); });
  const retry = jest.fn(async () => {}); await f.runtime().encounter(carrier, 'verified', true, retry); expect(retry).not.toHaveBeenCalled();
  await expect(f.runtime().publishHeld(async () => { throw new Error('relay rejected'); })).rejects.toThrow();
  await f.runtime().publishHeld(retry); await f.runtime().publishHeld(retry); expect(retry).toHaveBeenCalledTimes(1);
});
