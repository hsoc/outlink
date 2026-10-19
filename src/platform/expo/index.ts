import { backgroundConnectivityAdapter } from './background-connectivity';
import { privateStorage } from './private-storage';
import { confirmationDialogAdapter } from './confirmation-dialog';
import { historyAdapter } from './history';
import { urlOpenerAdapter } from './url-opener';
import { noticesAdapter } from './notices';
import type { PlatformAdapters } from '../ports';
import { appStateAdapter } from './app-state';
import { deviceCryptoAdapter } from './device-crypto';
import { localizationAdapter } from './localization';
import { proximityTransportAdapter } from './proximity-transport';
import { secureStorageAdapter } from './secure-storage';
import { preferencesAdapter, locationAdapter } from './mobile';
export function createExpoAdapters(): PlatformAdapters {
  return { backgroundConnectivity: backgroundConnectivityAdapter, records: privateStorage.records, wipeLocalData: privateStorage.wipe, confirmationDialog: confirmationDialogAdapter, history: historyAdapter, notices: noticesAdapter, urlOpener: urlOpenerAdapter, appState: appStateAdapter, deviceCrypto: deviceCryptoAdapter,
    localization: localizationAdapter, proximityTransport: proximityTransportAdapter,
    secureStorage: secureStorageAdapter, preferences: preferencesAdapter, location: locationAdapter };
}
