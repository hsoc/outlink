import { createStore } from 'zustand/vanilla';
import { platform } from '@/platform';
import { historyOperation } from './history';
import { DEFAULT_GEO_RELAYS } from '@/services/geohash/geohash.service';
type Workspace = { keepBackground: boolean; backgroundError: boolean; autoAreaRelays: boolean; gateway: boolean; bridge: boolean; bridgeCell: string; nearbyOnly: boolean; internet: boolean; mode: 'mesh' | 'geo'; hash: string; precision: number; relays: string; recipient?: string;
  drafts: Record<string, string>; ready: boolean; error: boolean };
export const workspaceStore = createStore<Workspace>(() => ({ keepBackground: false, backgroundError: false, autoAreaRelays: true, gateway: false, bridge: false, bridgeCell: '', nearbyOnly: false, internet: false, mode: 'mesh', hash: '', precision: 5,
  relays: DEFAULT_GEO_RELAYS.join('\n'), drafts: {}, ready: false, error: false }));
export async function restoreWorkspace() {
  const saved = await platform.preferences.getItem('mobile.workspace');
  if (saved) workspaceStore.setState(JSON.parse(saved));
  workspaceStore.setState({ ready: true });
}
workspaceStore.subscribe((state, previous) => {
  if (!state.ready || state === previous || state.error !== previous.error) return;
  const value = JSON.stringify({ ...state, ready: false, error: false, backgroundError: false });
  void historyOperation(() => platform.preferences.setItem('mobile.workspace', value))
    .catch(() => workspaceStore.setState({ error: true }));
});
