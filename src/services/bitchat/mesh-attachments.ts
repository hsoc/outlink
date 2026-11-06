import { createStore } from 'zustand/vanilla';
import type { MeshMedia } from './compatibility/media';

export type AttachmentOffer = { id: number; peer: string; name: string; privateMessage: boolean; size: number; mime: MeshMedia['mime'] };
export const meshAttachmentStore = createStore<{ offers: AttachmentOffer[]; epoch: number }>(() => ({ offers: [], epoch: 0 }));
const pending = new Map<number, { media: MeshMedia; timer: ReturnType<typeof setTimeout> }>();
let nextId = 0;
function remove(id: number) {
  const item = pending.get(id);
  if (!item) return;
  pending.delete(id);
  clearTimeout(item.timer);
  meshAttachmentStore.setState(state => ({ offers: state.offers.filter(offer => offer.id !== id) }));
  return item.media;
}
export const meshAttachments = {
  offer(peer: string, name: string, media: MeshMedia, privateMessage: boolean) {
    const offers = meshAttachmentStore.getState().offers;
    if (offers.length >= 8 || offers.filter(offer => offer.peer === peer).length >= 2) { media.data.fill(0); return; }
    const id = ++nextId;
    pending.set(id, { media, timer: setTimeout(() => meshAttachments.decline(id), 5 * 60 * 1000) });
    meshAttachmentStore.setState({ offers: [...offers, { id, peer, name, privateMessage, size: media.data.length, mime: media.mime }] });
  },
  accept: remove,
  decline(id: number) { remove(id)?.data.fill(0); },
  clear() {
    for (const id of pending.keys()) meshAttachments.decline(id);
    meshAttachmentStore.setState(state => ({ epoch: state.epoch + 1 }));
  },
};
