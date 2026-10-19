import { requireOptionalNativeModule } from 'expo-modules-core';
import { AppRegistry, DeviceEventEmitter } from 'react-native';

// An active Headless JS task keeps React Native timers available without a screen.
// Native starts it only in the existing app runtime, never to rejoin after a kill.
AppRegistry.registerHeadlessTask('OutlinkConnectivity', () => async ({ token }: { token: string }) => {
  await new Promise<void>(resolve => {
    const done = () => { subscription.remove(); resolve(); };
    const subscription = DeviceEventEmitter.addListener('OutlinkConnectivityTaskStopped', (event: { token: string }) => {
      if (event.token === token) done();
    });
    const native = requireOptionalNativeModule<{ backgroundTokenAsync(): Promise<string | null> }>('ExpoProximity');
    void native?.backgroundTokenAsync().then(current => { if (current !== token) done(); }).catch(done);
    if (!native) done();
  });
});
