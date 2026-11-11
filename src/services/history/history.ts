import { messageIsFresh } from '@/lib/message-retention';
import { platform } from '@/platform';
import { sessionIntent } from './lifecycle';
/** Serialize writes, hydration, and explicit deletion so stale writes cannot undo deletion. */
let pending: Promise<unknown> = Promise.resolve();
export function historyOperation<T>(operation: () => Promise<T>): Promise<T> {
  const next = pending.catch(() => {}).then(operation);
  pending = next;
  return next;
}
export const saveMessage = (room: string, id: string, message: unknown) =>
  historyOperation(() => platform.history.save(room, id, JSON.stringify(message)));
export async function loadMessages<T extends { delivery: string }>(room: string, before?: number) {
  const rows = await historyOperation(() => platform.history.load(room, before));
  return { before: rows[0]?.sequence, messages: rows.map(row => {
    const message = JSON.parse(row.value) as T;
    return message.delivery === 'sending' ? { ...message, delivery: 'failed' } : message;
  }).filter(message => messageIsFresh(message as { timestamp?: number })) };
}
type SenderLabel = { label: string; timestamp: number };
const senderLabels = new Map<string, SenderLabel & { room: string; peer?: string }>();
let labelEpoch = sessionIntent();
function syncLabelEpoch() {
  if (labelEpoch !== sessionIntent()) {
    senderLabels.clear();
    labelEpoch = sessionIntent();
  }
}
const labelKey = (room: string, id: string, timestamp: number) => JSON.stringify([room, id, timestamp]);

export function retainedSenderLabel(room: string, id: string, timestamp: number) {
  if (labelEpoch === sessionIntent()) return senderLabels.get(labelKey(room, id, timestamp))?.label;
}

export function retainSenderLabels(room: string, labels: ReadonlyMap<string, SenderLabel>, peer?: string) {
  syncLabelEpoch();
  const epoch = labelEpoch;
  for (const [id, entry] of labels) {
    const key = labelKey(room, id, entry.timestamp);
    if (senderLabels.has(key) || !messageIsFresh(entry)) continue;
    senderLabels.set(key, { label: entry.label, timestamp: entry.timestamp, room, peer });
    void historyOperation(async () => {
      if (epoch === sessionIntent()) await platform.history.retainSenderLabel?.(room, id, entry.label);
    }).catch(() => { /* Keep the displayed label in memory if storage is unavailable. */ });
  }
}

export function pruneSenderLabels(now: number) {
  syncLabelEpoch();
  for (const [key, entry] of senderLabels) if (!messageIsFresh(entry, now)) senderLabels.delete(key);
}

export function forgetSenderLabels(room: string, peer: string) {
  for (const [key, entry] of senderLabels) if (entry.room === room && entry.peer === peer) senderLabels.delete(key);
}

export const resetSenderLabels = () => senderLabels.clear();
export const clearHistory = () => {
  resetSenderLabels();
  return historyOperation(() => platform.history.clear());
};
