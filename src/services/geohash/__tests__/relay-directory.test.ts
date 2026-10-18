/** @jest-environment node */
import { areaRelays, parseRelayDirectory, RelayDirectoryRefresh, RELAY_DIRECTORY_URL } from '../relay-directory';
import expected from '@/services/bitchat/test-support/area-relay-vectors.json';
it('matches independently computed great-circle rankings for three regions and normalizes default-port aliases', () => {
  for (const [hash, urls] of Object.entries(expected)) expect(areaRelays(hash)).toEqual([...new Set(urls.map(url => new URL(url).toString()))]);
  const copy = areaRelays('u4pruy'); copy.pop(); expect(areaRelays('u4pruy')).not.toEqual(copy);
  expect(() => areaRelays('invalid')).toThrow();
});

const csv = 'Relay URL,Latitude,Longitude\r\nnew.example.com,57.64911,10.40744\r\nother.example.com,0,0\r\n';
it('rejects malformed, conflicting, nonpublic and oversized directory data', () => {
  expect(parseRelayDirectory(csv)).toHaveLength(2);
  for (const bad of ['wrong\na,1,2', csv.replace('57.64911', 'NaN'), csv.replace('57.64911', '91'), csv.replace('new.example.com', '127.0.0.1'), csv.replace('new.example.com', 'a.local'), csv.replace('new.example.com', 'evil.com/path'), csv + 'new.example.com,1,2\n', 'x'.repeat(524289)]) expect(() => parseRelayDirectory(bad)).toThrow();
});
it('coalesces updates, caches for a day, retries failures with backoff and preserves accepted data', async () => {
  const storage = { getItem: jest.fn(async () => null as string | null), setItem: jest.fn(async () => {}) };
  let now = 100000000;
  const fetcher = jest.fn(async () => ({ ok: true, headers: { get: () => null }, text: async () => csv } as unknown as Response));
  const client = new RelayDirectoryRefresh(storage, fetcher, () => now);
  await Promise.all([client.refresh(), client.refresh()]); expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(RELAY_DIRECTORY_URL, expect.objectContaining({ redirect: 'error' }));
  expect(areaRelays('u4pruy')[0]).toBe('wss://new.example.com/');
  now += 3600001; await client.refresh(); expect(fetcher).toHaveBeenCalledTimes(1);
  now += 86400000; fetcher.mockRejectedValueOnce(new Error('offline')); await client.refresh(); await client.refresh(); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(areaRelays('u4pruy')[0]).toBe('wss://new.example.com/');
  const cached = new RelayDirectoryRefresh({ ...storage, getItem: async () => JSON.stringify({ at: now, csv }) }, fetcher, () => now);
  await cached.refresh(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('cancels late fetches without installing or persisting them', async () => {
  let resolve!: (response: Response) => void;
  const storage = { getItem: async () => null, setItem: jest.fn(async () => {}) };
  const client = new RelayDirectoryRefresh(storage, () => new Promise(yes => { resolve = yes; }));
  const work = client.refresh(); await Promise.resolve(); await Promise.resolve(); client.stop();
  resolve({ ok: true, headers: { get: () => null }, text: async () => csv } as unknown as Response); await work;
  expect(storage.setItem).not.toHaveBeenCalled();
});
