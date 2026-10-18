/** @jest-environment node */
import { geohashService, geohashStore } from '../geohash.service';
import { refreshAreaRelays } from '../relay-refresh';
import { platform } from '@/platform';
import { eraseChannelIdentities, CHANNEL_ROTATION_MS } from '../channel-identities';
import { areaRelays } from '../relay-directory';
import type { GeoSocket } from '../geohash-session';
jest.mock('@/platform', () => { const secrets = new Map([['outlink.mobile.identity', 'aa'.repeat(32)]]); return { platform: {
  preferences: { getItem: async () => JSON.stringify({ autoAreaRelays: false, internet: false }) },
  secureStorage: { getItem: jest.fn(async (key: string) => secrets.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { secrets.set(key, value); }), deleteItem: jest.fn(async (key: string) => { secrets.delete(key); }) },
  history: { load: async () => [], save: async () => {} }, records: { list: async () => [] },
} }; });
jest.mock('../relay-refresh', () => ({ refreshAreaRelays: jest.fn(async () => {}), stopRelayRefresh: jest.fn(async () => {}) }));
const sockets: (GeoSocket & { url: string })[] = [];
beforeEach(() => {
  jest.clearAllMocks(); sockets.length = 0;
  global.WebSocket = jest.fn().mockImplementation((url: string) => {
    const s = { url, readyState: 1, onopen: null, onmessage: null, onclose: null, onerror: null, send: jest.fn(), close: jest.fn() };
    sockets.push(s); return s;
  }) as unknown as typeof WebSocket;
});
afterEach(async () => { geohashService.stop(); await geohashService.idle(); });
it('switches joined public and private relay pools when settings change and bypasses refresh in custom mode', async () => {
  await geohashService.join('u4pruy', 'Alice', ['wss://one.example']);
  expect(refreshAreaRelays).not.toHaveBeenCalled();
  await geohashService.enableInternet(true);
  sockets.forEach(s => s.onopen?.()); expect(geohashStore.getState().privateActive).toBe(true);
  const previous = [...sockets];
  await geohashService.configureRelays(false, ['wss://two.example']);
  expect(previous.every(s => (s.close as jest.Mock).mock.calls.length === 1)).toBe(true);
  expect(sockets.slice(previous.length).map(s => s.url)).toEqual(['wss://two.example/', 'wss://two.example/']);
  await geohashService.configureRelays(true, []);
  expect(refreshAreaRelays).toHaveBeenCalledTimes(1);
  expect(geohashService.connection?.relays).toEqual(areaRelays('u4pruy'));
  await geohashService.enableInternet(false); expect(geohashStore.getState().privateActive).toBe(false);
});
it('does not apply a late automatic selection after custom settings or leave', async () => {
  await geohashService.join('u4pruy', 'Alice', ['wss://one.example']);
  let resolve!: () => void;
  jest.mocked(refreshAreaRelays).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = geohashService.configureRelays(true, []);
  await geohashService.configureRelays(false, ['wss://two.example']); resolve(); await pending;
  expect(geohashService.connection?.relays).toEqual(['wss://two.example/']);
  jest.mocked(refreshAreaRelays).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const leaving = geohashService.configureRelays(true, []); geohashService.stop(); const count = sockets.length;
  resolve(); await leaving; expect(sockets).toHaveLength(count); expect(geohashStore.getState().active).toBe(false);
});

it('rotates joined public signing and grace inboxes without rejoining or forgetting the key on restart', async () => {
  let now = Date.now(); const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    await geohashService.join('u4pruy', 'Alice', ['wss://one.example']); await geohashService.enableInternet(true);
    sockets.forEach(s => s.onopen?.()); const first = geohashStore.getState().publicIdentity, count = sockets.length;
    now += CHANNEL_ROTATION_MS + 1; await geohashService.checkIdentity();
    const next = geohashStore.getState().publicIdentity; expect(next).not.toBe(first); expect(sockets).toHaveLength(count);
    const filters = sockets.flatMap(s => (s.send as jest.Mock).mock.calls.map(([data]) => JSON.parse(data))).filter(frame => frame[0] === 'REQ' && frame[1] === 'private-inbox');
    expect(filters.at(-1)[2]['#p']).toEqual(expect.arrayContaining([first, next]));
    const publicEvents = sockets.flatMap(s => (s.send as jest.Mock).mock.calls.map(([data]) => JSON.parse(data))).filter(frame => frame[0] === 'EVENT');
    expect(publicEvents.at(-1)[1].pubkey).toBe(next);
    expect(publicEvents.every(frame => frame[1].tags.every((tag: string[]) => tag[0] !== 'p' && tag[0] !== 'previous'))).toBe(true);
    geohashService.stop(); await geohashService.idle(); await geohashService.join('u4pruy', 'Alice', ['wss://one.example']);
    expect(geohashStore.getState().publicIdentity).toBe(next);
  } finally { clock.mockRestore(); }
});
it('drains a delayed secure-key write before identity erasure and prevents a late rotation from reopening transports', async () => {
  let now = Date.now(); const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const write = platform.secureStorage.setItem.bind(platform.secureStorage); let release!: () => void, reached = false;
  try {
    await geohashService.join('ezs42', 'Alice', ['wss://one.example']); sockets.forEach(s => s.onopen?.());
    jest.mocked(platform.secureStorage.setItem).mockImplementationOnce(async (key, value) => { reached = true; await new Promise<void>(yes => { release = yes; }); await write(key, value); });
    now += CHANNEL_ROTATION_MS + 1; const rotation = geohashService.checkIdentity();
    while (!reached) await new Promise(resolve => setTimeout(resolve, 1));
    geohashService.stop(); const idle = geohashService.idle(); const count = sockets.length; release(); await rotation; await idle;
    await eraseChannelIdentities(platform.secureStorage, 'aa'.repeat(32));
    expect(geohashStore.getState().active).toBe(false); expect(geohashStore.getState().publicIdentity).toBe(''); expect(sockets).toHaveLength(count);
    expect(await platform.secureStorage.getItem('outlink.channel-keys.index.' + 'aa'.repeat(32))).toBeNull();
  } finally { clock.mockRestore(); }
});
