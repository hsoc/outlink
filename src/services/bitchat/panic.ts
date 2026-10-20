import { mentionService } from '@/services/mentions/mentions';
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
    workspaceStore.setState({ keepBackground: false, backgroundError: false });
    // Native notification/service cleanup must not prevent transport shutdown and key deletion.
    await platform.backgroundConnectivity?.stop().catch(() => {});
    await bitchatService.stop(); geohashService.stop(); await geohashService.idle();
    bitchatSessionStore.setState({ busy: true });
    workspaceStore.setState({ ready: false, keepBackground: false, backgroundError: false, drafts: {}, recipient: undefined, internet: false, autoAreaRelays: true, gateway: false, bridge: false, bridgeCell: '', nearbyOnly: false, mode: 'mesh', hash: '' });
    await mentionService.clear().catch(() => {});
    await historyOperation(async () => {
      await platform.wipeLocalData();
      await resetMobileIdentity();
    });
    bitchatService.resetLocalState(); geohashService.clearMessages();
    geohashStore.setState({ hash: '' }); contactsStore.setState({ contacts: [], ready: false });
    workspaceStore.setState({ ready: true });
  })().catch(error => { bitchatSessionStore.setState({ busy: false, error: true }); throw error; }).finally(() => { wiping = undefined; });
}
