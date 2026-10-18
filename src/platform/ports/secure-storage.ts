/** Device keychain/keystore storage for identity, channel and encryption keys.
 * Non-secret preferences use the asynchronous preferences port.
 */
export interface SecureStoragePort {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}
