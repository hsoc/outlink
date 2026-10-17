import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
export const putRecord = (scope: string, id: string, value: unknown) => historyOperation(() => platform.records.set(scope, id, JSON.stringify(value)));
export const removeRecord = (scope: string, id: string) => historyOperation(() => platform.records.remove(scope, id));
export async function readRecord<T>(scope: string, id: string): Promise<T | null> {
  const value = await historyOperation(() => platform.records.get(scope, id));
  return value === null ? null : JSON.parse(value) as T;
}
export async function readRecords<T>(scope: string, maximum: number): Promise<T[]> {
  const values: T[] = []; let before: number | undefined;
  while (true) {
    const rows = await historyOperation(() => platform.records.list(scope, before));
    if (!rows.length) return values;
    if (rows.length + values.length > maximum) throw new Error('Protocol record quota exceeded');
    values.push(...rows.map(row => JSON.parse(row.value) as T));
    before = rows[rows.length - 1].sequence;
    if (rows.length < 200) return values;
  }
}
