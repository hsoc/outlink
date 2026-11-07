import { pruneChatHistory } from '@/services/history/maintenance';
import { privateMessageAlerts } from '@/services/mentions/private-messages';
import { mentionService } from '@/services/mentions/mentions';
import i18n from '@/i18n/core';
import { workspaceStore } from '@/services/history/workspace';
import { createSessionLifecycle } from '@/services/history/lifecycle';
import 'react-native-get-random-values';
import '@/i18n';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { AppScreen } from '@/components/common/AppScreen';
import { resumePendingWipe } from '@/services/bitchat/panic';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { SystemColorSchemeProvider } from '@/theme';
import { useThemeStore } from '@/stores/theme.store';
import { platform } from '@/platform';
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { geohashService, geohashStore } from '@/services/geohash/geohash.service';
export default function Layout() {
  const [ready, setReady] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    void resumePendingWipe().then(() => { platform.meshMediaCache.clear(); if (alive) setRecovered(true); })
      .catch(() => { if (alive) setRecoveryFailed(true); });
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => {
    if (!recovered) return;
    let alive = true;
    const mentionCopy = () => mentionService.setCopy({ channelName: i18n.t('mobile.mention_notifications'), meshBody: i18n.t('mobile.mention_alert_mesh'), geoBody: i18n.t('mobile.mention_alert_geo') });
    const privateCopy = () => privateMessageAlerts.setCopy({ channelName: i18n.t('mobile.private_message_notifications'), body: i18n.t('mobile.private_message_alert'), geoBody: i18n.t('mobile.private_message_alert_geo') });
    privateCopy(); i18n.on('languageChanged', privateCopy);
    mentionCopy(); i18n.on('languageChanged', mentionCopy);
    void useThemeStore.getState().load().finally(() => { if (alive) setReady(true); });
    const lifecycle = createSessionLifecycle(bitchatService, geohashService, {
      enabled: () => workspaceStore.getState().keepBackground === true && platform.backgroundConnectivity.supported(),
      start: (mesh, internet) => platform.backgroundConnectivity.start(i18n.t('mobile.background_notification_title'), i18n.t('mobile.background_notification_body'), i18n.t('mobile.background_stop'), mesh, internet),
      running: () => platform.backgroundConnectivity.running(),
      stop: () => platform.backgroundConnectivity.stop(),
      failed: () => workspaceStore.setState({ keepBackground: false, backgroundError: true }),
    });
    const refresh = () => { void lifecycle.change(platform.appState.currentState()).catch(() => workspaceStore.setState({ backgroundError: true })); };
    const unsubscribePreference = workspaceStore.subscribe((state, previous) => { if (state.keepBackground !== previous.keepBackground) refresh(); });
    const unsubscribeMesh = bitchatSessionStore.subscribe((state, previous) => { if (state.active !== previous.active) refresh(); });
    const unsubscribeGeo = geohashStore.subscribe((state, previous) => { if (state.active !== previous.active) refresh(); });
    const unsubscribeStop = platform.backgroundConnectivity.onStop(() => {
      if ((bitchatService.connection || geohashService.connection) && workspaceStore.getState().keepBackground) workspaceStore.setState({ keepBackground: false });
    });
    const cleanupHistory = () => { void pruneChatHistory().catch(() => bitchatSessionStore.setState({ error: true })); };
    cleanupHistory();
    const historyTimer = setInterval(cleanupHistory, 60000);
    const remove = platform.appState.addChangeListener(state => { if (state === 'active') cleanupHistory(); void lifecycle.change(state).catch(() => {}); });
    return () => { i18n.off('languageChanged', privateCopy); i18n.off('languageChanged', mentionCopy); alive = false; clearInterval(historyTimer); remove(); unsubscribePreference(); unsubscribeMesh(); unsubscribeGeo(); unsubscribeStop(); lifecycle.dispose(); };
  }, [recovered]);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><KeyboardProvider><SystemColorSchemeProvider>
    {ready ? <Stack screenOptions={{ headerShown: false }} /> : <AppScreen>
      <AppText>Outlink</AppText>
      {recoveryFailed && <>
        <AppText tone="danger" accessibilityLiveRegion="polite">{i18n.t('mobile.operation_failed')}</AppText>
        <AppButton label={i18n.t('common.retry')} onPress={() => { setRecoveryFailed(false); setAttempt(value => value + 1); }} />
      </>}
    </AppScreen>}
  </SystemColorSchemeProvider></KeyboardProvider></SafeAreaProvider></GestureHandlerRootView>;
}
