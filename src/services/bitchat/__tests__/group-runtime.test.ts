/** @jest-environment node */
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { GroupRuntime, type GroupInfo } from '../compatibility/group-runtime';
import { decodeGroupState, encodeGroupState, sealGroupMessage } from '../compatibility/group-protocol';
import { memoryStorage } from '../test-support/protocol-storage';
import type { BitchatIdentity, BitchatPeer } from '../bitchat-session';
function identity(n: number): BitchatIdentity { const noiseSeed = new Uint8Array(32).fill(n); return { noiseSeed, noisePublicKey: x25519.getPublicKey(noiseSeed), signingSeed: new Uint8Array(32).fill(n + 10) }; }
function peer(id: BitchatIdentity): BitchatPeer {
  const fingerprint = bytesToHex(sha256(id.noisePublicKey));
  return { id: fingerprint.slice(0, 16), fingerprint, name: 'Peer', secure: true, lastSeen: Date.now(), capabilities: 8, authenticatedCapabilities: true, signingPublicKey: bytesToHex(ed25519.getPublicKey(id.signingSeed)) };
}
function node(n: number) {
  const id = identity(n), store = memoryStorage(), io = { state: jest.fn(async (_peer: string, _data: Uint8Array, _invite: boolean) => {}), broadcast: jest.fn(async (_data: Uint8Array) => {}), changed: jest.fn((_groups: GroupInfo[]) => {}), message: jest.fn(async () => {}) };
  const runtime = new GroupRuntime(id, store, io);
  return { id, store, io, runtime, peer: peer(id) };
}
it('persists invitations, requires acceptance, binds creator identity and rejects forged takeovers', async () => {
  const a = node(1), b = node(2), fake = node(3);
  const id = await a.runtime.create('Crew', 'Alice'); await a.runtime.invite(id, b.peer); await a.runtime.sync(b.peer);
  const data = a.io.state.mock.calls.at(-1)![1];
  await expect(b.runtime.receiveState(fake.peer, data, true)).rejects.toThrow('creator');
  await b.runtime.receiveState(a.peer, data, true);
  expect(b.io.changed.mock.calls.at(-1)![0][0]).toMatchObject({ id, status: 'invited' });
  expect(JSON.stringify(b.io.changed.mock.calls)).not.toContain(decodeGroupState(data).key);
  await expect(b.runtime.send(id, 'Bob', 'no')).rejects.toThrow('Not a group');
  await b.runtime.accept(id);
  const restored = new GroupRuntime(b.id, b.store, b.io); await restored.restore(); await restored.send(id, 'Bob', 'hello');
  expect(b.io.broadcast).toHaveBeenCalledTimes(1);
  const state = decodeGroupState(data), takeover = { ...state, creator: fake.peer.fingerprint, members: [...state.members, { fingerprint: fake.peer.fingerprint, signingKey: fake.peer.signingPublicKey!, nickname: 'Fake' }] };
  await expect(b.runtime.receiveState(fake.peer, encodeGroupState(takeover, fake.id.signingSeed), true)).rejects.toThrow('creator');
});
it('rotates keys on removal, never sends the new key to the removed peer, and catches up offline members', async () => {
  const a = node(1), b = node(2), c = node(3);
  const id = await a.runtime.create('Crew', 'Alice'); await a.runtime.invite(id, b.peer); await a.runtime.invite(id, c.peer);
  await a.runtime.sync(b.peer); const original = a.io.state.mock.calls.at(-1)![1];
  await b.runtime.receiveState(a.peer, original, true); await b.runtime.accept(id);
  await a.runtime.remove(id, b.peer.fingerprint); await a.runtime.sync(b.peer);
  const removal = a.io.state.mock.calls.at(-1)![1];
  await b.runtime.receiveState(a.peer, removal, false);
  expect(b.io.changed.mock.calls.at(-1)![0]).toEqual([]);
  await a.runtime.sync(c.peer); const current = decodeGroupState(a.io.state.mock.calls.at(-1)![1]);
  expect(decodeGroupState(removal).key).not.toBe(current.key);
  expect(current.epoch).toBeGreaterThan(decodeGroupState(original).epoch);
  await expect(b.runtime.receiveState(a.peer, original, true)).rejects.toThrow('rollback');
  await expect(b.runtime.send(id, 'Bob', 'stale')).rejects.toThrow();
});
it('does not silently undo a leave, accepts a fresh rotated reinvitation, and ignores duplicate state sends', async () => {
  const a = node(1), b = node(2), c = node(3);
  const id = await a.runtime.create('Crew', 'Alice'); await a.runtime.invite(id, b.peer); await a.runtime.sync(b.peer);
  const old = a.io.state.mock.calls.at(-1)![1]; await b.runtime.receiveState(a.peer, old, true); await b.runtime.accept(id); await b.runtime.leave(id);
  await b.runtime.receiveState(a.peer, old, true); expect(b.io.changed.mock.calls.at(-1)![0]).toEqual([]);
  await a.runtime.sync(b.peer); expect(a.io.state).toHaveBeenCalledTimes(1);
  await a.runtime.invite(id, c.peer); await a.runtime.sync(b.peer);
  await b.runtime.receiveState(a.peer, a.io.state.mock.calls.at(-1)![1], true);
  expect(b.io.changed.mock.calls.at(-1)![0][0].status).toBe('invited');
});
it('rejects noncreator management, stale/outsider messages, rollback and post-stop work', async () => {
  const a = node(1), b = node(2);
  const id = await a.runtime.create('Crew', 'Alice'); await a.runtime.invite(id, b.peer); await a.runtime.sync(b.peer);
  const state = decodeGroupState(a.io.state.mock.calls.at(-1)![1]);
  await b.runtime.receiveState(a.peer, a.io.state.mock.calls.at(-1)![1], true); await b.runtime.accept(id);
  await expect(b.runtime.remove(id, a.peer.fingerprint)).rejects.toThrow('creator');
  const wire = sealGroupMessage(state, a.id.signingSeed, 'Alice', 'message', 'id', Date.now());
  await b.runtime.receiveMessage(wire); expect(b.io.message).toHaveBeenCalledTimes(1);
  const stale = sealGroupMessage(state, a.id.signingSeed, 'Alice', 'old', 'old', Date.now() - 21600001);
  await expect(b.runtime.receiveMessage(stale)).rejects.toThrow('Stale');
  const rolled = { ...state, key: '77'.repeat(32) };
  await expect(b.runtime.receiveState(a.peer, encodeGroupState(rolled, a.id.signingSeed), true)).rejects.toThrow('rollback');
  b.runtime.stop(); await expect(b.runtime.send(id, 'Bob', 'no')).rejects.toThrow('stopped');
});
it('does not publish a mutation whose encrypted record write fails', async () => {
  const a = node(1); jest.spyOn(a.store, 'put').mockRejectedValueOnce(new Error('disk'));
  await expect(a.runtime.create('Crew', 'Alice')).rejects.toThrow('disk'); expect(a.io.changed).not.toHaveBeenCalled();
});
