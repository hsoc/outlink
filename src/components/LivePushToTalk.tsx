import { useCallback, useEffect, useRef } from 'react';
import { Radio, Headphones, HeadphoneOff } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { ComposerAction } from './ComposerAction';
import { platform } from '@/platform';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { liveVoice, liveVoiceStore } from '@/services/bitchat/live-voice';

export function LivePushToTalk({ peer, canTalk, disabled }: { peer?: string; canTalk: boolean; disabled: boolean }) {
  const { t } = useTranslation();
  const { listening, talking } = useStore(liveVoiceStore);
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
  return <>
    <ComposerAction icon={listening ? HeadphoneOff : Headphones} selected={listening} disabled={disabled || talking}
      label={t(listening ? 'live_voice.stop_listening' : 'live_voice.listen')}
      onPress={() => liveVoice.listen(listening ? undefined : peer ?? null)} />
    <ComposerAction icon={Radio} variant={talking ? 'danger' : 'secondary'}
      label={t(talking ? 'live_voice.talking' : 'live_voice.hold')}
      disabled={!canTalk || disabled} onPressIn={() => void start()} onPressOut={release} />
  </>;
}
