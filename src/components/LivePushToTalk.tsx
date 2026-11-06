import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { platform } from '@/platform';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { liveVoice, liveVoiceStore } from '@/services/bitchat/live-voice';
import { spacing } from '@/theme';

export function LivePushToTalk({ peer, canTalk, disabled }: { peer?: string; canTalk: boolean; disabled: boolean }) {
  const { t } = useTranslation();
  const { listening, talking, speaker, error } = useStore(liveVoiceStore);
  const held = useRef<object | undefined>(undefined);
  const sender = useRef<ReturnType<typeof bitchatService.voiceSender> | undefined>(undefined);
  const start = async () => {
    if (!canTalk || disabled || held.current || talking) return;
    const attempt = {};
    held.current = attempt;
    const valid = () => held.current === attempt && platform.appState.currentState() === 'active';
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) { liveVoiceStore.setState({ error: true }); return; }
      if (!valid()) return;
      const transport = bitchatService.voiceSender(peer);
      sender.current = transport;
      await transport.prepare();
      if (valid()) await liveVoice.start(transport.send, valid);
    } catch { if (valid()) liveVoiceStore.setState({ error: true }); }
  };
  const release = useCallback(() => {
    held.current = undefined;
    const send = sender.current?.send;
    sender.current = undefined;
    void liveVoice.stop(send).catch(() => liveVoiceStore.setState({ error: true }));
  }, []);
  useEffect(() => { if ((!canTalk || disabled) && held.current) release(); }, [canTalk, disabled, release]);
  useFocusEffect(useCallback(() => {
    const clear = () => {
      held.current = undefined; sender.current = undefined;
      void liveVoice.clear();
    };
    const unsubscribe = platform.appState.addChangeListener(state => { if (state !== 'active') clear(); });
    return () => { unsubscribe(); clear(); };
  }, []));
  if (!platform.liveVoice?.available()) return null;
  return <View style={{ gap: spacing.xs }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      <AppButton size="sm" variant="secondary" fullWidth={false} selected={listening} disabled={disabled || talking}
        label={t(listening ? 'live_voice.stop_listening' : 'live_voice.listen')}
        onPress={() => liveVoice.listen(listening ? undefined : peer ?? null)} />
      <AppButton size="sm" variant={talking ? 'danger' : 'secondary'} fullWidth={false}
        label={t(talking ? 'live_voice.talking' : 'live_voice.hold')}
        disabled={!canTalk || disabled} onPressIn={() => void start()} onPressOut={release} />
    </View>
    {speaker && <AppText variant="caption" accessibilityLiveRegion="polite">{t('live_voice.speaker', { name: speaker })}</AppText>}
    {error && <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">{t('live_voice.failed')}</AppText>}
    {!peer && <AppText variant="caption" tone="muted">{t('live_voice.public_notice')}</AppText>}
  </View>;
}
