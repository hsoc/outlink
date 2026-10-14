import * as SecureStore from 'expo-secure-store';

import type { SecureStoragePort } from '../ports/secure-storage';
import { loadLocalNotifications } from './local-notifications';

function sharedOptions(key: string): SecureStore.SecureStoreOptions | undefined {
  if (!/^(identity_privkey_|encryption_keys_|nip46_client_privkey_|nip46_bunker_secret_)/.test(key)) return;
  const accessGroup = loadLocalNotifications()?.sharedKeychainGroup;
  return accessGroup ? {
    accessGroup,
    keychainService: 'outlink.notifications',
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  } : undefined;
}

/** Only messaging credentials are shared with the notification extension. */
export const secureStorageAdapter: SecureStoragePort = {
  accessStatus: () => Promise.resolve('available'),
  configurePassword: () => Promise.resolve(),
  unlockWithPassword: () => Promise.resolve(true),
  async getItem(key) {
    const options = sharedOptions(key);
    const value = await SecureStore.getItemAsync(key, options);
    if (value !== null || !options) return value;
    const legacy = await SecureStore.getItemAsync(key);
    if (legacy === null) return null;
    // Copy successfully before deleting; interrupted upgrades remain readable.
    await SecureStore.setItemAsync(key, legacy, options);
    await SecureStore.deleteItemAsync(key);
    return legacy;
  },
  setItem: (key, value) => SecureStore.setItemAsync(key, value, sharedOptions(key)),
  async deleteItem(key) {
    const options = sharedOptions(key);
    await SecureStore.deleteItemAsync(key, options);
    if (options) await SecureStore.deleteItemAsync(key);
  },
};
