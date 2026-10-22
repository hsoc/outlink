import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { radius, spacing, useThemeColors } from '@/theme';
export type MessageAction = 'copy' | 'message' | 'hug' | 'slap' | 'block';
export function MessageActions({ name, own, canMessage, canPost, onAction, onClose }: {
  name: string; own: boolean; canMessage: boolean; canPost: boolean;
  onAction(action: MessageAction): void; onClose(): void;
}) {
  const { t } = useTranslation(), c = useThemeColors(), insets = useSafeAreaInsets();
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c.sheetBackdrop }}>
      <Pressable style={{ flex: 1 }} accessibilityLabel={t('common.cancel')} onPress={onClose} />
      <ScrollView style={{ flexGrow: 0 }} accessibilityViewIsModal contentContainerStyle={{ gap: spacing.xs, padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, backgroundColor: c.surface, borderTopStartRadius: radius.xl, borderTopEndRadius: radius.xl }}>
        <AppText variant="subtitle">{name}</AppText>
        {(['copy', ...(!own ? ['message', 'hug', 'slap', 'block'] : [])] as MessageAction[]).map(action => <AppButton key={action}
          label={t(`mobile.message_action_${action}`)} variant={action === 'block' ? 'danger' : 'secondary'}
          disabled={action === 'message' && !canMessage || (action === 'hug' || action === 'slap') && !canPost}
          onPress={() => onAction(action)} />)}
        <AppButton label={t('common.cancel')} variant="secondary" onPress={onClose} />
      </ScrollView>
    </View>
  </Modal>;
}
