import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { AppButton } from './AppButton';
import { AppText } from './AppText';
import { radius, spacing, useThemeColors } from '@/theme';

/** Explanations remain available without reducing the conversation's reading space. */
export function LocationInfo({ onClose }: { onClose(): void }) {
  const { t } = useTranslation(), colors = useThemeColors(), insets = useSafeAreaInsets();
  return <Modal transparent animationType="fade" onRequestClose={onClose}>
    <View style={{ flex: 1, paddingTop: insets.top, justifyContent: 'flex-end', backgroundColor: colors.sheetBackdrop }}>
      <Pressable style={{ flex: 1 }} accessibilityLabel={t('common.close')} onPress={onClose} />
      <ScrollView style={{ flexGrow: 0 }} accessibilityViewIsModal contentContainerStyle={{ gap: spacing.md, padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg, backgroundColor: colors.surface, borderTopStartRadius: radius.xl, borderTopEndRadius: radius.xl }}>
        <AppText variant="subtitle" accessibilityRole="header">{t('mobile.location_info')}</AppText>
        <AppText>{t('mobile.geo_public_notice')}</AppText>
        <AppText>{t('mobile.geo_active_hint')}</AppText>
        <AppText>{t('mobile.channel_rotation_short')}</AppText>
        <AppButton label={t('common.close')} variant="secondary" onPress={onClose} />
      </ScrollView>
    </View>
  </Modal>;
}
