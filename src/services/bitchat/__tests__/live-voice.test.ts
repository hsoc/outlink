/** @jest-environment node */
import { platform } from '@/platform';
import { decodeVoice, encodeVoice, type VoiceBurst } from '../compatibility/voice';
import { liveVoice, liveVoiceStore } from '../live-voice';

jest.mock('@/platform', () => ({ platform: {
  appState: { currentState: jest.fn(() => 'active') },
  liveVoice: {
    startCapture: jest.fn(async () => {}), stopCapture: jest.fn(async () => {}),
    stopPlayback: jest.fn(async () => {}), play: jest.fn(async () => {}),
    subscribe: jest.fn(() => () => {}),
  },
} }));
const id = new Uint8Array(8).fill(5);
const start: VoiceBurst = { id, sequence: 0, kind: 'start' };
const data: VoiceBurst = { id, sequence: 1, kind: 'data', frames: [Uint8Array.of(5, 6, 7)] };
const end: VoiceBurst = { id, sequence: 2, kind: 'end', count: 1, duration: 64 };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(async () => { await liveVoice.clear(); jest.clearAllMocks(); });

it('uses the upstream field layout and rejects malformed controls and AAC lengths', () => {
  expect([...encodeVoice(start)]).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 1, 1]);
  expect([...encodeVoice(data).slice(8)]).toEqual([0, 1, 0, 0, 3, 5, 6, 7]);
  for (const packet of [start, data, end, { id, sequence: 2, kind: 'cancel' } as const]) expect(decodeVoice(encodeVoice(packet))).toEqual(packet);
  expect(() => decodeVoice(encodeVoice(data).subarray(0, 14))).toThrow();
  expect(() => encodeVoice({ ...data, frames: [new Uint8Array(513)] })).toThrow();
});

it('plays only after opt-in, for the selected conversation, and rejects duplicated sequences', async () => {
  liveVoice.receive('a', 'Alice', start, false);
  liveVoice.receive('a', 'Alice', data, false);
  expect(platform.liveVoice.play).not.toHaveBeenCalled();
  liveVoice.listen('b');
  liveVoice.receive('a', 'Alice', start, true);
  liveVoice.receive('a', 'Alice', data, true);
  liveVoice.receive('b', 'Bob', start, true);
  liveVoice.receive('b', 'Bob', data, true);
  liveVoice.receive('b', 'Bob', data, true);
  liveVoice.receive('b', 'Bob', end, true);
  await tick();
  expect(platform.liveVoice.play).toHaveBeenCalledTimes(1);
  expect(liveVoiceStore.getState().speaker).toBeUndefined();
});

it('drops stale native callbacks and stops capture on release', async () => {
  let listener!: (token: number, frame: Uint8Array) => void;
  jest.mocked(platform.liveVoice.subscribe).mockImplementationOnce(callback => { listener = callback; return () => {}; });
  const sent: VoiceBurst[] = [];
  const send = async (packet: Uint8Array) => { sent.push(decodeVoice(packet)); };
  let held = true;
  await liveVoice.start(send, () => held);
  const token = jest.mocked(platform.liveVoice.startCapture).mock.calls.at(-1)![0];
  listener(token - 1, data.frames[0]);
  listener(token, data.frames[0]); await tick();
  held = false;
  await liveVoice.stop(send);
  listener(token, data.frames[0]); await tick();
  expect(sent.map(packet => packet.kind)).toEqual(['start', 'data', 'end']);
  expect(platform.liveVoice.stopCapture).toHaveBeenCalledTimes(1);
});

it('does not start the microphone if the user releases while the start frame is in flight', async () => {
  let deliver!: () => void;
  const send = jest.fn().mockImplementationOnce(() => new Promise<void>(resolve => { deliver = resolve; })).mockResolvedValue(undefined);
  let held = true;
  const pending = liveVoice.start(send, () => held);
  held = false;
  const stopped = liveVoice.stop(send);
  deliver();
  await Promise.all([pending, stopped]);
  expect(platform.liveVoice.startCapture).not.toHaveBeenCalled();
});
