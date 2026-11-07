/** An opt-in Android foreground service for existing mesh and internet messaging sessions. */
export interface BackgroundConnectivityPort {
  supported(): boolean;
  requestPermission(): Promise<boolean>;
  start(title: string, body: string, stop: string, mesh: boolean, internet: boolean): Promise<void>;
  running(): Promise<boolean>;
  stop(): Promise<void>;
  onStop(listener: () => void): () => void;
}
