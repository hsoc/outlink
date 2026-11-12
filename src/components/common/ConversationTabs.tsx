import type { ReactElement } from 'react';
import { FlatList, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { DmShortcut } from '@/lib/dm-shortcuts';
import { spacing, uiDensity } from '@/theme';
import { AppButton } from './AppButton';
import { AppText } from './AppText';

/** Both transports use the same public/DM selector and unread presentation. */
export function ConversationTabs({ header, threads, selected, onSelect }: {
  header: ReactElement; threads: DmShortcut[]; selected?: string; onSelect(peer: string): void;
}) {
  const { t } = useTranslation();
  return <FlatList horizontal data={threads} keyExtractor={thread => thread.peer} style={{ flexGrow: 0 }}
    keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }} ListHeaderComponent={header}
    renderItem={({ item }) => {
      const name = t('mobile.dm_shortcut', { name: item.name });
      return <View style={{ maxWidth: uiDensity.conversationTabMaxWidth }}><AppButton label={name} accessibilityLabel={item.count ? t('mobile.unread_private_sender', { name, count: item.count }) : name}
        iconRight={item.count > 0 ? <AppText variant="caption" tone="accent">{item.count}</AppText> : undefined}
        unread={item.count > 0} accessibilityHint={item.count ? t('mobile.unread_activity') : undefined}
        variant="secondary" fullWidth={false} selected={selected === item.peer} labelNumberOfLines={1}
        onPress={() => onSelect(item.peer)} /></View>;
    }} />;
}
