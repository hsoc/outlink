/** @jest-environment node */
import { decodeMeshMedia, encodeMeshMedia, MESH_MEDIA_LIMIT } from '../compatibility/media';
import { meshAttachments, meshAttachmentStore } from '../mesh-attachments';

const image = () => Uint8Array.of(255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0);
afterEach(() => meshAttachments.clear());

it('round trips the attachment and rejects malformed, mismatched and oversized input', () => {
  const payload = encodeMeshMedia('image/jpeg', image());
  expect(decodeMeshMedia(payload)).toEqual({ mime: 'image/jpeg', data: image() });
  expect(() => decodeMeshMedia(payload.subarray(0, payload.length - 1))).toThrow();
  expect(() => encodeMeshMedia('image/png', image())).toThrow();
  expect(() => encodeMeshMedia('image/jpeg', new Uint8Array(MESH_MEDIA_LIMIT + 1))).toThrow();
});
it('keeps incoming bytes out of the visible store until explicitly accepted', () => {
  const data = image();
  meshAttachments.offer('peer', 'Alice', { mime: 'image/jpeg', data }, true);
  const [offer] = meshAttachmentStore.getState().offers;
  expect(offer).not.toHaveProperty('data');
  expect(meshAttachments.accept(offer.id)?.data).toEqual(image());
  expect(meshAttachments.accept(offer.id)).toBeUndefined();
  meshAttachments.offer('peer', 'Alice', { mime: 'image/jpeg', data }, false);
  meshAttachments.decline(meshAttachmentStore.getState().offers[0].id);
  expect(data.every(byte => byte === 0)).toBe(true);
});
