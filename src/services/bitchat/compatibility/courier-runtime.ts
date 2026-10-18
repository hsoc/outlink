import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { decodeCourier, encodeCourier, courierTags, type CourierEnvelope } from './courier';
import type { ProtocolStorage } from './prekey-runtime';
export type CourierTier = 'favorite' | 'verified';
type Stored = { id: string; wire: string; depositor: string; tier: CourierTier; at: number; sprayed: string[]; lastRemote?: number; lastPublish?: number };
/** Bounded encrypted mailbag. Link authentication and trust are checked by the caller. */
export class CourierRuntime {
  private pending = Promise.resolve();
  constructor(private readonly storage: ProtocolStorage, private readonly now = Date.now) {}
  private serial<T>(task: () => Promise<T>): Promise<T> { const work = this.pending.catch(() => {}).then(task); this.pending = work.then(() => {}, () => {}); return work; }
  async idle() { await this.pending.catch(() => {}); }
  private async entries(): Promise<Stored[]> {
    const all = await this.storage.list<Stored>('courier', 40), valid: Stored[] = [];
    for (const entry of all) {
      if (decodeCourier(base64.decode(entry.wire)).expiry <= this.now()) await this.storage.remove('courier', entry.id); else valid.push(entry);
    }
    return valid;
  }
  deposit(envelope: CourierEnvelope, depositor: string, tier: CourierTier): Promise<boolean> {
    return this.serial(async () => {
      const now = this.now(); if (envelope.expiry <= now || envelope.expiry > now + 86400000 + 60000) return false;
      const wire = encodeCourier(envelope), id = bytesToHex(sha256(envelope.ciphertext)), all = await this.entries(), existing = all.find(entry => entry.id === id);
      if (existing) {
        const previous = decodeCourier(base64.decode(existing.wire));
        if (bytesToHex(previous.tag) !== bytesToHex(envelope.tag) || previous.prekeyId !== envelope.prekeyId || previous.expiry !== envelope.expiry) return false;
        if (!existing.sprayed.length && envelope.copies > previous.copies) { existing.wire = base64.encode(wire); await this.storage.put('courier', id, existing); }
        return true;
      }
      const own = all.filter(entry => entry.depositor === depositor);
      if (own.length >= (tier === 'favorite' ? 5 : 2)) { const oldest = own.sort((a, b) => a.at - b.at)[0]; await this.storage.remove('courier', oldest.id); all.splice(all.indexOf(oldest), 1); }
      if (tier === 'verified' && all.filter(entry => entry.tier === 'verified').length >= 20 || all.length >= 40) {
        const candidates = all.filter(entry => entry.tier === 'verified').sort((a, b) => a.at - b.at);
        const victim = candidates[0] ?? (tier === 'favorite' ? all.sort((a, b) => a.at - b.at)[0] : undefined);
        if (!victim) return false; await this.storage.remove('courier', victim.id);
      }
      await this.storage.put('courier', id, { id, wire: base64.encode(wire), depositor, tier, at: now, sprayed: [] } satisfies Stored); return true;
    });
  }
  encounter(key: Uint8Array, tier: CourierTier | undefined, direct: boolean, send: (envelope: CourierEnvelope) => Promise<void>): Promise<void> {
    return this.serial(async () => {
      const peer = bytesToHex(key), tags = new Set(courierTags(key, this.now()).map(bytesToHex));
      for (const entry of await this.entries()) {
        const envelope = decodeCourier(base64.decode(entry.wire)), recipient = tags.has(bytesToHex(envelope.tag));
        if (recipient) {
          if (!direct && entry.lastRemote !== undefined && this.now() - entry.lastRemote < 600000) continue;
          try { await send(envelope); } catch { continue; }
          if (direct) await this.storage.remove('courier', entry.id);
          else { entry.lastRemote = this.now(); await this.storage.put('courier', entry.id, entry); }
        } else if (direct && tier && envelope.copies > 1 && entry.depositor !== peer && !entry.sprayed.includes(peer)) {
          const copies = Math.floor(envelope.copies / 2);
          // Reserve budget durably before transmission: a crash may lose a copy, never mint extra copies.
          const reserved = { ...entry, wire: base64.encode(encodeCourier({ ...envelope, copies: envelope.copies - copies })), sprayed: [...entry.sprayed, peer] };
          await this.storage.put('courier', entry.id, reserved);
          try { await send({ ...envelope, copies }); } catch { /* Keep the reservation: acceptance can be ambiguous. */ }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    });
  }
  publishHeld(send: (envelope: CourierEnvelope) => Promise<void>): Promise<void> {
    return this.serial(async () => {
      for (const entry of await this.entries()) {
        if (entry.lastPublish !== undefined && this.now() - entry.lastPublish < 1800000) continue;
        await send(decodeCourier(base64.decode(entry.wire)));
        entry.lastPublish = this.now(); await this.storage.put('courier', entry.id, entry);
      }
    });
  }
}
