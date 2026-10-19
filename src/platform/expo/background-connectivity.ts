import { requireOptionalNativeModule } from 'expo-modules-core';
import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import type { BackgroundConnectivityPort } from '../ports/background-connectivity';

type BackgroundModule = {
  startBackgroundAsync(title: string, body: string, stop: string): Promise<void>;
  backgroundRunningAsync(): Promise<boolean>;
  stopBackgroundAsync(): Promise<void>;
};
const native = () => Platform.OS === 'android'
  ? requireOptionalNativeModule<BackgroundModule>('ExpoProximity') : null;
export const backgroundConnectivityAdapter: BackgroundConnectivityPort = {
  supported: () => typeof native()?.startBackgroundAsync === 'function',
  async requestPermission() {
    if (!this.supported()) return false;
    if (Number(Platform.Version) < 33) return true;
    return await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
      === PermissionsAndroid.RESULTS.GRANTED;
  },
  async start(title, body, stop) {
    const module = native();
    if (!module?.startBackgroundAsync) throw new Error('Background connectivity requires a new Android build');
    await module.startBackgroundAsync(title, body, stop);
  },
  async running() { return await native()?.backgroundRunningAsync?.() ?? false; },
  async stop() { await native()?.stopBackgroundAsync?.(); },
  onStop(listener) {
    const subscription = DeviceEventEmitter.addListener('OutlinkConnectivityStopped', listener);
    return () => subscription.remove();
  },
};
