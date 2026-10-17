import * as SecureStore from 'expo-secure-store';
import type { SecureStoragePort } from '../ports/secure-storage';
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export const secureStorageAdapter: SecureStoragePort = {
  accessStatus: async () => 'available', configurePassword: async () => {}, unlockWithPassword: async () => true,
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
  deleteItem: (key) => SecureStore.deleteItemAsync(key, options),
};
