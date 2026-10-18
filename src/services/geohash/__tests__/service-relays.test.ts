/** @jest-environment node */
import { geohashService, geohashStore } from '../geohash.service';
import { refreshAreaRelays } from '../relay-refresh';
import { areaRelays } from '../relay-directory';
import type { GeoSocket } from '../geohash-session';
jest.mock('@/platform', () => ({ platform: {
  preferences: { getItem: async () => JSON.stringify({ autoAreaRelays: false, internet: false }) },
  secureStorage: { getItem: async () => 'aa'.repeat(32) },
  history: { load: async () => [], save: async () => {} }, records: { list: async () => [] },
} }));
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
