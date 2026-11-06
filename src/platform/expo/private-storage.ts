import { clearMeshMediaCache } from './mesh-media-cache';
import { openDatabaseAsync } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { createEncryptedStorage } from './encrypted-storage';
import { secureStorageAdapter } from './secure-storage';
const encryptedStorage = createEncryptedStorage(
  () => openDatabaseAsync('outlink-chat-history.db'), secureStorageAdapter,
  { getItem: key => Storage.getItem(key), setItem: (key, value) => Storage.setItem(key, value), deleteItem: key => Storage.removeItem(key) },
  async () => {
    // The installed Expo SQLiteStorage implementation uses this database name.
    const db = await openDatabaseAsync('ExpoSQLiteStorage');
    try { await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); }
    finally { await db.closeAsync(); }
  },
);

export const privateStorage = {
  ...encryptedStorage,
  async wipe() {
    clearMeshMediaCache();
    await Storage.clear();
    await encryptedStorage.wipe();
  },
};
