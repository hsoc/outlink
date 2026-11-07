import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { Mic, Radio } from 'lucide-react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useAudioRecorderState, type AudioRecorder } from 'expo-audio';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

const geometry = uiDensity.audioCapture;

function CaptureSurface({ label, seconds, levels, pulse }: { label: string; seconds: number; levels?: number[]; pulse?: boolean }) {
  const colors = useThemeColors();
  const reducedMotion = useReducedMotion();
  const [animation] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!pulse || reducedMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(animation, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(animation, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]));
    loop.start();
    return () => { loop.stop(); animation.setValue(0); };
  }, [animation, pulse, reducedMotion]);
  const Icon = pulse ? Radio : Mic;
  const duration = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return <View style={{ flex: 1, justifyContent: 'center', gap: spacing.xs, paddingHorizontal: uiDensity.inputHorizontalPadding,
    paddingVertical: spacing.sm, borderRadius: radius.lg, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Icon color={colors.accent} size={geometry.iconSize} />
      <AppText variant="caption" tone="accent" style={{ flex: 1 }} numberOfLines={1}>{label}</AppText>
      <AppText variant="caption" tone="accent" style={{ fontVariant: ['tabular-nums'] }}>{duration}</AppText>
    </View>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ height: geometry.waveHeight, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, overflow: 'hidden' }}>
      {Array.from({ length: geometry.barCount }, (_, index) => {
        const level = levels?.[index] ?? 0;
        const scaleY = pulse ? animation.interpolate({ inputRange: [0, 1], outputRange: index % 2 ? [0.2, 0.9] : [0.7, 0.25] }) : Math.max(0.08, level);
        return <Animated.View key={index} style={{ flex: 1, maxWidth: geometry.barWidth, height: geometry.waveHeight,
          backgroundColor: colors.accent, borderRadius: radius.full, transform: [{ scaleY }] }} />;
      })}
    </View>
  </View>;
}

export function VoiceNoteCaptureDisplay({ recorder }: { recorder: AudioRecorder }) {
  const { t } = useTranslation();
  const state = useAudioRecorderState(recorder, 100);
  const [wave, setWave] = useState(() => ({ duration: state.durationMillis, levels: Array<number>(geometry.barCount).fill(0) }));
  if (state.isRecording && wave.duration !== state.durationMillis) {
    const level = state.metering === undefined ? 0 : Math.max(0, Math.min(1, (state.metering + 60) / 60));
    setWave({ duration: state.durationMillis, levels: [...wave.levels.slice(1), level] });
  }
  return <CaptureSurface label={t(state.isRecording ? 'mesh_media.recording' : 'mesh_media.recorded')}
    seconds={Math.floor(state.durationMillis / 1000)} levels={wave.levels} />;
}

export function PushToTalkCaptureDisplay() {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);
  return <CaptureSurface label={t('live_voice.talking')} seconds={seconds} pulse />;
}
