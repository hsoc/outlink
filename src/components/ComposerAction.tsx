import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { AppButton } from '@/components/common/AppButton';
import { uiDensity, useThemeColors } from '@/theme';

type Props = Pick<ComponentProps<typeof AppButton>, 'disabled' | 'onPress' | 'onPressIn' | 'onPressOut' | 'selected' | 'variant'> & {
  icon: LucideIcon;
  label: string;
};

export function ComposerAction({ icon: Icon, label, variant = 'secondary', ...props }: Props) {
  const colors = useThemeColors();
  return <AppButton {...props} variant={variant} size="sm" compact compactAxis="none" fullWidth={false}
    minimumSize={uiDensity.composerActionSize} accessibilityRole="button" accessibilityLabel={label}
    iconLeft={<Icon size={uiDensity.composerActionSize / 2} color={variant === 'danger' ? colors.danger : colors.text} />} />;
}
