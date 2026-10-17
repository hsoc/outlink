import { invalidateSessionIntent } from '@/services/history/lifecycle';
import { bitchatService, bitchatSessionStore } from './bitchat.service';
import { platform } from '@/platform';
import { historyOperation } from '@/services/history/history';
import { workspaceStore } from '@/services/history/workspace';
import { geohashService, geohashStore } from '@/services/geohash/geohash.service';
import { contactsStore } from './compatibility/contacts';
import { resetMobileIdentity } from './mobile-identity';
let wiping: Promise<void> | undefined;
export function panicWipe(): Promise<void> {
  return wiping ??= (async () => {
    invalidateSessionIntent();
    await bitchatService.stop(); geohashService.stop();
    bitchatSessionStore.setState({ busy: true });
    workspaceStore.setState({ ready: false, drafts: {}, recipient: undefined, internet: false, mode: 'mesh', hash: '' });
    await historyOperation(async () => {
      await platform.wipeLocalData();
      await resetMobileIdentity();
    });
    bitchatService.resetLocalState(); geohashService.clearMessages();
    geohashStore.setState({ hash: '' }); contactsStore.setState({ contacts: [], ready: false });
    workspaceStore.setState({ ready: true });
  })().catch(error => { bitchatSessionStore.setState({ busy: false, error: true }); throw error; }).finally(() => { wiping = undefined; });
}
