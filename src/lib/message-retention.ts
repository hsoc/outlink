export const MESSAGE_WINDOW = 512;
export const MESSAGE_LIFETIME_MS = 6 * 60 * 60 * 1000;
/** Future sender clocks must not extend retention beyond six local hours. */
export function messageDeadline(message: { timestamp?: number }, now = Date.now()): number {
  if (typeof message.timestamp === 'number' && message.timestamp > now + 60000) return now;
  const timestamp = typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? Math.min(message.timestamp, now) : now;
  return timestamp + MESSAGE_LIFETIME_MS;
}
export function messageIsFresh(message: { timestamp?: number }, now = Date.now()): boolean {
  return messageDeadline(message, now) > now;
}
