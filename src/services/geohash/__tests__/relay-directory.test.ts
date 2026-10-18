/** @jest-environment node */
import { areaRelays } from '../relay-directory';
import expected from '@/services/bitchat/test-support/area-relay-vectors.json';
it('matches independently computed great-circle rankings for three regions and normalizes default-port aliases', () => {
  for (const [hash, urls] of Object.entries(expected)) expect(areaRelays(hash)).toEqual([...new Set(urls.map(url => new URL(url).toString()))]);
  const copy = areaRelays('u4pruy'); copy.pop(); expect(areaRelays('u4pruy')).not.toEqual(copy);
  expect(() => areaRelays('invalid')).toThrow();
});
