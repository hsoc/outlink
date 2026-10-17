import { openDatabaseAsync } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { createEncryptedStorage } from './encrypted-storage';
import { secureStorageAdapter } from './secure-storage';
export const privateStorage = createEncryptedStorage(
  () => openDatabaseAsync('outlink-chat-history.db'), secureStorageAdapter,
  { getItem: key => Storage.getItem(key), setItem: (key, value) => Storage.setItem(key, value), deleteItem: key => Storage.removeItem(key) },
  async () => {
    // The installed Expo SQLiteStorage implementation uses this database name.
    const db = await openDatabaseAsync('ExpoSQLiteStorage');
    try { await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); }
    finally { await db.closeAsync(); }
  },
);
