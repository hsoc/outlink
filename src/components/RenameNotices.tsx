import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { dismissRenames, renameNotices } from '@/services/history/rename-notices';
import { spacing } from '@/theme';

export function RenameNotices({ scope, blocked, prefix }: { scope: string; blocked: ReadonlySet<string>; prefix: 'mesh:' | 'nostr:' }) {
  const notices = useStore(renameNotices, state => state.scopes[scope]);
  const { t } = useTranslation();
  const visible = notices?.filter(notice => !blocked.has(prefix + notice.identity.slice(0, prefix === 'mesh:' ? 16 : 64)));
  if (!visible?.length) return null;
  return <View style={{ gap: spacing.xs }}>
    {visible.map(({ id, before, after }) => <AppText key={id} variant="caption" tone="muted" accessibilityLiveRegion="polite">
      {t('mobile.nickname_changed', { before, after })}
    </AppText>)}
    <AppButton size="sm" variant="text" fullWidth={false} label={t('common.dismiss')} onPress={() => dismissRenames(scope)} />
  </View>;
}
