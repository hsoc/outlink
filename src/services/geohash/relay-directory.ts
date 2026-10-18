import directory from './relay-directory.json';
import { geohashBounds, normalizeGeohash } from './geohash';
let currentDirectory = directory;
const cache = new Map<string, readonly string[]>();
/** Pinned public directory data, independently ranked by great-circle distance and hostname. */
export function areaRelays(input: string): string[] {
  const hash = normalizeGeohash(input), cached = cache.get(hash); if (cached) return [...cached];
  const bounds = geohashBounds(hash), latitude = (bounds.north + bounds.south) / 2, longitude = (bounds.east + bounds.west) / 2;
  const rad = (value: number) => value * Math.PI / 180;
  const ranked = currentDirectory.map(row => {
    const [host, lat, lon] = row as [string, number, number];
    const a = Math.sin(rad(lat - latitude) / 2) ** 2 + Math.cos(rad(latitude)) * Math.cos(rad(lat)) * Math.sin(rad(lon - longitude) / 2) ** 2;
    return { host, distance: 2 * Math.atan2(Math.sqrt(Math.max(0, a)), Math.sqrt(Math.max(0, 1 - a))) };
  }).sort((a, b) => a.distance - b.distance || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  const relays = [...new Set(ranked.slice(0, 5).map(entry => new URL(`wss://${entry.host}`).toString()))];
  if (cache.size >= 32) cache.delete(cache.keys().next().value!); cache.set(hash, relays); return [...relays];
}

export const RELAY_DIRECTORY_URL = 'https://raw.githubusercontent.com/permissionlesstech/bitchat/refs/heads/main/relays/online_relays_gps.csv';
type Row = [string, number, number];
const MAX_DIRECTORY_BYTES = 512 * 1024;
export function parseRelayDirectory(csv: string): Row[] {
  if (csv.length > MAX_DIRECTORY_BYTES) throw new Error('Relay directory is too large');
  const lines = csv.trim().split(/\r?\n/);
  if (lines.shift()?.replace(/^\uFEFF/, '') !== 'Relay URL,Latitude,Longitude' || lines.length > 5000 || !lines.length) throw new Error('Invalid directory header/count');
  const rows: Row[] = [], seen = new Map<string, string>();
  for (const line of lines) {
    const fields = line.split(','); if (fields.length !== 3) throw new Error('Invalid directory row');
    const [host, lat, lon] = fields.map(s => s.trim());
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::[0-9]{1,5})?$/i.test(host) || host.length > 253 || /\.(local|localhost|internal|test|invalid)(:|$)/i.test(host)) throw new Error('Invalid public relay host');
    if (!lat || !lon || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon)) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) throw new Error('Invalid relay location');
    const url = new URL(`wss://${host}`), coordinates = `${Number(lat)},${Number(lon)}`;
    if (seen.has(url.host) && seen.get(url.host) !== coordinates) throw new Error('Conflicting relay locations');
    seen.set(url.host, coordinates); rows.push([host.toLowerCase(), Number(lat), Number(lon)]);
  }
  return rows;
}
/** Refresh only when an internet feature using automatic area relays is joined. */
export class RelayDirectoryRefresh {
  private pending?: Promise<void>;
  private lastAttempt = -Infinity;
  private nextRefresh = 0;
  private loaded = false;
  private controller?: AbortController;
  private generation = 0;
  constructor(private readonly storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> },
    private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const generation = this.generation;
    const work = this.run(generation).finally(() => { if (this.pending === work) this.pending = undefined; });
    this.pending = work; return work;
  }
  private install(csv: string) { currentDirectory = parseRelayDirectory(csv); cache.clear(); }
  private async run(generation: number) {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const cached = await this.storage.getItem('mobile.relay-directory');
        if (generation !== this.generation) return;
        if (cached && cached.length <= 2 * MAX_DIRECTORY_BYTES + 256) {
          const value = JSON.parse(cached);
          if (typeof value.csv === 'string' && Number.isFinite(value.at) && value.at <= this.now()) {
            this.install(value.csv);
            if (this.now() - value.at < 86400000) { this.nextRefresh = value.at + 86400000; return; }
          }
        }
      } catch { /* Keep the bundled or previously accepted directory. */ }
    }
    if (generation !== this.generation || this.now() < this.nextRefresh || this.now() - this.lastAttempt < 3600000) return;
    this.lastAttempt = this.now();
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.fetcher(RELAY_DIRECTORY_URL, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > MAX_DIRECTORY_BYTES) return;
      const csv = await response.text(); parseRelayDirectory(csv);
      if (generation !== this.generation || controller.signal.aborted) return;
      await this.storage.setItem('mobile.relay-directory', JSON.stringify({ at: this.now(), csv }));
      if (generation === this.generation && !controller.signal.aborted) { this.install(csv); this.nextRefresh = this.now() + 86400000; }
    } catch { /* Offline or malformed updates never replace a working directory. */ }
    finally { clearTimeout(timer); if (this.controller === controller) this.controller = undefined; }
  }
  stop() { ++this.generation; this.lastAttempt = -Infinity; this.controller?.abort(); }
  async idle() { await this.pending; }
}
