import { bytes, join, text } from '../bitchat-wire';
import { number, tlv16, unsigned } from './binary';

export const PRIVATE_MEDIA_CAPABILITY = 1 << 8;
export const MESH_MEDIA_LIMIT = 96 * 1024;
export const mediaExtensions = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a',
} as const;
export type MediaMime = keyof typeof mediaExtensions;
export type MeshMedia = { mime: MediaMime; data: Uint8Array };

function validate(mime: string, data: Uint8Array): asserts mime is MediaMime {
  if (!Object.hasOwn(mediaExtensions, mime) || data.length < 12 || data.length > MESH_MEDIA_LIMIT)
    throw new Error('Unsupported mesh attachment');
  const ascii = (offset: number, label: string) => [...label].every((character, i) => data[offset + i] === character.charCodeAt(0));
  const valid = mime === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff :
    mime === 'image/png' ? data[0] === 0x89 && ascii(1, 'PNG\r\n\x1a\n') :
    mime === 'image/webp' ? ascii(0, 'RIFF') && ascii(8, 'WEBP') : ascii(4, 'ftyp');
  if (!valid) throw new Error('Attachment type does not match content');
}
export function encodeMeshMedia(mime: string, data: Uint8Array): Uint8Array {
  validate(mime, data);
  return join(tlv16([[1, bytes('outlink.' + mediaExtensions[mime])], [2, unsigned(data.length, 4)], [3, bytes(mime)]]),
    Uint8Array.of(4), unsigned(data.length, 4), data);
}
export function decodeMeshMedia(payload: Uint8Array): MeshMedia {
  if (payload.length > MESH_MEDIA_LIMIT + 512) throw new Error('Attachment exceeds limit');
  let size: number | undefined, mime = '', data: Uint8Array | undefined;
  const seen = new Set<number>();
  for (let offset = 0; offset < payload.length;) {
    const type = payload[offset++], width = type === 4 ? 4 : 2;
    const length = number(payload.subarray(offset, offset + width), width);
    offset += width;
    if (offset + length > payload.length || seen.has(type)) throw new Error('Invalid attachment field');
    seen.add(type);
    const value = payload.subarray(offset, offset + length);
    offset += length;
    if (type === 2) size = number(value, 4);
    if (type === 3) mime = text(value);
    if (type === 4) data = value;
  }
  if (!data || size !== data.length) throw new Error('Invalid attachment size');
  validate(mime, data);
  return { mime, data: data.slice() };
}
