import type { BitchatMessage } from '../bitchat-session';
export type CourierDispatch = { wire: string; deposited: string[]; dropAccepted?: boolean };
export type DeliveryResult = { delivery: 'sent' | 'carried'; courier?: CourierDispatch };
export type PendingMessage = { courier?: CourierDispatch; message: BitchatMessage; attempts: number; lastAttempt: number; expiresAt: number };
export interface OutboxStorage {
  list(peer: string): Promise<PendingMessage[]>;
  put(peer: string, id: string, entry: PendingMessage): Promise<void>;
  get(peer: string, id: string): Promise<PendingMessage | null>;
  remove(peer: string, id: string): Promise<void>;
}
/** Storage commits precede transmission; only authenticated delivery/read acknowledgments clear mail. */
export class MessageOutbox {
  private generation = 0;
  private readonly peerGenerations = new Map<string, number>();
  private readonly mutations = new Map<string, Promise<unknown>>();
  private mutate<T>(peer: string, task: () => Promise<T>): Promise<T> {
    const operation = (this.mutations.get(peer) ?? Promise.resolve()).catch(() => {}).then(task);
    this.mutations.set(peer, operation);
    void operation.finally(() => { if (this.mutations.get(peer) === operation) this.mutations.delete(peer); }).catch(() => {});
    return operation;
  }
  cancelFlushes() { ++this.generation; }
  async discard(peer: string): Promise<BitchatMessage[]> {
    this.peerGenerations.set(peer, (this.peerGenerations.get(peer) ?? 0) + 1);
    return this.mutate(peer, async () => {
      const entries = await this.storage.list(peer);
      for (const entry of entries) await this.storage.remove(peer, entry.message.id);
      return entries.map(entry => entry.message);
    });
  }
  async idle() { await Promise.allSettled([...this.flushing.values(), ...this.mutations.values()]); }
  private readonly flushing = new Map<string, Promise<void>>();
  constructor(private readonly storage: OutboxStorage,
    private readonly changed: (message: BitchatMessage) => void,
    private readonly now = Date.now) {}
  async enqueue(peer: string, message: BitchatMessage): Promise<void> {
    if (!message.recipient || (message.channelThread ?? message.recipient) !== peer || !message.outgoing) throw new Error('Outbox recipient mismatch');
    await this.mutate(peer, async () => {
    const existing = await this.storage.get(peer, message.id);
    if (existing) {
      if (existing.message.content !== message.content || existing.message.peer !== message.peer || existing.message.recipient !== message.recipient) throw new Error('Outbox message ID reused');
      return;
    }
    const pending = (await this.storage.list(peer)).sort((a, b) => a.message.timestamp - b.message.timestamp);
    while (pending.length >= 100) await this.drop(peer, pending.shift()!);
    const entry: PendingMessage = { message: { ...message, delivery: 'queued' }, attempts: 0, lastAttempt: 0, expiresAt: this.now() + 86400000 };
    await this.storage.put(peer, message.id, entry); this.changed(entry.message);
    });
  }
  private async drop(peer: string, entry: PendingMessage) {
    await this.storage.remove(peer, entry.message.id);
    this.changed({ ...entry.message, delivery: 'failed' });
  }
  flush(peer: string, deliver: (entry: PendingMessage) => Promise<void | DeliveryResult>, available: (entry: PendingMessage) => boolean = () => true): Promise<void> {
    const existing = this.flushing.get(peer); if (existing) return existing;
    const work = this.flushInternal(peer, deliver, available).finally(() => this.flushing.delete(peer));
    this.flushing.set(peer, work); return work;
  }
  private async flushInternal(peer: string, deliver: (entry: PendingMessage) => Promise<void | DeliveryResult>, available: (entry: PendingMessage) => boolean) {
    const generation = this.generation, peerGeneration = this.peerGenerations.get(peer) ?? 0;
    const pending = await this.storage.list(peer);
    for (const entry of pending.sort((a, b) => a.message.timestamp - b.message.timestamp)) {
      if (generation !== this.generation || peerGeneration !== (this.peerGenerations.get(peer) ?? 0)) break;
      if (entry.expiresAt <= this.now() || entry.attempts >= 8) { await this.mutate(peer, async () => { if (await this.storage.get(peer, entry.message.id)) await this.drop(peer, entry); }); continue; }
      if (!available(entry)) continue;
      if (entry.lastAttempt && this.now() - entry.lastAttempt < 30000) continue;
      const next = await this.mutate(peer, async () => {
        const current = await this.storage.get(peer, entry.message.id);
        if (!current || generation !== this.generation || peerGeneration !== (this.peerGenerations.get(peer) ?? 0)) return;
        const updated = { ...current, attempts: current.attempts + 1, lastAttempt: this.now() };
        await this.storage.put(peer, entry.message.id, updated); return updated;
      });
      if (!next || generation !== this.generation || peerGeneration !== (this.peerGenerations.get(peer) ?? 0)) continue;
      try {
        const result = await deliver(next);
        await this.mutate(peer, async () => {
          const current = await this.storage.get(peer, entry.message.id); if (!current) return;
          const message = { ...entry.message, delivery: result?.delivery ?? 'sent' as const };
          await this.storage.put(peer, entry.message.id, { ...current, courier: result?.courier ?? current.courier, message }); this.changed(message);
        });
      } catch {
        await this.mutate(peer, async () => { if (await this.storage.get(peer, entry.message.id)) this.changed({ ...entry.message, delivery: 'queued' }); });
      }
    }
  }
  async acknowledge(peer: string, id: string, delivery: 'delivered' | 'read', authenticatedRecipient = peer): Promise<void> {
    await this.mutate(peer, async () => {
    const entry = await this.storage.get(peer, id); if (!entry) return;
    if ((entry.message.channelThread ?? entry.message.recipient) !== peer || entry.message.recipient !== authenticatedRecipient) throw new Error('Outbox receipt identity mismatch');
    await this.storage.remove(peer, id); this.changed({ ...entry.message, delivery });
    });
  }
}
