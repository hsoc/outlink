export interface PreferencesPort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
export interface LocationPort {
  /** Foreground permission is requested only on an explicit user action. */
  currentCoordinates(): Promise<{ latitude: number; longitude: number }>;
}
