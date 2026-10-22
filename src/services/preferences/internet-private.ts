import { bitchatService } from '@/services/bitchat/bitchat.service';
import { geohashService } from '@/services/geohash/geohash.service';
import { workspaceStore } from '@/services/history/workspace';
import { sessionIntent } from '@/services/history/lifecycle';
let pending: Promise<void> = Promise.resolve();
/** Explicit user opt-in shared by Settings and the location private composer. */
export function configurePrivateInternet(enabled: boolean): Promise<void> {
  const epoch = sessionIntent();
  const work = pending.catch(() => {}).then(async () => {
    if (epoch !== sessionIntent()) throw new Error('Private messaging setup canceled by identity erasure');
    const before = workspaceStore.getState();
    try {
      await bitchatService.enableInternet(enabled, before.relays.split(/\s+/).filter(Boolean));
      if (epoch !== sessionIntent()) throw new Error('Private messaging setup canceled by identity erasure');
      await geohashService.enableInternet(enabled);
      if (epoch !== sessionIntent()) throw new Error('Private messaging setup canceled by identity erasure');
      workspaceStore.setState({ internet: enabled });
    } catch (error) {
      if (epoch === sessionIntent()) await Promise.allSettled([
        bitchatService.enableInternet(before.internet, before.relays.split(/\s+/).filter(Boolean)),
        geohashService.enableInternet(before.internet),
      ]);
      throw error;
    }
  });
  pending = work; return work;
}
