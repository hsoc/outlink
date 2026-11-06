export interface LiveVoicePort {
  available(): boolean;
  startCapture(token: number): Promise<void>;
  stopCapture(): Promise<void>;
  subscribe(listener: (token: number, frame: Uint8Array) => void): () => void;
  play(frame: Uint8Array): Promise<void>;
  stopPlayback(): Promise<void>;
}
