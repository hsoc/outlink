import { createStore } from 'zustand/vanilla';
import { sessionIntent } from '@/services/history/lifecycle';
import { putRecord, readRecord, readRecords } from '@/services/bitchat/compatibility/storage';
import { digest, inspectToken, parsePart, tokenParts } from './token';
export type Transfer = { id: string; peer: string; outgoing: boolean; at: number; total: number; parts: Record<string, string>; wire?: string; mint?: string; amount?: string; claims?: string[] };
export type TransferSummary = Omit<Transfer, 'wire' | 'parts' | 'claims'> & { complete: boolean; received: number };
export const cashuStore = createStore<{ transfers: TransferSummary[] }>(() => ({ transfers: [] }));
const scope = 'cashu-transfers';
const summary = ({ wire, parts, claims: _claims, ...record }: Transfer): TransferSummary => ({ ...record, complete: !!wire, received: Object.keys(parts).length });
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(task: (guard: () => void) => Promise<T>): Promise<T> {
  const epoch = sessionIntent(), guard = () => { if (epoch !== sessionIntent()) throw new Error('Cashu operation canceled by erasure'); };
  const work = pending.catch(() => {}).then(async () => { guard(); return task(guard); });
  pending = work; return work;
}
const key = (peer: string, id: string, outgoing: boolean) => digest(`${peer}:${id}:${outgoing}`);
function publish(record: Transfer) {
  const item = summary(record);
  cashuStore.setState(state => ({ transfers: [item, ...state.transfers.filter(row => row.id !== item.id || row.peer !== item.peer || row.outgoing !== item.outgoing)].sort((a, b) => b.at - a.at) }));
}
async function save(record: Transfer, guard: () => void) {
  guard(); await putRecord(scope, key(record.peer, record.id, record.outgoing), record); guard(); publish(record);
}
export const cashuTransfers = {
  restore() { return serial(async guard => { const rows = await readRecords<Transfer>(scope, 128); guard(); cashuStore.setState({ transfers: rows.map(summary).sort((a, b) => b.at - a.at) }); }); },
  prepare(peer: string, input: string) {
    return serial(async guard => {
      if (!/^[0-9a-f]{16}$/.test(peer)) throw new Error('Invalid recipient');
      const token = inspectToken(input), rows = await readRecords<Transfer>(scope, 128); guard();
      const existing = rows.find(row => row.outgoing && row.id === token.id && row.peer === peer);
      if (existing) return summary(existing);
      if (rows.length >= 128 || rows.some(row => row.outgoing && row.claims?.some(claim => token.claims.includes(claim)))) throw new Error('Token already assigned or transfer storage full');
      const record: Transfer = { ...token, peer, outgoing: true, at: Date.now(), total: tokenParts(token.wire).length, parts: {} };
      await save(record, guard); return summary(record);
    });
  },
  receive(peer: string, content: string) {
    return serial(async guard => {
      if (!/^[0-9a-f]{16}$/.test(peer)) throw new Error('Invalid sender');
      const part = parsePart(content), recordKey = key(peer, part.id, false);
      let record = await readRecord<Transfer>(scope, recordKey); guard();
      if (!record) {
        if ((await readRecords<Transfer>(scope, 128)).length >= 128) throw new Error('Transfer storage full');
        record = { id: part.id, peer, outgoing: false, at: Date.now(), total: part.total, parts: {} };
      }
      if (record.total !== part.total || record.parts[part.index] && record.parts[part.index] !== part.data) throw new Error('Conflicting transfer part');
      if (record.wire) return;
      record.parts[part.index] = part.data;
      if (Object.keys(record.parts).length === record.total) {
        const wire = Array.from({ length: record.total }, (_, index) => record!.parts[index]).join('');
        const token = inspectToken(wire);
        if (token.id !== record.id) throw new Error('Transfer digest mismatch');
        Object.assign(record, token);
      }
      await save(record, guard);
    });
  },
  async token(item: Pick<Transfer, 'id' | 'peer' | 'outgoing'>): Promise<string> {
    return serial(async guard => {
      const row = await readRecord<Transfer>(scope, key(item.peer, item.id, item.outgoing)); guard();
      if (!row?.wire) throw new Error('Incomplete transfer');
      inspectToken(row.wire); return row.wire;
    });
  },
  async idle() { await pending.catch(() => {}); },
  reset() { cashuStore.setState({ transfers: [] }); },
};
