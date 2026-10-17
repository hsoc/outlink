/** @jest-environment node */
import { platform } from '@/platform';
import { workspaceStore, restoreWorkspace } from '../workspace';
import { historyOperation } from '../history';
jest.mock('@/platform', () => ({ platform: { preferences: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) } } }));
jest.mock('@/services/geohash/geohash.service', () => ({ DEFAULT_GEO_RELAYS: ['wss://example.com'] }));
it('restores independent public, private, and channel drafts with the selected conversation', async () => {
  await restoreWorkspace();
  workspaceStore.setState({ mode: 'geo', hash: 'ezs42', recipient: 'bob', drafts: {
    'mesh:public': 'public draft', 'mesh:bob': 'private draft', 'geo:ezs42': 'channel draft',
  } });
  await historyOperation(async () => {});
  const calls = jest.mocked(platform.preferences.setItem).mock.calls;
  const saved = calls[calls.length - 1][1];
  workspaceStore.setState({ ready: false, mode: 'mesh', hash: '', recipient: undefined, drafts: {} });
  jest.mocked(platform.preferences.getItem).mockResolvedValue(saved);
  await restoreWorkspace();
  expect(workspaceStore.getState()).toMatchObject({ ready: true, mode: 'geo', hash: 'ezs42', recipient: 'bob', drafts: {
    'mesh:public': 'public draft', 'mesh:bob': 'private draft', 'geo:ezs42': 'channel draft',
  } });
});
it('clearing drafts is durable without removing channel preferences', async () => {
  workspaceStore.setState({ drafts: {} }); await historyOperation(async () => {});
  const calls = jest.mocked(platform.preferences.setItem).mock.calls;
  const saved = JSON.parse(calls[calls.length - 1][1]);
  expect(saved.drafts).toEqual({}); expect(saved.hash).toBe('ezs42');
});
