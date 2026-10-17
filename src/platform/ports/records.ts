/** Encrypted protocol state, separate from user-clearable conversation history. */
export interface RecordsPort {
  get(scope: string, id: string): Promise<string | null>;
  set(scope: string, id: string, value: string): Promise<void>;
  remove(scope: string, id: string): Promise<void>;
  list(scope: string, before?: number): Promise<{ sequence: number; value: string }[]>;
  clear(scope?: string): Promise<void>;
}
