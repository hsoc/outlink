/** @jest-environment node */
import { configurePrivateInternet } from '../internet-private';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { geohashService } from '@/services/geohash/geohash.service';
import { workspaceStore } from '@/services/history/workspace';
import { invalidateSessionIntent } from '@/services/history/lifecycle';
jest.mock('@/services/bitchat/bitchat.service', () => ({ bitchatService: { enableInternet: jest.fn(async () => {}) } }));
jest.mock('@/services/geohash/geohash.service', () => ({ geohashService: { enableInternet: jest.fn(async () => {}) } }));
jest.mock('@/services/history/workspace', () => ({ workspaceStore: jest.requireActual('zustand/vanilla').createStore(() => ({ internet: false, relays: 'wss://one.example' })) }));
beforeEach(() => { jest.clearAllMocks(); workspaceStore.setState({ internet: false }); });
it('records explicit opt-in only after both private messaging services are configured', async () => {
  await configurePrivateInternet(true);
  expect(bitchatService.enableInternet).toHaveBeenCalledWith(true, ['wss://one.example']);
  expect(geohashService.enableInternet).toHaveBeenCalledWith(true); expect(workspaceStore.getState().internet).toBe(true);
});
it('rolls both transports back if one fails without claiming that messaging is enabled', async () => {
  jest.mocked(geohashService.enableInternet).mockRejectedValueOnce(new Error('setup failed'));
  await expect(configurePrivateInternet(true)).rejects.toThrow('setup failed');
  expect(bitchatService.enableInternet).toHaveBeenLastCalledWith(false, ['wss://one.example']);
  expect(geohashService.enableInternet).toHaveBeenLastCalledWith(false); expect(workspaceStore.getState().internet).toBe(false);
});
it('serializes changes so the last requested setting wins', async () => {
  await Promise.all([configurePrivateInternet(true), configurePrivateInternet(false)]);
  expect(workspaceStore.getState().internet).toBe(false); expect(geohashService.enableInternet).toHaveBeenLastCalledWith(false);
});
it('does not re-enable private messaging if a wipe overtakes setup', async () => {
  let release!: () => void;
  jest.mocked(bitchatService.enableInternet).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const configuring = configurePrivateInternet(true), rejected = expect(configuring).rejects.toThrow('erasure');
  while (!release) await Promise.resolve();
  invalidateSessionIntent(); release(); await rejected;
  expect(geohashService.enableInternet).not.toHaveBeenCalled(); expect(workspaceStore.getState().internet).toBe(false);
});
