/** An opt-in Android connected-device foreground service for an existing mesh. */
export interface BackgroundConnectivityPort {
  supported(): boolean;
  requestPermission(): Promise<boolean>;
  start(title: string, body: string, stop: string): Promise<void>;
  running(): Promise<boolean>;
  stop(): Promise<void>;
  onStop(listener: () => void): () => void;
}
