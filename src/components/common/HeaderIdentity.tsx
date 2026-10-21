import { useEffect, type ReactNode } from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { ensureNickname, nicknameStore } from '@/services/preferences/nickname';
import { nicknameBase } from '@/lib/nicknames';
import { spacing, uiDensity } from '@/theme';
import { AppButton } from './AppButton';
export function HeaderIdentity({ icon }: { icon?: ReactNode }) {
  const name = useStore(nicknameStore, state => state.name), { t } = useTranslation();
  useEffect(() => { void ensureNickname().catch(() => {}); }, []);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minWidth: 0, flex: 1 }}>
    {icon ?? <Image source={require('../../../assets/images/icon.png')} accessible={false}
      style={{ width: uiDensity.headerActionIconSize, height: uiDensity.headerActionIconSize }} />}
    <View style={{ flex: 1, minWidth: 0 }}>{name ? <AppButton label={`@${nicknameBase(name)}`} variant="text" fullWidth={false} minimumSize={uiDensity.headerActionSize}
      labelNumberOfLines={1} labelEllipsizeMode="tail" accessibilityLabel={t('mobile.edit_nickname', { name: nicknameBase(name) })}
      onPress={() => router.push('/settings')} /> : null}</View>
  </View>;
}
