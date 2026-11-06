import { LivePushToTalk } from './LivePushToTalk';
import { liveVoiceStore } from '@/services/bitchat/live-voice';
import { useCallback, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { useStore } from 'zustand';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { requestRecordingPermissionsAsync, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder } from 'expo-audio';
import { File } from 'expo-file-system';
import { AppButton } from '@/components/common/AppButton';
import { AppText } from '@/components/common/AppText';
import { blockedUsers } from '@/services/moderation/blocked-users';
import { contactsService } from '@/services/bitchat/compatibility/contacts';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { meshAttachments, meshAttachmentStore, type AttachmentOffer } from '@/services/bitchat/mesh-attachments';
import { MESH_MEDIA_LIMIT, mediaExtensions } from '@/services/bitchat/compatibility/media';
import { platform } from '@/platform';
import { spacing } from '@/theme';
import { sessionIntent } from '@/services/history/lifecycle';

const recordingOptions = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 24000, numberOfChannels: 1, bitRate: 24000 };
const remove = (file?: File) => { if (file?.exists) file.delete(); };

export function MeshAttachments({ peer, canSend, joined, onOpenPeer }: { peer?: string; canSend: boolean; joined: boolean; onOpenPeer(id: string): void }) {
  const { t } = useTranslation();
  const voice = useStore(liveVoiceStore);
  const voiceActive = voice.listening || voice.talking;
  const offers = useStore(meshAttachmentStore, state => state.offers);
  const recorder = useAudioRecorder(recordingOptions);
  const player = useAudioPlayer();
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState<'failed' | 'sent'>();
  const [preview, setPreview] = useState<{ file: File; image: boolean }>();
  const [picked, setPicked] = useState<{ source: File; mime: string; width: number; height: number }>();
  const selection = useRef<typeof picked>(undefined);
  const generation = useRef(0), active = useRef(false), picking = useRef(false), file = useRef<File | undefined>(undefined);
  const clearSelection = useCallback(() => {
    const source = selection.current?.source;
    selection.current = undefined; setPicked(undefined);
    if (source?.uri.startsWith('file:') && source.uri.includes('/ImagePicker/')) remove(source);
  }, []);
  useFocusEffect(useCallback(() => {
    const reset = () => {
      generation.current++;
      try { player.replace(null); } catch { /* The native player may already be released. */ }
      try { remove(file.current); } catch { /* Startup and identity erase also clean the cache. */ }
      file.current = undefined;
      setPreview(undefined); setRecording(false);
      clearSelection();
      if (active.current) {
        active.current = false;
        void recorder.stop().catch(() => {}).finally(() => {
          try { remove(recorder.uri ? new File(recorder.uri) : undefined); } catch { /* Native cache may already be gone. */ }
          void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
        });
      }
    };
    const subscription = platform.appState.addChangeListener(state => { if (state !== 'active' && !picking.current) reset(); });
    return () => { subscription(); reset(); };
  }, [clearSelection, player, recorder]));
  const operate = async (task: (valid: () => boolean) => Promise<void>) => {
    if (busy) return;
    const current = generation.current, intent = sessionIntent();
    const valid = () => current === generation.current && intent === sessionIntent() && platform.appState.currentState() === 'active';
    setBusy(true); setStatus(undefined);
    try { await task(valid); } catch { if (valid()) setStatus('failed'); } finally { setBusy(false); }
  };
  const sendFile = async (source: File, mime: string, valid: () => boolean) => {
    if (!source.size || source.size > MESH_MEDIA_LIMIT) throw new Error('Attachment too large');
    const data = await source.bytes();
    try {
      if (!valid()) return;
      await bitchatService.sendMedia(mime, data, peer);
      if (valid()) setStatus('sent');
    } finally { data.fill(0); }
  };
  const chooseImage = () => operate(async valid => {
    picking.current = true;
    try {
      const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.2, exif: false });
      if (result.canceled) return;
      const asset = result.assets[0], source = new File(asset.uri);
      const staged = { source, mime: asset.mimeType ?? 'image/jpeg', width: asset.width, height: asset.height };
      for (let i = 0; i < 10 && platform.appState.currentState() !== 'active'; i++)
        await new Promise(resolve => setTimeout(resolve, 50));
      if (valid()) {
        clearSelection();
        selection.current = staged; setPicked(staged);
      } else if (source.uri.startsWith('file:') && source.uri.includes('/ImagePicker/')) remove(source);
    } finally { picking.current = false; }
  });
  const sendImage = async (image: NonNullable<typeof picked>, valid: () => boolean) => {
    if (image.source.size && image.source.size <= MESH_MEDIA_LIMIT && /^image\/(jpeg|png|webp)$/.test(image.mime)) {
      await sendFile(image.source, image.mime, valid);
      return;
    }
    for (const dimension of [640, 360]) {
      if (!valid()) return;
      const context = ImageManipulator.manipulate(image.source.uri);
      const width = image.width >= image.height ? { width: Math.min(image.width, dimension) } : { height: Math.min(image.height, dimension) };
      context.resize(width);
      const rendered = await context.renderAsync();
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.4 });
      const resized = new File(result.uri);
      try {
        if (resized.size && resized.size <= MESH_MEDIA_LIMIT) {
          await sendFile(resized, 'image/jpeg', valid);
          return;
        }
      } finally { remove(resized); }
    }
    throw new Error('Attachment too large');
  };
  const record = () => operate(async valid => {
    picking.current = true;
    try {
      if (!(await requestRecordingPermissionsAsync()).granted) throw new Error('Microphone permission denied');
    } finally { picking.current = false; }
    if (!valid()) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    try {
      await recorder.prepareToRecordAsync();
      if (!valid()) { await recorder.stop().catch(() => {}); remove(recorder.uri ? new File(recorder.uri) : undefined); return; }
      recorder.record({ forDuration: 15 });
      active.current = true; setRecording(true);
    } finally { if (!active.current) await setAudioModeAsync({ allowsRecording: false }); }
  });
  const finish = (send: boolean) => operate(async valid => {
    active.current = false;
    try {
      if (recorder.isRecording) await recorder.stop();
      if (send && recorder.uri) await sendFile(new File(recorder.uri), 'audio/mp4', valid);
    } finally {
      remove(recorder.uri ? new File(recorder.uri) : undefined);
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false });
    }
  });
  const close = () => {
    player.replace(null);
    remove(file.current); file.current = undefined; setPreview(undefined);
  };
  const accept = (offer: AttachmentOffer) => operate(async valid => {
    if (!valid() || blockedUsers.has('mesh:' + offer.peer) || contactsService.get(offer.peer)?.blocked) return;
    const media = meshAttachments.accept(offer.id);
    if (!media) return;
    try {
      close();
      const accepted = new File(platform.meshMediaCache.save(offer.id, mediaExtensions[media.mime], media.data));
      file.current = accepted;
      setPreview({ file: accepted, image: media.mime.startsWith('image/') });
    } finally { media.data.fill(0); }
  });
  if (!joined && !picked) return null;
  return <View style={{ gap: spacing.xs }}>
    {!peer && [...new Map(offers.filter(offer => offer.privateMessage).map(offer => [offer.peer, offer])).values()].map(offer =>
      <AppButton key={offer.peer} size="sm" variant="secondary" label={t('mesh_media.private_offer', { name: offer.name })} onPress={() => onOpenPeer(offer.peer)} />)}
    {offers.filter(offer => peer ? offer.privateMessage && offer.peer === peer : !offer.privateMessage).map(offer =>
      <View key={offer.id} style={{ gap: spacing.xs }}>
        <AppText variant="caption">{t(offer.mime.startsWith('image/') ? 'mesh_media.image_offer' : 'mesh_media.voice_offer', { name: offer.name, size: Math.ceil(offer.size / 1024) })}</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          <AppButton size="sm" variant="secondary" fullWidth={false} label={t('mesh_media.accept')} disabled={busy || recording} onPress={() => void accept(offer)} />
          <AppButton size="sm" variant="text" fullWidth={false} label={t('mesh_media.decline')} onPress={() => meshAttachments.decline(offer.id)} />
        </View>
      </View>)}
    {preview && <View style={{ gap: spacing.xs }}>
      {preview.image ? <Image source={{ uri: preview.file.uri }} style={{ width: '100%', aspectRatio: 2 }} resizeMode="contain" accessibilityLabel={t('mesh_media.accepted_image')} />
        : <AppButton size="sm" variant="secondary" disabled={voiceActive} label={t('mesh_media.play')} onPress={() => { player.replace(preview.file.uri); player.play(); }} />}
      <AppButton size="sm" variant="text" label={t('mesh_media.close')} onPress={close} />
    </View>}
    {!peer && canSend && <AppText variant="caption" tone="muted">{t('mesh_media.public_notice')}</AppText>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
      {!recording && <AppButton size="sm" fullWidth={false} variant="text" label={t(picked ? 'mesh_media.send_image' : 'mesh_media.choose_image')} disabled={!canSend || busy} onPress={() => {
        if (!picked) { void chooseImage(); return; }
        void operate(async valid => { try { await sendImage(picked, valid); } finally { clearSelection(); } });
      }} />}
      {picked && <AppButton size="sm" fullWidth={false} variant="text" label={t('mobile.cancel')} disabled={busy} onPress={clearSelection} />}
      <AppButton size="sm" fullWidth={false} variant="text" label={t(recording ? 'mesh_media.send_voice' : 'mesh_media.record')} disabled={!canSend || busy || voiceActive} onPress={() => void (recording ? finish(true) : record())} />
      {recording && <AppButton size="sm" fullWidth={false} variant="text" label={t('mobile.cancel')} disabled={busy} onPress={() => void finish(false)} />}
    </View>
    {joined && <LivePushToTalk peer={peer} canTalk={canSend} disabled={recording || busy} />}
    {status && <AppText variant="caption" tone={status === 'failed' ? 'danger' : 'muted'} accessibilityLiveRegion="polite">{t(`mesh_media.${status}`)}</AppText>}
  </View>;
}
