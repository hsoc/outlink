/** @jest-environment node */
import { createTripleTap } from '../triple-tap';
it('requires three activations inside one total window and resets after firing', () => {
  let now = 0; const action = jest.fn(), gesture = createTripleTap(action, () => now);
  gesture.tap(); now = 300; gesture.tap(); expect(action).not.toHaveBeenCalled();
  now = 600; gesture.tap(); expect(action).toHaveBeenCalledTimes(1);
  gesture.tap(); expect(action).toHaveBeenCalledTimes(1);
});
it('does not combine slow taps or retain a sequence after focus/background reset', () => {
  let now = 0; const action = jest.fn(), gesture = createTripleTap(action, () => now);
  gesture.tap(); now = 1000; gesture.tap(); now = 2000; gesture.tap();
  expect(action).not.toHaveBeenCalled();
  gesture.reset(); gesture.tap(); gesture.tap(); gesture.reset(); gesture.tap();
  expect(action).not.toHaveBeenCalled();
});
it('starts a new sequence if the clock moves backwards', () => {
  let now = 100; const action = jest.fn(), gesture = createTripleTap(action, () => now);
  gesture.tap(); gesture.tap(); now = 0; gesture.tap(); expect(action).not.toHaveBeenCalled();
  gesture.tap(); gesture.tap(); expect(action).toHaveBeenCalledTimes(1);
});
