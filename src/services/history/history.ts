import { platform } from '@/platform';
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
  }) };
}
export const clearHistory = () => historyOperation(() => platform.history.clear());
