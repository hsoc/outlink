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
  return { notices: noticesAdapter, urlOpener: urlOpenerAdapter, appState: appStateAdapter, deviceCrypto: deviceCryptoAdapter,
    localization: localizationAdapter, proximityTransport: proximityTransportAdapter,
    secureStorage: secureStorageAdapter, preferences: preferencesAdapter, location: locationAdapter };
}
