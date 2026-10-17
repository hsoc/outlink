import { useState } from 'react';
import { clearHistory } from '@/services/history/history';
import { workspaceStore } from '@/services/history/workspace';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { geohashService } from '@/services/geohash/geohash.service';
import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { platform } from '@/platform';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useThemeStore } from '@/stores/theme.store';
import { spacing, ACCENT_KEYS } from '@/theme';
export default function Settings() {
  const [clearing, setClearing] = useState(false), [failed, setFailed] = useState(false);
  const { t } = useTranslation(), top = useScreenHeaderClearance();
  const preference = useThemeStore(s => s.preference), accent = useThemeStore(s => s.accent);
  return <AppScreen edges={['bottom']}><ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: top, gap: spacing.lg }}>
    <AppText variant="subtitle">{t('mobile.appearance')}</AppText>
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>{(['system','light','dark'] as const).map(value => <AppButton key={value}
      label={t(`mobile.${value}`)} variant="secondary" fullWidth={false} selected={preference === value} onPress={() => useThemeStore.getState().setPreference(value)} />)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{ACCENT_KEYS.map(value => <AppButton key={value} label={t(`appearance.colors.${value}`)} variant="secondary"
      fullWidth={false} selected={accent === value} onPress={() => useThemeStore.getState().setAccent(value)} />)}</View>
    <AppText tone="muted">{t('mobile.storage_note')}</AppText>
    <AppButton label={t('mobile.clear_history')} variant="secondary" disabled={clearing} onPress={() => void (async () => {
      if (!await platform.confirmationDialog.confirm(t('mobile.clear_history'), t('mobile.clear_confirm'), t('mobile.cancel'), t('mobile.clear_history'))) return;
      setClearing(true); setFailed(false);
      bitchatService.clearMessages(); geohashService.clearMessages();
      workspaceStore.setState({ drafts: {} });
      try { await clearHistory(); } catch { setFailed(true); } finally { setClearing(false); }
    })()} />
    {failed && <AppText tone="danger">{t('mobile.failed')}</AppText>}
    <AppButton label={t('mobile.source')} variant="text" onPress={() => void platform.urlOpener.openExternalUrl('https://github.com/hsoc/outlink')} />
    <AppButton label={t('mobile.licenses')} variant="text" onPress={() => router.push('/licenses')} />
  </ScrollView><ScreenHeader title={t('mobile.settings')} /></AppScreen>;
}
