import { useCallback, useMemo } from 'react';
import { Image } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { platform } from '@/platform';
import { createTripleTap } from '@/lib/triple-tap';
import { uiDensity } from '@/theme';
import { AppButton } from '@/components/common/AppButton';

export function QuickEraseButton({ onErase, busy }: { onErase(): void; busy: boolean }) {
  const { t } = useTranslation();
  const gesture = useMemo(() => createTripleTap(onErase), [onErase]);
  useFocusEffect(useCallback(() => {
    gesture.reset();
    const remove = platform.appState.addChangeListener(state => { if (state !== 'active') gesture.reset(); });
    return () => { remove(); gesture.reset(); };
  }, [gesture]));
  return <AppButton variant="ghost" fullWidth={false} compact corner="full" minimumSize={uiDensity.headerActionSize}
    accessibilityLabel={t('mobile.quick_erase')} accessibilityHint={t('mobile.quick_erase_hint')} disabled={busy} loading={busy}
    onPress={() => { if (!busy && platform.appState.currentState() === 'active') gesture.tap(); }}
    iconLeft={<Image source={require('../../../assets/images/icon.png')} accessible={false}
      style={{ width: uiDensity.headerActionIconSize, height: uiDensity.headerActionIconSize }} />} />;
}
