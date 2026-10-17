/** @jest-environment node */
import { getPublicKey } from 'nostr-tools/pure';
import { PrivateMailbox, embeddedPrivate, decodeEmbedded, type InternetPayload } from '../compatibility/private-mailbox';
import { createPrivateEnvelope, openPrivateEnvelope } from '../compatibility/nostr-private';
import type { GeoSocket } from '@/services/geohash/geohash-session';
const alice = new Uint8Array(32).fill(1), bob = new Uint8Array(32).fill(2);
const message: InternetPayload = { kind: 'message', id: 'message-1', content: 'private message', senderId: '01'.repeat(8), recipientId: '02'.repeat(8), timestamp: Date.now() };
function setup() {
  const sockets: (GeoSocket & { sent: unknown[][] })[] = [];
  const callbacks = { message: jest.fn(async (_sender: string, _payload: InternetPayload) => {}), connection: jest.fn(), error: jest.fn() };
  const key = bob.slice();
  const mailbox = new PrivateMailbox(key, ['wss://one.example', 'wss://two.example'], callbacks, () => {
    const socket = { readyState: 1, onopen: null, onclose: null, onerror: null, onmessage: null, sent: [] as unknown[][],
      send(data: string) { this.sent.push(JSON.parse(data)); }, close: jest.fn() };
    sockets.push(socket); return socket;
  });
  mailbox.start(); sockets.forEach(socket => socket.onopen!());
  const handler = sockets[0].onmessage!;
  const receive = (event: unknown) => handler({ data: JSON.stringify(['EVENT', 'private-inbox', event]) });
  return { mailbox, sockets, callbacks, key, receive };
}
it('subscribes only to its private inbox and requires relay acceptance without public presence', async () => {
  const f = setup();
  try {
    expect(f.sockets[0].sent).toEqual([['REQ', 'private-inbox', expect.objectContaining({ kinds: [1059], '#p': [getPublicKey(bob)] })]]);
    const pending = f.mailbox.send(getPublicKey(alice), message, message.senderId, message.recipientId);
    const event = f.sockets[0].sent.at(-1)![1] as { id: string };
    expect(await decodeEmbedded(openPrivateEnvelope(event, alice).content)).toMatchObject(message);
    f.sockets[0].onmessage!({ data: JSON.stringify(['OK', event.id, true, '']) }); await pending;
  } finally { f.mailbox.stop(); }
  expect(f.key.every(byte => byte === 0)).toBe(true);
});
it('validates authenticated senders, rejects malformed envelopes, deduplicates, and ignores events after stop', async () => {
  const f = setup();
  const event = createPrivateEnvelope(embeddedPrivate(message, message.senderId, message.recipientId), alice, getPublicKey(bob));
  try {
    f.receive({ ...event, content: 'forged' }); f.receive(event); f.receive(event); await f.mailbox.settled();
    expect(f.callbacks.message).toHaveBeenCalledTimes(1); expect(f.callbacks.message).toHaveBeenCalledWith(getPublicKey(alice), expect.objectContaining(message));
    expect(f.callbacks.error).not.toHaveBeenCalled();
    f.mailbox.stop(); f.receive(event); await f.mailbox.settled(); expect(f.callbacks.message).toHaveBeenCalledTimes(1);
  } finally { f.mailbox.stop(); }
});
it('reports application/storage failures and allows the same authentic event to be retried', async () => {
  const f = setup(), event = createPrivateEnvelope(embeddedPrivate(message), alice, getPublicKey(bob));
  try {
    f.callbacks.message.mockRejectedValueOnce(new Error('storage unavailable'));
    f.receive(event); await f.mailbox.settled(); expect(f.callbacks.error).toHaveBeenCalledTimes(1);
    f.receive(event); await f.mailbox.settled(); expect(f.callbacks.message).toHaveBeenCalledTimes(2);
  } finally { f.mailbox.stop(); }
});
