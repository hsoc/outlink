export interface HistoryPort {
  load(room: string, before?: number): Promise<{ sequence: number; value: string }[]>;
  save(room: string, id: string, value: string): Promise<void>;
  clear(): Promise<void>;
}
