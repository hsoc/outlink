export interface HistoryPort {
  get(room: string, id: string): Promise<string | null>;
  load(room: string, before?: number): Promise<{ sequence: number; value: string }[]>;
  save(room: string, id: string, value: string): Promise<void>;
  clear(): Promise<void>;
}
