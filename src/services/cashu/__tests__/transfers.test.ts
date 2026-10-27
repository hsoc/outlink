/** @jest-environment node */
import { cashuTransfers, cashuStore } from '../transfers';
import { inspectToken, tokenParts } from '../token';
import { encoded, proof } from '../test-support/token';
import { platform } from '@/platform';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
jest.mock('@/platform', () => ({ platform: { records: { get: jest.fn(), set: jest.fn(), list: jest.fn() } } }));
const records = new Map<string, string>(), peer = 'ab'.repeat(8), other = 'cd'.repeat(8);
beforeEach(async () => {
  await cashuTransfers.idle(); records.clear(); cashuTransfers.reset(); jest.clearAllMocks();
  jest.mocked(platform.records.get).mockImplementation(async (scope, id) => records.get(scope + id) ?? null);
  jest.mocked(platform.records.set).mockImplementation(async (scope, id, value) => { records.set(scope + id, value); });
  jest.mocked(platform.records.list).mockImplementation(async () => [...records.values()].map((value, sequence) => ({ value, sequence: sequence + 1 })));
});
it('persists sender recovery before transmission and prevents assigning overlapping proofs twice', async () => {
  const item = await cashuTransfers.prepare(peer, encoded());
  expect(await cashuTransfers.token(item)).toBe(encoded());
  expect(await cashuTransfers.prepare(peer, encoded())).toEqual(item);
  await expect(cashuTransfers.prepare(other, encoded())).rejects.toThrow();
  await expect(cashuTransfers.prepare(other, encoded([proof, { ...proof, secret: 'b'.repeat(64) }]))).rejects.toThrow();
});
it('reassembles out-of-order parts durably and idempotently, scoped to authenticated sender', async () => {
  const frames = tokenParts(encoded());
  await cashuTransfers.receive(other, frames[0]);
  for (const frame of [...frames].reverse()) await cashuTransfers.receive(peer, frame);
  await cashuTransfers.receive(peer, frames[0]);
  expect(cashuStore.getState().transfers.find(row => row.peer === peer)).toMatchObject({ amount: '2', complete: true });
  expect(cashuStore.getState().transfers.find(row => row.peer === other)?.complete).toBe(false);
  const item = { peer, id: inspectToken(encoded()).id, outgoing: false };
  expect(await cashuTransfers.token(item)).toBe(encoded());
  expect(JSON.stringify(cashuStore.getState())).not.toContain(proof.secret);
  expect(JSON.stringify(cashuStore.getState())).not.toContain(encoded());
  cashuTransfers.reset(); await cashuTransfers.restore();
  expect(await cashuTransfers.token(item)).toBe(encoded());
});
it('rejects conflicting parts and digest substitutions', async () => {
  const frames = tokenParts(encoded()); await cashuTransfers.receive(peer, frames[0]);
  await expect(cashuTransfers.receive(peer, frames[0].slice(0, -1) + 'z')).rejects.toThrow();
  const wrong = frames.map(frame => frame.replace(inspectToken(encoded()).id, '0'.repeat(64)));
  for (const frame of wrong.slice(0, -1)) await cashuTransfers.receive(peer, frame);
  await expect(cashuTransfers.receive(peer, wrong[wrong.length - 1])).rejects.toThrow();
});
it('does not publish successful preparation when encrypted persistence fails', async () => {
  jest.mocked(platform.records.set).mockRejectedValueOnce(new Error('disk full'));
  await expect(cashuTransfers.prepare(peer, encoded())).rejects.toThrow();
  expect(cashuStore.getState().transfers).toEqual([]);
});
it('does not resurrect payment UI when erasure starts during persistence', async () => {
  jest.mocked(platform.records.set).mockImplementationOnce(async () => { invalidateSessionIntent(); cashuTransfers.reset(); });
  await expect(cashuTransfers.prepare(peer, encoded())).rejects.toThrow();
  expect(cashuStore.getState().transfers).toEqual([]);
});

it('refuses new transfers at the storage quota without evicting any existing tokens', async () => {
  jest.mocked(platform.records.list).mockResolvedValueOnce(Array.from({ length: 128 }, (_, sequence) => ({ sequence, value: JSON.stringify({ id: String(sequence), peer, outgoing: false, at: sequence, total: 1, parts: {} }) })));
  await expect(cashuTransfers.prepare(peer, encoded())).rejects.toThrow();
  expect(platform.records.set).not.toHaveBeenCalled();
});
