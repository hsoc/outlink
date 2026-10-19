/** @jest-environment node */
import { backgroundConnectivityAdapter } from '../background-connectivity';
import { AppRegistry, DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import '../background-task';
jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 36 },
  PermissionsAndroid: { PERMISSIONS: { POST_NOTIFICATIONS: 'notifications' }, RESULTS: { GRANTED: 'granted' }, request: jest.fn(async () => 'granted') },
  AppRegistry: { registerHeadlessTask: jest.fn() },
  DeviceEventEmitter: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: jest.fn(), requireNativeModule: jest.fn(() => ({ NativeResponse: class {} })) }));
const native = { startBackgroundAsync: jest.fn(async () => {}), backgroundRunningAsync: jest.fn(async () => true),
  stopBackgroundAsync: jest.fn(async () => {}), backgroundTokenAsync: jest.fn(async () => 'task') };
beforeEach(() => {
  Object.assign(Platform, { OS: 'android', Version: 36 });
  jest.mocked(requireOptionalNativeModule).mockReturnValue(native);
  jest.mocked(PermissionsAndroid.request).mockResolvedValue('granted');
});
it('requires explicit Android notification permission and exposes no iOS or old-build support', async () => {
  jest.mocked(PermissionsAndroid.request).mockResolvedValueOnce('denied');
  expect(await backgroundConnectivityAdapter.requestPermission()).toBe(false);
  expect(await backgroundConnectivityAdapter.requestPermission()).toBe(true);
  Object.assign(Platform, { OS: 'ios' });
  expect(backgroundConnectivityAdapter.supported()).toBe(false);
  expect(await backgroundConnectivityAdapter.requestPermission()).toBe(false);
  Object.assign(Platform, { OS: 'android', Version: 30 });
  jest.mocked(PermissionsAndroid.request).mockClear();
  expect(await backgroundConnectivityAdapter.requestPermission()).toBe(true);
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  jest.mocked(requireOptionalNativeModule).mockReturnValue({});
  expect(backgroundConnectivityAdapter.supported()).toBe(false);
});
it('waits for native startup, propagates failure, and forwards neutral notification copy', async () => {
  native.startBackgroundAsync.mockRejectedValueOnce(new Error('Not allowed'));
  await expect(backgroundConnectivityAdapter.start('Outlink', 'Connected', 'Stop')).rejects.toThrow('Not allowed');
  await backgroundConnectivityAdapter.start('Outlink', 'Connected', 'Stop');
  expect(native.startBackgroundAsync).toHaveBeenLastCalledWith('Outlink', 'Connected', 'Stop');
  expect(await backgroundConnectivityAdapter.running()).toBe(true);
  await backgroundConnectivityAdapter.stop(); expect(native.stopBackgroundAsync).toHaveBeenCalled();
});
it('releases the Headless JS task when stopped, including stop-before-subscribe races', async () => {
  const register = jest.mocked(AppRegistry.registerHeadlessTask).mock.calls.find(call => call[0] === 'OutlinkConnectivity')!;
  const task = register[1]();
  native.backgroundTokenAsync.mockResolvedValueOnce('different-task');
  await task({ token: 'task' });
  const remove = jest.fn(); let stopped: ((event: { token: string }) => void) | undefined;
  jest.mocked(DeviceEventEmitter.addListener).mockImplementationOnce((_event, callback) => {
    stopped = callback; return { remove } as unknown as ReturnType<typeof DeviceEventEmitter.addListener>;
  });
  const pending = task({ token: 'task' });
  stopped!({ token: 'unrelated' }); expect(remove).not.toHaveBeenCalled();
  stopped!({ token: 'task' }); await pending;
  expect(remove).toHaveBeenCalledTimes(1);
});
