export interface HistoryPort {
  get(room: string, id: string): Promise<string | null>;
  load(room: string, before?: number): Promise<{ sequence: number; value: string }[]>;
  save(room: string, id: string, value: string): Promise<void>;
  retainSenderLabel?(room: string, id: string, label: string): Promise<void>;
  loadMeshThread?(peer: string, before?: number): Promise<{ sequence: number; value: string }[]>;
  meshUnread?(): Promise<{ count: number; value: string }[]>;
  acceptCourier(sender: string, messageId: string, id: string, value: string): Promise<'new' | 'duplicate' | 'rejected'>;
  deleteConversation(room: string, peer: string, pendingIds?: string[]): Promise<void>;
  prune(): Promise<void>;
  clear(): Promise<void>;
}
