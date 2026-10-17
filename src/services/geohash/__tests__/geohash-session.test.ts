/** @jest-environment node */
import { GeohashSession, type GeoSocket } from '../geohash-session';
import { createGeohashEvent } from '../geohash-protocol';
function setup() {
  const sockets: (GeoSocket & { sent: unknown[][] })[] = [];
  const callbacks = { message: jest.fn(), delivery: jest.fn(), connection: jest.fn(), presence: jest.fn(), error: jest.fn() };
  const session = new GeohashSession('ezs42', new Uint8Array(32).fill(1), 'Alice', ['wss://one.example','wss://two.example'], callbacks, () => {
    const socket = { readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null,
      sent: [] as unknown[][], send(data: string) { this.sent.push(JSON.parse(data)); }, close: jest.fn() };
    sockets.push(socket); return socket;
  });
  return { session, sockets, callbacks };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
it('subscribes exactly, validates and deduplicates across relays, and cancels on stop', () => {
  const { session, sockets, callbacks } = setup(); session.start(); sockets.forEach(s => s.onopen!());
  expect(sockets[0].sent[0]).toEqual(['REQ','geohash',expect.objectContaining({ kinds: [20000,20001], '#g': ['ezs42'] })]);
  const event = createGeohashEvent(new Uint8Array(32).fill(2), 'ezs42', 'Bob', 'hello');
  for (const s of sockets) s.onmessage!({ data: JSON.stringify(['EVENT','geohash',event]) });
  expect(callbacks.message).toHaveBeenCalledTimes(1);
  sockets[0].onmessage!({ data: JSON.stringify(['EVENT','geohash',{...event,content:'forged'}]) });
  expect(callbacks.message).toHaveBeenCalledTimes(1);
  const stale = sockets[0].onmessage!; session.stop(); stale({ data: JSON.stringify(['EVENT','geohash',event]) });
  jest.runOnlyPendingTimers(); expect(sockets).toHaveLength(2);
  expect(callbacks.message).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
});
it('requires a positive relay ack and allows one relay to reject while another accepts', async () => {
  const { session, sockets, callbacks } = setup(); session.start(); sockets.forEach(s => s.onopen!());
  const sent = session.send('hello');
  const event = sockets[0].sent.at(-1)![1] as { id: string };
  sockets[0].onmessage!({ data: JSON.stringify(['OK',event.id,false,'blocked']) });
  expect(callbacks.delivery).not.toHaveBeenCalled();
  sockets[1].onmessage!({ data: JSON.stringify(['OK',event.id,true,'']) });
  await sent; expect(callbacks.delivery).toHaveBeenCalledWith(event.id,'sent'); session.stop();
});
it('times out unacknowledged sends, bounds retry timers, and rejects pending sends on leave', async () => {
  const { session, sockets, callbacks } = setup(); session.start(); sockets.forEach(s => s.onopen!());
  const pending = session.send('hello'); const expected = expect(pending).rejects.toThrow('timed out');
  jest.advanceTimersByTime(8000); await expected;
  expect(callbacks.delivery).toHaveBeenLastCalledWith(expect.any(String),'failed');
  const pending2 = session.send('goodbye'); const expected2 = expect(pending2).rejects.toThrow('closed');
  session.stop(); await expected2; expect(jest.getTimerCount()).toBe(0);
});
it('retries a stalled connection and ignores late messages from replaced sockets', () => {
  const { session, sockets, callbacks } = setup(); session.start();
  const late = sockets[0].onmessage!;
  jest.advanceTimersByTime(11_000); expect(sockets.length).toBe(4);
  const event = createGeohashEvent(new Uint8Array(32).fill(2), 'ezs42', 'Bob', 'late');
  late({ data: JSON.stringify(['EVENT','geohash',event]) });
  expect(callbacks.message).not.toHaveBeenCalled(); session.stop(); expect(jest.getTimerCount()).toBe(0);
});
