import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { encodeVoice, VOICE_DURATION_MS, VOICE_FRAME_MAX, type VoiceBurst } from './compatibility/voice';

type Route = string | null;
type Send = (payload: Uint8Array) => Promise<void>;
type Capture = {
  id: Uint8Array; token: number; sequence: number; started: number; queued: number;
  stopped: boolean; stopping?: Promise<void>; tail: Promise<void>; unsubscribe(): void; timer: ReturnType<typeof setTimeout>;
};
type Reception = { key: string; next: number; started: number; timer: ReturnType<typeof setTimeout> };

export const liveVoiceStore = createStore<{ listening: boolean; talking: boolean; speaker?: string; error: boolean }>(
  () => ({ listening: false, talking: false, error: false }),
);
let capture: Capture | undefined, reception: Reception | undefined, route: Route | undefined;
let serial = Promise.resolve(), playback = Promise.resolve(), queuedPlayback = 0, token = 0, playbackEpoch = 0;
let drainTimer: ReturnType<typeof setTimeout> | undefined;
const completed = new Map<string, number>();
const errors = () => liveVoiceStore.setState({ error: true });

function stopReception(discard: boolean) {
  const current = reception;
  if (current) {
    clearTimeout(current.timer);
    completed.set(current.key, Date.now());
    if (completed.size > 128) completed.delete(completed.keys().next().value!);
  }
  reception = undefined;
  liveVoiceStore.setState({ speaker: undefined });
  if (drainTimer) clearTimeout(drainTimer);
  if (discard) {
    playbackEpoch++;
    void platform.liveVoice.stopPlayback().catch(errors);
  } else {
    const epoch = playbackEpoch;
    drainTimer = setTimeout(() => {
      if (epoch !== playbackEpoch || reception) return;
      playbackEpoch++;
      void platform.liveVoice.stopPlayback().catch(errors);
    }, 650);
  }
}

function enqueueNative(operation: () => Promise<void>) {
  const pending = serial.then(operation);
  serial = pending.catch(() => {});
  return pending;
}

export const liveVoice = {
  listen(selected?: Route) {
    if (route === selected) return;
    route = selected; stopReception(true);
    liveVoiceStore.setState({ listening: selected !== undefined, error: false });
  },
  receive(peer: string, name: string, packet: VoiceBurst, direct: boolean) {
    if (route === undefined || (direct ? route !== peer : route !== null) || capture ||
        platform.appState.currentState() !== 'active') return;
    const key = peer + ':' + bytesToHex(packet.id), now = Date.now();
    if (packet.kind === 'start') {
      if (reception || now - (completed.get(key) ?? -Infinity) < 30000) return;
      if (drainTimer) clearTimeout(drainTimer);
      playbackEpoch++;
      reception = { key, next: 1, started: now, timer: setTimeout(() => stopReception(true), 2500) };
      liveVoiceStore.setState({ speaker: name });
      return;
    }
    const current = reception;
    if (!current || current.key !== key) return;
    if (packet.kind === 'cancel') { stopReception(true); return; }
    if (packet.kind === 'end') { stopReception(false); return; }
    if (packet.kind !== 'data' || packet.sequence < current.next || now - current.started > 30000) return;
    current.next = packet.sequence + 1;
    clearTimeout(current.timer);
    current.timer = setTimeout(() => stopReception(true), 2500);
    const epoch = playbackEpoch;
    for (const frame of packet.frames) {
      if (queuedPlayback >= 8) break;
      queuedPlayback++;
      playback = playback.then(async () => {
        if (epoch !== playbackEpoch || capture || route === undefined || platform.appState.currentState() !== 'active') return;
        await platform.liveVoice.play(frame);
      }).catch(errors).finally(() => { queuedPlayback--; });
    }
  },
  async start(send: Send, stillHeld: () => boolean): Promise<void> {
    if (!stillHeld() || capture || platform.appState.currentState() !== 'active') return;
    stopReception(true);
    const id = randomBytes(8), currentToken = ++token;
    const current: Capture = {
      id, token: currentToken, sequence: 0, started: Date.now(), queued: 0, stopped: false,
      tail: Promise.resolve(), unsubscribe: () => {}, timer: setTimeout(() => { void liveVoice.stop(send).catch(errors); }, VOICE_DURATION_MS),
    };
    capture = current;
    liveVoiceStore.setState({ talking: true, error: false });
    current.unsubscribe = platform.liveVoice.subscribe((eventToken, frame) => {
      if (capture !== current || current.stopped || eventToken !== currentToken || !frame.length || frame.length > VOICE_FRAME_MAX || current.queued >= 5) return;
      current.queued++;
      current.tail = current.tail.then(async () => {
        if (current.stopped || !stillHeld()) return;
        const sequence = current.sequence + 1;
        await send(encodeVoice({ id, sequence, kind: 'data', frames: [frame] }));
        current.sequence = sequence;
      }).catch(errors).finally(() => { current.queued--; });
    });
    try {
      current.tail = send(encodeVoice({ id, sequence: 0, kind: 'start' }));
      await current.tail;
      if (capture === current && !current.stopped && stillHeld())
        await enqueueNative(async () => { if (!current.stopped && stillHeld()) await platform.liveVoice.startCapture(currentToken); });
    } catch (error) {
      await liveVoice.stop(send, true);
      throw error;
    }
  },
  async stop(send?: Send, cancel = false): Promise<void> {
    const current = capture;
    if (!current) return;
    if (current.stopping) return current.stopping;
    current.stopped = true;
    current.unsubscribe();
    clearTimeout(current.timer);
    liveVoiceStore.setState({ talking: false });
    current.stopping = (async () => {
      try {
        await enqueueNative(() => platform.liveVoice.stopCapture());
        await current.tail.catch(() => {});
        if (send) {
          const sequence = current.sequence + 1;
          await send(encodeVoice(cancel || !current.sequence ? { id: current.id, sequence, kind: 'cancel' } :
            { id: current.id, sequence, kind: 'end', count: current.sequence, duration: Math.min(VOICE_DURATION_MS, Date.now() - current.started) }));
        }
      } finally { if (capture === current) capture = undefined; }
    })();
    await current.stopping;
  },
  async clear(): Promise<void> {
    if (!platform.liveVoice) return;
    route = undefined; stopReception(true); completed.clear();
    liveVoiceStore.setState({ listening: false, talking: false, error: false });
    await liveVoice.stop(undefined, true).catch(() => {});
    await playback;
    await platform.liveVoice.stopPlayback().catch(() => {});
  },
};
