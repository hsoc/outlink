import { useState } from 'react';
import { View } from 'react-native';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { spacing } from '@/theme';
import { workspaceStore } from '@/services/history/workspace';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { validHash } from '@/services/bitchat/compatibility/network-protocol';
import { geohashService } from '@/services/geohash/geohash.service';
import { normalizeGeoRelays } from '@/services/geohash/geohash-protocol';
export function NetworkSettings({ disabled, onBusyChange }: { disabled: boolean; onBusyChange(busy: boolean): void }) {
  const { t } = useTranslation(), workspace = useStore(workspaceStore);
  const [cell, setCell] = useState<string>(), [hash, setHash] = useState<string>(), [relays, setRelays] = useState<string>();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function apply(change: { gateway?: boolean; bridge?: boolean; autoAreaRelays?: boolean } = {}) {
    if (busy) return;
    setBusy(true); onBusyChange(true); setFailed(false);
    const before = workspaceStore.getState();
    try {
      const next = { autoAreaRelays: change.autoAreaRelays ?? before.autoAreaRelays, gateway: change.gateway ?? before.gateway, bridge: change.bridge ?? before.bridge, bridgeCell: (cell ?? before.bridgeCell).trim().toLowerCase(), hash: (hash ?? before.hash).trim().toLowerCase().replace(/^#/, ''), relays: normalizeGeoRelays((relays ?? before.relays).split(/\s+/).filter(Boolean)).join('\n') };
      if (next.bridge && (!validHash(next.bridgeCell) || next.bridgeCell.length !== 6) || next.hash && !validHash(next.hash)) throw new Error('Invalid area code');
      workspaceStore.setState(next); await geohashService.configureRelays(next.autoAreaRelays, next.relays.split(/\s+/).filter(Boolean)); await bitchatService.refreshNetwork(); setCell(undefined); setHash(undefined); setRelays(undefined);
    } catch {
      workspaceStore.setState({ autoAreaRelays: before.autoAreaRelays, gateway: before.gateway, bridge: before.bridge, bridgeCell: before.bridgeCell, hash: before.hash, relays: before.relays });
      await geohashService.configureRelays(before.autoAreaRelays, before.relays.split(/\s+/).filter(Boolean)).catch(() => {});
      await bitchatService.refreshNetwork().catch(() => {}); setFailed(true);
    } finally { setBusy(false); onBusyChange(false); }
  }
  return <View style={{ gap: spacing.md }}>
    <AppText variant="subtitle">{t('mobile.network_reach')}</AppText>
    <AppText tone="muted">{t('mobile.courier_hint')}</AppText>
    <AppInput label={t('mobile.gateway_area')} value={hash ?? workspace.hash} onChangeText={setHash} maxLength={12} autoCapitalize="none" autoCorrect={false} editable={!disabled && !busy} />
    <AppInput label={t('mobile.bridge_area')} description={t('mobile.bridge_area_hint')} value={cell ?? workspace.bridgeCell} onChangeText={setCell} maxLength={6} autoCapitalize="none" autoCorrect={false} editable={!disabled && !busy} />
    <AppButton label={t('mobile.automatic_area_relays')} variant="secondary" selected={workspace.autoAreaRelays} disabled={disabled || busy || !workspace.ready} onPress={() => void apply({ autoAreaRelays: !workspace.autoAreaRelays })} />
    <AppText variant="caption" tone="muted">{t('mobile.automatic_area_hint')}</AppText>
    <AppInput label={t('mobile.relays')} value={relays ?? workspace.relays} onChangeText={setRelays} maxLength={1536} multiline autoCapitalize="none" autoCorrect={false} editable={!disabled && !busy} />
    <AppButton label={t('mobile.apply_network')} variant="secondary" disabled={disabled || busy || !workspace.ready} onPress={() => void apply()} />
    <AppText variant="subtitle">{t('mobile.gateway')}</AppText>
    <AppText tone="muted">{t('mobile.gateway_hint')}</AppText>
    <AppButton label={t(workspace.gateway ? 'mobile.disable' : 'mobile.enable')} variant="secondary" disabled={disabled || busy || !workspace.ready} onPress={() => void apply({ gateway: !workspace.gateway })} />
    <AppText variant="subtitle">{t('mobile.bridge')}</AppText>
    <AppText tone="muted">{t('mobile.bridge_hint')}</AppText>
    <AppButton label={t(workspace.bridge ? 'mobile.disable' : 'mobile.enable')} variant="secondary" disabled={disabled || busy || !workspace.ready} onPress={() => void apply({ bridge: !workspace.bridge })} />
    <AppText variant="caption" tone="muted">{t('mobile.network_privacy')}</AppText>
    {failed && <AppText tone="danger" accessibilityLiveRegion="polite">{t('mobile.network_failed')}</AppText>}
  </View>;
}
