import 'react-native-get-random-values';
import '@/i18n';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { SystemColorSchemeProvider } from '@/theme';
import { useThemeStore } from '@/stores/theme.store';
import { platform } from '@/platform';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { geohashService } from '@/services/geohash/geohash.service';
export default function Layout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void useThemeStore.getState().load().finally(() => { if (alive) setReady(true); });
    const remove = platform.appState.addChangeListener(state => {
      if (state === 'background') { void bitchatService.stop().catch(() => {}); geohashService.stop(); }
    });
    return () => { alive = false; remove(); void bitchatService.stop().catch(() => {}); geohashService.stop(); };
  }, []);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><KeyboardProvider><SystemColorSchemeProvider>
    {ready ? <Stack screenOptions={{ headerShown: false }} /> : <AppScreen><AppText>Outlink</AppText></AppScreen>}
  </SystemColorSchemeProvider></KeyboardProvider></SafeAreaProvider></GestureHandlerRootView>;
}
