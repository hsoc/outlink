import { blockedUsers } from '@/services/moderation/blocked-users';
import { privateMessageAlerts } from '@/services/mentions/private-messages';
import { GeoPrivateSession } from '../private-session';
import { mentionService } from '@/services/mentions/mentions';
import { createGeohashEvent } from '../geohash-protocol';
/** @jest-environment node */
import { saveNickname } from '@/services/preferences/nickname';
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { geohashService, geohashStore } from '../geohash.service';
import { refreshAreaRelays } from '../relay-refresh';
import { platform } from '@/platform';
import { eraseChannelIdentities, CHANNEL_ROTATION_MS } from '../channel-identities';
import { areaRelays } from '../relay-directory';
import { GeohashSession, type GeoSocket } from '../geohash-session';
jest.mock('@/services/mentions/private-messages', () => ({ privateMessageAlerts: { received: jest.fn() } }));
jest.mock('../private-session', () => {
  const actual = jest.requireActual('../private-session');
  return { ...actual, GeoPrivateSession: jest.fn().mockImplementation((...args) => new actual.GeoPrivateSession(...args)) };
});
jest.mock('@/services/mentions/mentions', () => ({ mentionService: { received: jest.fn() } }));
jest.mock('@/platform', () => { const secrets = new Map([['outlink.mobile.identity', 'aa'.repeat(32)]]); return { platform: {
  preferences: { getItem: jest.fn(async (key: string) => key === 'mobile.nickname' ? 'Alice' : JSON.stringify({ autoAreaRelays: false, internet: false })), setItem: jest.fn(async () => {}) },
  secureStorage: { getItem: jest.fn(async (key: string) => secrets.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { secrets.set(key, value); }), deleteItem: jest.fn(async (key: string) => { secrets.delete(key); }) },
  location: { currentCoordinates: jest.fn(async () => ({ latitude: 57.64911, longitude: 10.40744 })) },
  history: { load: async () => [], save: async () => {} }, records: { get: async () => null, list: async () => [] },
} }; });
jest.mock('../relay-refresh', () => ({ refreshAreaRelays: jest.fn(async () => {}), stopRelayRefresh: jest.fn(async () => {}) }));
const sockets: (GeoSocket & { url: string })[] = [];
beforeEach(() => {
  jest.clearAllMocks(); sockets.length = 0;
  let name = 'Alice';
  jest.mocked(platform.preferences.getItem).mockImplementation(async key => key === 'mobile.nickname' ? name : JSON.stringify({ autoAreaRelays: false, internet: false }));
  jest.mocked(platform.preferences.setItem).mockImplementation(async (key, value) => { if (key === 'mobile.nickname') name = value; });
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

it('posts the saved shared name after join, edits, and restart instead of a stale caller name', async () => {
  await geohashService.join('ezs42', 'Stale setup name', ['wss://one.example']);
  sockets.forEach(s => s.onopen?.());
  expect(geohashService.connection?.name).toBe('Alice');
  async function post(content: string, expected: string) {
    const socket = sockets.at(-1)!;
    const sent = geohashService.send(content);
    let event: Event | undefined;
    for (let i = 0; i < 100; i++) {
      event = (socket.send as jest.Mock).mock.calls.map(([data]) => JSON.parse(data)).find(frame => frame[0] === 'EVENT' && frame[1].content === content)?.[1];
      if (event) break;
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    if (!event) throw new Error('No signed location event emitted');
    const posted = event;
    expect(event.tags).toContainEqual(['n', expected]); expect(verifyEvent(event)).toBe(true);
    socket.onmessage?.({ data: JSON.stringify(['OK', event.id, true, '']) }); await sent;
    expect(geohashStore.getState().messages.find(m => m.id === posted.id)?.name).toBe(expected);
  }
  await post('before settings edit', 'Alice');
  await saveNickname('Shared updated name');
  // Deliberately omit a direct session rename: persistence must remain authoritative.
  await post('after settings edit', 'Shared updated name');
  geohashService.stop(); await geohashService.idle();
  await geohashService.join('ezs42', 'Old resume snapshot', ['wss://one.example']); sockets.at(-1)!.onopen?.();
  await post('after restart', 'Shared updated name');
});

it('does not publish with a stale name when reading the saved nickname fails', async () => {
  await geohashService.join('ezs42', 'Stale setup name', ['wss://one.example']); sockets.forEach(s => s.onopen?.());
  jest.mocked(platform.preferences.getItem).mockImplementationOnce(async () => { throw new Error('Name storage unavailable'); });
  await expect(geohashService.send('must not publish')).rejects.toThrow('Name storage unavailable');
  expect(sockets.flatMap(s => (s.send as jest.Mock).mock.calls.map(([data]) => JSON.parse(data))).some(frame => frame[0] === 'EVENT' && frame[1].content === 'must not publish')).toBe(false);
});

it('derives all five preset codes and the six-character bridge neighborhood from the same location fix', async () => {
  const expected = ['u4p', 'u4pr', 'u4pru', 'u4pruy', 'u4pruyd'];
  for (let i = 0; i < expected.length; i++) {
    const before = jest.mocked(platform.location.currentCoordinates).mock.calls.length;
    expect(await geohashService.nearby(i + 3)).toEqual({ hash: expected[i], neighborhood: 'u4pruy' });
    expect(platform.location.currentCoordinates).toHaveBeenCalledTimes(before + 1);
  }
});
it('rejects a denied location lookup instead of inventing a bridge suffix', async () => {
  jest.mocked(platform.location.currentCoordinates).mockRejectedValueOnce(new Error('Location denied'));
  await expect(geohashService.nearby(3)).rejects.toThrow('Location denied');
});

it('validates precision before requesting coordinates', async () => {
  await expect(geohashService.nearby(0)).rejects.toThrow('Invalid geohash precision');
  expect(platform.location.currentCoordinates).not.toHaveBeenCalled();
});

it('passes a received public location mention to notification handling only once', async () => {
  await geohashService.join('u4pruy', 'Alice', ['wss://one.example']); sockets.forEach(s => s.onopen?.());
  const event = createGeohashEvent(new Uint8Array(32).fill(2), 'u4pruy', 'Bob', '@Alice hello');
  const frame = { data: JSON.stringify(['EVENT', 'geohash', event]) };
  sockets[0].onmessage?.(frame); sockets[0].onmessage?.(frame);
  expect(mentionService.received).toHaveBeenCalledTimes(1);
  expect(mentionService.received).toHaveBeenCalledWith(expect.objectContaining({ content: '@Alice hello', outgoing: false }), 'geo', 'u4pruy', event.id, [expect.any(String)]);
});

it('feeds only new private arrival hooks to scoped alerts and ignores callbacks after leave', async () => {
  await geohashService.join('u4pruy', 'Alice', ['wss://one.example']); await geohashService.enableInternet(true);
  const deps = jest.mocked(GeoPrivateSession).mock.calls.at(-1)![2];
  const message = { id: 'dm', peer: 'b'.repeat(64), recipient: geohashStore.getState().publicIdentity, name: 'bbbbbbbb', content: 'secret', timestamp: Date.now(), outgoing: false, delivery: 'delivered' as const };
  deps.changed(message);
  expect(privateMessageAlerts.received).not.toHaveBeenCalled();
  deps.received!(message);
  expect(privateMessageAlerts.received).toHaveBeenCalledWith(message, 'geo', 'u4pruy');
  geohashService.stop(); deps.received!({ ...message, id: 'late' });
  expect(privateMessageAlerts.received).toHaveBeenCalledTimes(1);
});

it('suppresses public messages and mentions from blocked known location aliases', async () => {
  await geohashService.join('u4pruy', 'Alice', ['wss://one.example']); sockets.forEach(socket => socket.onopen?.());
  const event = createGeohashEvent(new Uint8Array(32).fill(7), 'u4pruy', 'Bob', '@Alice blocked');
  const old = 'c'.repeat(64);
  geohashStore.setState({ privateThreads: [{ peer: old, head: event.pubkey, keys: [old, event.pubkey], local: '', blocked: false, migrating: false }] });
  const check = jest.spyOn(blockedUsers, 'has').mockImplementation(key => key === 'nostr:' + old);
  try {
    for (const socket of sockets) socket.onmessage?.({ data: JSON.stringify(['EVENT', 'geohash', event]) });
    expect(geohashStore.getState().messages.some(message => message.id === event.id)).toBe(false);
    expect(mentionService.received).not.toHaveBeenCalled();
  } finally { check.mockRestore(); }
});

it('expands Location public and private actions using the saved sender nickname', async () => {
  await geohashService.join('u4pruy', 'Alice', ['wss://one.example']);
  const publicSend = jest.spyOn(GeohashSession.prototype, 'send').mockResolvedValue();
  try {
    await saveNickname('Bob');
    await geohashService.send('/slap @quattro');
    expect(publicSend).toHaveBeenCalledWith('* 🐟 Bob slaps quattro around a bit with a large trout *');
    await geohashService.enableInternet(true);
    const privateSession = jest.mocked(GeoPrivateSession).mock.results.at(-1)!.value;
    const privateSend = jest.spyOn(privateSession, 'send').mockResolvedValue(undefined);
    await geohashService.sendPrivate('a'.repeat(64), '/me waves');
    expect(privateSend).toHaveBeenCalledWith('a'.repeat(64), '* Bob waves *', 'Bob');
  } finally { publicSend.mockRestore(); }
});
