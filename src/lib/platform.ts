import { Platform, type KeyboardAvoidingViewProps } from 'react-native';
export const IS_ANDROID = Platform.OS === 'android';
export const IS_IOS = Platform.OS === 'ios';
export const IS_ELECTRON = false;
export const DESKTOP_OS: string | undefined = undefined;
export const KEYBOARD_AVOIDING_BEHAVIOR: KeyboardAvoidingViewProps['behavior'] = IS_IOS ? 'padding' : undefined;
