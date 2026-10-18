import { randomBytes, bytesToHex } from '@noble/hashes/utils.js';
import { platform } from '@/platform';
let loading: Promise<string> | undefined;
export function mobileIdentity(): Promise<string> {
  return loading ??= (async () => {
    const key = 'outlink.mobile.identity';
    const saved = await platform.secureStorage.getItem(key);
    if (saved && /^[0-9a-f]{64}$/.test(saved)) return saved;
    if (saved) throw new Error('Invalid saved identity');
    const id = bytesToHex(randomBytes(32));
    await platform.secureStorage.setItem(key, id);
    return id;
  })().catch((error) => { loading = undefined; throw error; });
}

export async function resetMobileIdentity(): Promise<void> {
  await loading?.catch(() => {});
  const saved = await platform.secureStorage.getItem('outlink.mobile.identity');
  if (saved && /^[0-9a-f]{64}$/.test(saved)) { await platform.secureStorage.deleteItem(`bitchat.identity.${saved}`); await platform.secureStorage.deleteItem(`outlink.prekeys.${saved}`); }
  await platform.secureStorage.deleteItem('outlink.mobile.identity'); loading = undefined;
}
