import { openDatabaseAsync } from 'expo-sqlite';
import type { HistoryPort } from '../ports/history';
const database = async () => {
  const db = await openDatabaseAsync('outlink-chat-history.db');
  await db.execAsync(`PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, id TEXT NOT NULL,
      value TEXT NOT NULL, UNIQUE(room, id));
    CREATE INDEX IF NOT EXISTS messages_room_sequence ON messages(room, sequence);`);
  return db;
};
let connection: ReturnType<typeof database> | undefined;
const getDatabase = () => connection ??= database().catch(error => { connection = undefined; throw error; });
export const historyAdapter: HistoryPort = {
  async load(room, before = Number.MAX_SAFE_INTEGER) {
    const db = await getDatabase();
    return (await db.getAllAsync<{ sequence: number; value: string }>(
      'SELECT sequence, value FROM messages WHERE room = ? AND sequence < ? ORDER BY sequence DESC LIMIT 200', room, before)).reverse();
  },
  async save(room, id, value) {
    const db = await getDatabase();
    await db.runAsync('INSERT INTO messages(room, id, value) VALUES (?, ?, ?) ON CONFLICT(room, id) DO UPDATE SET value = excluded.value', room, id, value);
  },
  async clear() {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM messages');
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
  },
};
