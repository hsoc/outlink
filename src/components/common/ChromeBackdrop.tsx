import { StyleSheet, View } from 'react-native';

import { useThemeColors } from '@/theme';

import { FrostedBackdrop } from './FrostedBackdrop';

type Props = {
  /** Disable frost when no content has moved beneath this chrome surface. */
  frosted?: boolean;
};

/**
 * The shared backdrop for persistent app chrome. iOS uses a
 * quiet frosted treatment; Android uses the opaque page colour because Expo's
 * non-native blur fallback is only translucent, while native blur is too costly
 * on older devices for this subtle effect.
 */
export function ChromeBackdrop({
  frosted = true,
}: Props) {
  const c = useThemeColors();
  return (
    <View
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}
    >
      {frosted ? (
        <FrostedBackdrop surface="background" />
      ) : (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: c.background, pointerEvents: 'none' }]}
        />
      )}
    </View>
  );
}
