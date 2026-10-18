import directory from './relay-directory.json';
import { geohashBounds, normalizeGeohash } from './geohash';
const cache = new Map<string, readonly string[]>();
/** Pinned public directory data, independently ranked by great-circle distance and hostname. */
export function areaRelays(input: string): string[] {
  const hash = normalizeGeohash(input), cached = cache.get(hash); if (cached) return [...cached];
  const bounds = geohashBounds(hash), latitude = (bounds.north + bounds.south) / 2, longitude = (bounds.east + bounds.west) / 2;
  const rad = (value: number) => value * Math.PI / 180;
  const ranked = directory.map(row => {
    const [host, lat, lon] = row as [string, number, number];
    const a = Math.sin(rad(lat - latitude) / 2) ** 2 + Math.cos(rad(latitude)) * Math.cos(rad(lat)) * Math.sin(rad(lon - longitude) / 2) ** 2;
    return { host, distance: 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a))) };
  }).sort((a, b) => a.distance - b.distance || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  const relays = [...new Set(ranked.slice(0, 5).map(entry => new URL(`wss://${entry.host}`).toString()))];
  if (cache.size >= 32) cache.delete(cache.keys().next().value!); cache.set(hash, relays); return [...relays];
}
