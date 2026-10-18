/** Foreground/background lifecycle for pausing sessions and restoring connections.
 * Reads use cached OS state; listener registration performs no storage I/O.
 */

/** Mirrors React Native's `AppStateStatus`. */
export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStatePort {
  /** The current lifecycle state. */
  currentState(): AppStateStatus;
  /** Subscribe to lifecycle changes. */
  addChangeListener(listener: (state: AppStateStatus) => void): () => void;
}
