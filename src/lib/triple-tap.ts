/** Three activations inside one bounded window; partial sequences never linger. */
export function createTripleTap(action: () => void, now = () => performance.now(), windowMs = 1500) {
  let count = 0, started = 0;
  const reset = () => { count = 0; started = 0; };
  return {
    reset,
    tap() {
      const time = now();
      if (!count || time < started || time - started > windowMs) { started = time; count = 1; }
      else ++count;
      if (count === 3) { reset(); action(); }
    },
  };
}
