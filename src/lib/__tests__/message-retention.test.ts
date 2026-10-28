import { MESSAGE_WINDOW, MESSAGE_LIFETIME_MS, messageDeadline, messageIsFresh } from '../message-retention';
it('uses a 512-entry loaded window and expires at six hours, not after the boundary', () => {
  expect(MESSAGE_WINDOW).toBe(512);
  const timestamp = 1000000;
  expect(messageIsFresh({ timestamp }, timestamp + MESSAGE_LIFETIME_MS - 1)).toBe(true);
  expect(messageIsFresh({ timestamp }, timestamp + MESSAGE_LIFETIME_MS)).toBe(false);
});
it('does not let a future clock create indefinite retention', () => {
  expect(messageIsFresh({ timestamp: 9999999999999 }, 1000000)).toBe(false);
  expect(messageDeadline({ timestamp: 1000010 }, 1000000)).toBe(1000000 + MESSAGE_LIFETIME_MS);
});
