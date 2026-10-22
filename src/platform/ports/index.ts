import type { MentionNotificationsPort } from './mention-notifications';
import type { BackgroundConnectivityPort } from './background-connectivity';
import type { RecordsPort } from './records';
import type { HistoryPort } from './history';
import type { UrlOpenerPort } from './url-opener';
import type { PreferencesPort, LocationPort } from './mobile';
import type { AppStatePort } from './app-state';
import type { DeviceCryptoPort } from './device-crypto';
import type { LocalizationPort } from './localization';
import type { ProximityTransportPort } from './proximity-transport';
import type { SecureStoragePort } from './secure-storage';
export type { PreferencesPort, LocationPort } from './mobile';
export type { AppStatePort, AppStateStatus } from './app-state';
export type { ProximityTransportPort, ProximityTransportSubscription } from './proximity-transport';
export interface PlatformAdapters {
  clipboard: { writeText(text: string): Promise<void> };
  mentionNotifications: MentionNotificationsPort;
  backgroundConnectivity: BackgroundConnectivityPort;
  history: HistoryPort;
  records: RecordsPort;
  wipeLocalData(): Promise<void>;
  confirmationDialog: { confirm(title: string, message: string, cancel: string, confirm: string): Promise<boolean> };
  notices: { readText(id: string): Promise<string> };
  urlOpener: UrlOpenerPort;
  preferences: PreferencesPort; location: LocationPort; appState: AppStatePort;
  deviceCrypto: DeviceCryptoPort; localization: LocalizationPort;
  proximityTransport: ProximityTransportPort; secureStorage: SecureStoragePort;
}
