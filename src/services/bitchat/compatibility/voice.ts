import { join } from '../bitchat-wire';
import { number, unsigned } from './binary';

export const VOICE_DURATION_MS = 15000;
export const VOICE_FRAME_MAX = 512;
export type VoiceBurst =
  | { id: Uint8Array; sequence: number; kind: 'start' | 'cancel' }
  | { id: Uint8Array; sequence: number; kind: 'data'; frames: Uint8Array[] }
  | { id: Uint8Array; sequence: number; kind: 'end'; count: number; duration: number };

export function encodeVoice(packet: VoiceBurst): Uint8Array {
  if (packet.id.length !== 8) throw new Error('Invalid voice ID');
  const header = join(packet.id, unsigned(packet.sequence, 2));
  switch (packet.kind) {
    case 'start': return join(header, Uint8Array.of(1, 1));
    case 'cancel': return join(header, Uint8Array.of(4));
    case 'end': return join(header, Uint8Array.of(2), unsigned(packet.count, 2), unsigned(packet.duration, 4));
    case 'data':
      if (!packet.frames.length || packet.frames.length > 8 || packet.frames.some(frame => !frame.length || frame.length > VOICE_FRAME_MAX))
        throw new Error('Invalid voice frames');
      return join(header, Uint8Array.of(0), ...packet.frames.map(frame => join(unsigned(frame.length, 2), frame)));
  }
}

export function decodeVoice(payload: Uint8Array): VoiceBurst {
  if (payload.length < 11 || payload.length > 11 + 8 * (2 + VOICE_FRAME_MAX)) throw new Error('Invalid voice packet');
  const id = payload.slice(0, 8), sequence = number(payload.subarray(8, 10), 2);
  const kind = payload[10];
  if (kind === 1 && sequence === 0 && payload.length === 12 && payload[11] === 1) return { id, sequence, kind: 'start' };
  if (kind === 4 && payload.length === 11) return { id, sequence, kind: 'cancel' };
  if (kind === 2 && payload.length === 17) {
    const count = number(payload.subarray(11, 13), 2), duration = number(payload.subarray(13, 17), 4);
    return { id, sequence, kind: 'end', count, duration };
  }
  if (kind !== 0 || !sequence) throw new Error('Invalid voice control');
  const frames: Uint8Array[] = [];
  for (let offset = 11; offset < payload.length;) {
    const length = number(payload.subarray(offset, offset + 2), 2); offset += 2;
    if (!length || length > VOICE_FRAME_MAX || offset + length > payload.length || frames.length >= 8) throw new Error('Invalid AAC frame');
    frames.push(payload.slice(offset, offset + length)); offset += length;
  }
  if (!frames.length) throw new Error('Empty voice packet');
  return { id, sequence, kind: 'data', frames };
}
