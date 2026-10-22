import type { SQLiteDatabase } from 'expo-sqlite';
import type { RecordsPort } from '../ports/records';
import type { HistoryPort } from '../ports/history';
import type { PreferencesPort } from '../ports/mobile';
import type { SecureStoragePort } from '../ports/secure-storage';
import { localCipher, newLocalStorageKey } from '@/lib/local-cipher';
const KEY = 'outlink.local-storage.key.v1';
const sensitive = new Set(['mobile.workspace', 'mobile.nickname', 'mobile.nickname.custom-digits']);
type Row = { sequence: number; room: string; id: string; value: string };
/** One database/key owner for history and private preferences, including resumable upgrades. */
export function createEncryptedStorage(
  open: () => Promise<SQLiteDatabase>,
  secrets: Pick<SecureStoragePort, 'getItem' | 'setItem' | 'deleteItem'>,
  legacy: PreferencesPort,
  compactLegacyPreferences?: () => Promise<void>,
) {
  let initialized: Promise<{ db: SQLiteDatabase; cipher: ReturnType<typeof localCipher> }> | undefined;
  async function initialize() {
    const db = await open();
    let cipher: ReturnType<typeof localCipher> | undefined;
    try {
      await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON;
        CREATE TABLE IF NOT EXISTS local_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS encrypted_messages (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL, id TEXT NOT NULL,
          value TEXT NOT NULL, UNIQUE(room, id));
        CREATE INDEX IF NOT EXISTS encrypted_room_sequence ON encrypted_messages(room, sequence);
        CREATE TABLE IF NOT EXISTS private_preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS protected_records (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, id TEXT NOT NULL,
          value TEXT NOT NULL, UNIQUE(scope, id));
        CREATE INDEX IF NOT EXISTS protected_scope_sequence ON protected_records(scope, sequence);`);
      const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(encrypted_messages)');
      if (!columns.some(column => column.name === 'deleted')) await db.execAsync('ALTER TABLE encrypted_messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0');
      await db.execAsync('CREATE INDEX IF NOT EXISTS encrypted_visible_sequence ON encrypted_messages(room, deleted, sequence)');
      const marker = await db.getFirstAsync<{ value: string }>('SELECT value FROM local_meta WHERE name = ?', 'key-check-v1');
      let key = await secrets.getItem(KEY);
      if (!key) {
        const existing = await db.getFirstAsync('SELECT sequence FROM encrypted_messages LIMIT 1');
        const preferences = await db.getFirstAsync('SELECT name FROM private_preferences LIMIT 1');
        if (marker || existing || preferences || await db.getFirstAsync('SELECT sequence FROM protected_records LIMIT 1')) throw new Error('Local storage key is unavailable; encrypted data was preserved');
        key = newLocalStorageKey();
        await secrets.setItem(KEY, key);
      }
      cipher = localCipher(key);
      if (marker) {
        if (cipher.open(marker.value, 'key-check-v1') !== 'outlink-local-storage-v1') throw new Error('Invalid local storage key');
      } else await db.runAsync('INSERT INTO local_meta(name, value) VALUES (?, ?)', 'key-check-v1', cipher.seal('outlink-local-storage-v1', 'key-check-v1'));
      const activeCipher = cipher;
      // Preserve sequence/cursors. Each batch either moves in full or remains in the source table.
      const old = await db.getFirstAsync("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'");
      if (old) {
        while (true) {
          let moved = 0;
          await db.withExclusiveTransactionAsync(async tx => {
            await tx.execAsync('PRAGMA secure_delete = ON');
            const rows = await tx.getAllAsync<Row>('SELECT sequence, room, id, value FROM messages ORDER BY sequence LIMIT 100');
            for (const row of rows) {
              const room = activeCipher.index(`room:${row.room}`), id = activeCipher.index(`id:${row.room}:${row.id}`);
              await tx.runAsync('INSERT INTO encrypted_messages(sequence, room, id, value) VALUES (?, ?, ?, ?)', row.sequence, room, id,
                activeCipher.seal(row.value, `message:${room}:${id}`));
              await tx.runAsync('DELETE FROM messages WHERE sequence = ?', row.sequence);
            }
            moved = rows.length;
          });
          if (!moved) break;
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        await db.runAsync('INSERT OR REPLACE INTO local_meta(name, value) VALUES (?, ?)', 'history-cleanup', 'pending');
        await db.execAsync('DROP TABLE messages');
      }
      if (await db.getFirstAsync('SELECT name FROM local_meta WHERE name = ?', 'history-cleanup')) {
        await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
        await db.runAsync('DELETE FROM local_meta WHERE name = ?', 'history-cleanup');
      }
      for (const name of sensitive) {
        const value = await legacy.getItem(name);
        if (value === null) continue;
        // A completed encrypted write wins over a legacy copy left by an interrupted cleanup.
        const existing = await db.getFirstAsync('SELECT name FROM private_preferences WHERE name = ?', name);
        if (!existing) await db.runAsync('INSERT INTO private_preferences(name, value) VALUES (?, ?)', name, activeCipher.seal(value, `preference:${name}`));
        await db.runAsync('INSERT OR REPLACE INTO local_meta(name, value) VALUES (?, ?)', 'preferences-cleanup', 'pending');
        await legacy.deleteItem(name);
      }
      if (compactLegacyPreferences && await db.getFirstAsync('SELECT name FROM local_meta WHERE name = ?', 'preferences-cleanup')) {
        await compactLegacyPreferences();
        await db.runAsync('DELETE FROM local_meta WHERE name = ?', 'preferences-cleanup');
      }
      return { db, cipher };
    } catch (error) {
      cipher?.destroy(); await db.closeAsync().catch(() => {}); throw error;
    }
  }
  const get = () => initialized ??= initialize().catch(error => { initialized = undefined; throw error; });
  const history: HistoryPort = {
    async get(input, messageId) {
      const { db, cipher } = await get(), room = cipher.index(`room:${input}`), id = cipher.index(`id:${input}:${messageId}`);
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM encrypted_messages WHERE room = ? AND id = ?', room, id);
      return row ? cipher.open(row.value, `message:${room}:${id}`) : null;
    },
    async load(input, before = Number.MAX_SAFE_INTEGER) {
      const { db, cipher } = await get(), room = cipher.index(`room:${input}`);
      const rows = await db.getAllAsync<Row>('SELECT sequence, room, id, value FROM encrypted_messages WHERE room = ? AND deleted = 0 AND sequence < ? ORDER BY sequence DESC LIMIT 200', room, before);
      const messages: { sequence: number; value: string }[] = [];
      for (const [index, row] of rows.reverse().entries()) {
        messages.push({ sequence: row.sequence, value: cipher.open(row.value, `message:${room}:${row.id}`) });
        if (index % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
      }
      return messages;
    },
    async save(input, messageId, value) {
      const { db, cipher } = await get();
      const room = cipher.index(`room:${input}`), id = cipher.index(`id:${input}:${messageId}`);
      await db.runAsync('INSERT INTO encrypted_messages(room, id, value) VALUES (?, ?, ?) ON CONFLICT(room, id) DO UPDATE SET value = excluded.value WHERE encrypted_messages.deleted = 0', room, id, cipher.seal(value, `message:${room}:${id}`));
    },
    async deleteConversation(input, peer, pendingIds = []) {
      const { db, cipher } = await get(), room = cipher.index(`room:${input}`);
      // Erase content while retaining opaque replay markers, with bounded memory and async I/O.
      await db.withExclusiveTransactionAsync(async tx => {
        await tx.execAsync('PRAGMA secure_delete = ON');
        let before = Number.MAX_SAFE_INTEGER;
        while (true) {
          const rows = await tx.getAllAsync<Row>('SELECT sequence, room, id, value FROM encrypted_messages WHERE room = ? AND deleted = 0 AND sequence < ? ORDER BY sequence DESC LIMIT 200', room, before);
          if (!rows.length) break;
          for (const [index, row] of rows.entries()) {
            let message: { recipient?: string; peer?: string; outgoing?: boolean; delivery?: string };
            const plaintext = cipher.open(row.value, `message:${room}:${row.id}`);
            try { message = JSON.parse(plaintext); } catch { continue; }
            if (message?.recipient && (message.outgoing ? message.recipient : message.peer) === peer) {
              const marker = JSON.stringify({ deleted: true, delivery: message.delivery === 'read' ? 'read' : 'delivered' });
              await tx.runAsync('UPDATE encrypted_messages SET value = ?, deleted = 1 WHERE sequence = ?', cipher.seal(marker, `message:${room}:${row.id}`), row.sequence);
            }
            if (index % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
          }
          before = rows[rows.length - 1].sequence;
        }
        for (const messageId of pendingIds) {
          const id = cipher.index(`id:${input}:${messageId}`), value = cipher.seal(JSON.stringify({ deleted: true, delivery: 'delivered' }), `message:${room}:${id}`);
          await tx.runAsync('INSERT INTO encrypted_messages(room, id, value, deleted) VALUES (?, ?, ?, 1) ON CONFLICT(room, id) DO UPDATE SET value = excluded.value, deleted = 1', room, id, value);
        }
      });
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
    },
    async clear() {
      const { db } = await get();
      await db.runAsync('DELETE FROM encrypted_messages');
      await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE)');
    },
  };
  const preferences: PreferencesPort = {
    async getItem(name) {
      if (!sensitive.has(name)) return legacy.getItem(name);
      const { db, cipher } = await get();
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM private_preferences WHERE name = ?', name);
      return row ? cipher.open(row.value, `preference:${name}`) : null;
    },
    async setItem(name, value) {
      if (!sensitive.has(name)) return legacy.setItem(name, value);
      const { db, cipher } = await get();
      await db.runAsync('INSERT INTO private_preferences(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, cipher.seal(value, `preference:${name}`));
    },
    async deleteItem(name) {
      if (!sensitive.has(name)) return legacy.deleteItem(name);
      const { db } = await get();
      await db.runAsync('DELETE FROM private_preferences WHERE name = ?', name);
    },
  };
  const records: RecordsPort = {
    async get(input, recordId) {
      const { db, cipher } = await get(), scope = cipher.index(`scope:${input}`), id = cipher.index(`record-id:${input}:${recordId}`);
      const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM protected_records WHERE scope = ? AND id = ?', scope, id);
      return row ? cipher.open(row.value, `record:${scope}:${id}`) : null;
    },
    async set(input, recordId, value) {
      const { db, cipher } = await get(), scope = cipher.index(`scope:${input}`), id = cipher.index(`record-id:${input}:${recordId}`);
      await db.runAsync('INSERT INTO protected_records(scope, id, value) VALUES (?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET value = excluded.value', scope, id, cipher.seal(value, `record:${scope}:${id}`));
    },
    async remove(input, recordId) {
      const { db, cipher } = await get();
      await db.runAsync('DELETE FROM protected_records WHERE scope = ? AND id = ?', cipher.index(`scope:${input}`), cipher.index(`record-id:${input}:${recordId}`));
    },
    async list(input, before = Number.MAX_SAFE_INTEGER) {
      const { db, cipher } = await get(), scope = cipher.index(`scope:${input}`);
      const rows = await db.getAllAsync<{ sequence: number; id: string; value: string }>('SELECT sequence, id, value FROM protected_records WHERE scope = ? AND sequence < ? ORDER BY sequence DESC LIMIT 200', scope, before);
      const values: { sequence: number; value: string }[] = [];
      for (const [index, row] of rows.entries()) {
        values.push({ sequence: row.sequence, value: cipher.open(row.value, `record:${scope}:${row.id}`) });
        if (index % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
      }
      return values;
    },
    async clear(input) {
      const { db, cipher } = await get();
      if (input === undefined) await db.runAsync('DELETE FROM protected_records');
      else await db.runAsync('DELETE FROM protected_records WHERE scope = ?', cipher.index(`scope:${input}`));
    },
  };
  async function wipe() {
    const { db, cipher } = await get();
    await db.withExclusiveTransactionAsync(async tx => {
      await tx.execAsync('PRAGMA secure_delete = ON; DELETE FROM encrypted_messages; DELETE FROM protected_records; DELETE FROM private_preferences; DELETE FROM local_meta;');
    });
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
    await secrets.deleteItem(KEY);
    cipher.destroy(); await db.closeAsync(); initialized = undefined;
  }
  return { history, preferences, records, wipe };
}
