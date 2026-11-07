import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { geohashStore } from '@/services/geohash/geohash.service';
import { spacing } from '@/theme';

export function ConversationErrorNotice({ mode, actionError, onDismissAction }: {
  mode: 'mesh' | 'geo';
  actionError: 'join' | 'send' | 'other' | null;
  onDismissAction(): void;
}) {
  const { t } = useTranslation();
  const meshError = useStore(bitchatSessionStore, state => state.error);
  const geoError = useStore(geohashStore, state => state.error);
  if (!actionError && !(mode === 'mesh' ? meshError : geoError)) return null;
  const message = actionError === 'send' ? 'mobile.send_failed' : actionError === 'join'
    ? mode === 'mesh' ? 'mobile.mesh_join_failed' : 'mobile.geo_join_failed' : 'mobile.operation_failed';
  const dismiss = () => {
    onDismissAction();
    if (mode === 'mesh') bitchatSessionStore.setState({ error: false });
    else geohashStore.setState({ error: false });
  };
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
    <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite" style={{ flex: 1 }}>{t(message)}</AppText>
    <AppButton size="sm" variant="text" fullWidth={false} label={t('common.dismiss')} onPress={dismiss} />
  </View>;
}
