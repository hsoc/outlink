/** Fixed 24-hour display of the message timestamp in the device's local timezone. */
export function messageTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  return '[' + [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map(value => String(value).padStart(2, '0')).join(':') + ']';
}
