import { workspaceStore, restoreWorkspace } from '@/services/history/workspace';
import { useEffect, useState, useMemo } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { router } from 'expo-router';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { mobileIdentity } from '@/services/bitchat/mobile-identity';
import type { BitchatMessage } from '@/services/bitchat/bitchat-session';
import type { GeoMessage } from '@/services/geohash/geohash-session';
import { bytes } from '@/services/bitchat/bitchat-wire';
import { geohashService, geohashStore } from '@/services/geohash/geohash.service';
import { MAX_GEO_CONTENT_BYTES } from '@/services/geohash/geohash-protocol';
import { getDevicePreference, setDevicePreference } from '@/services/preferences/device-preferences.service';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

export default function Chats() {
  const { t } = useTranslation(), c = useThemeColors(), top = useScreenHeaderClearance();
  const mesh = useStore(bitchatSessionStore), geo = useStore(geohashStore);
  const workspace = useStore(workspaceStore);
  const { mode, hash, precision, relays, recipient } = workspace;
  const setMode = (mode: 'mesh' | 'geo') => workspaceStore.setState({ mode });
  const setHash = (hash: string) => workspaceStore.setState({ hash });
  const setPrecision = (precision: number) => workspaceStore.setState({ precision });
  const setRelays = (relays: string) => workspaceStore.setState({ relays });
  const setRecipient = (recipient?: string) => workspaceStore.setState({ recipient });
  const draftKey = mode === 'mesh' ? `mesh:${recipient ?? 'public'}` : `geo:${hash.trim().toLowerCase().replace(/^#/, '')}`;
  const draft = workspace.drafts[draftKey] ?? '';
  const setDraft = (value: string) => workspaceStore.setState(state => ({ drafts: { ...state.drafts, [draftKey]: value } }));
  const [name, setName] = useState(''), [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false), [error, setError] = useState(false);
  const active = mode === 'mesh' ? mesh.active : geo.active;
  const busy = working || mesh.busy || geo.busy;
  const contacts = useMemo(() => {
    const found = new Map(mesh.peers.map(peer => [peer.id, { id: peer.id, name: peer.name }]));
    for (const message of mesh.messages) if (message.recipient) {
      const id = message.outgoing ? message.recipient : message.peer;
      if (!found.has(id)) found.set(id, { id, name: message.outgoing ? id : message.name });
    }
    if (recipient && !found.has(recipient)) found.set(recipient, { id: recipient, name: recipient });
    return [...found.values()];
  }, [mesh.peers, mesh.messages, recipient]);
  const peer = mesh.peers.find(p => p.id === recipient);
  const messages = useMemo(() => mode === 'geo' ? geo.messages : mesh.messages.filter(m => recipient ?
    m.recipient && (m.peer === recipient || m.recipient === recipient) : !m.recipient), [mode, recipient, mesh.messages, geo.messages]);
  useEffect(() => {
    let alive = true;
    void Promise.all([getDevicePreference('mobile.nickname'), restoreWorkspace(), bitchatService.restore()]).then(async ([value]) => {
      const savedHash = workspaceStore.getState().hash;
      if (savedHash) await geohashService.restore(savedHash).catch(() => {});
      if (alive) { setName(value ?? t('bitchat.default_name')); setReady(true); }
    }).catch(() => { if (alive) { setReady(true); setError(true); } });
    return () => { alive = false; };
  }, [t]);
  useEffect(() => {
    if (mode !== 'mesh' || !recipient || !mesh.active) return;
    for (const message of mesh.messages) if (!message.outgoing && message.recipient && message.peer === recipient && message.delivery === 'delivered')
      void bitchatService.read(recipient, message.id).catch(() => {});
  }, [mode, recipient, mesh.active, mesh.messages]);
  async function operate(task: () => Promise<void>) {
    if (working) return;
    setWorking(true); setError(false);
    try { await task(); } catch { setError(true); } finally { setWorking(false); }
  }
  async function join() {
    await setDevicePreference('mobile.nickname', name.trim());
    if (mode === 'mesh') await bitchatService.start(await mobileIdentity(), name.trim());
    else await geohashService.join(hash, name.trim(), relays.split(/\s+/).filter(Boolean));
  }
  async function send() {
    if (mode === 'mesh') await bitchatService.send(draft, recipient);
    else await geohashService.send(draft);
    workspaceStore.setState(state => state.drafts[draftKey] === draft ? { drafts: { ...state.drafts, [draftKey]: '' } } : state);
  }
  if (!ready) return <AppScreen><AppText>Outlink</AppText></AppScreen>;
  return <AppScreen edges={['bottom']}>
    <View style={{ flex: 1, paddingTop: top, paddingHorizontal: spacing.lg, gap: spacing.md }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {(['mesh', 'geo'] as const).map(value => <AppButton key={value} label={t(`mobile.${value}`)} variant="secondary"
          fullWidth={false} selected={mode === value} disabled={busy} onPress={() => { setMode(value); setError(false); }} />)}
      </View>
      {!active ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
        <Radar size={uiDensity.iconButtonSize} color={c.textMuted} />
        <AppText variant="title">{t(mode === 'mesh' ? 'bitchat.title' : 'mobile.geo')}</AppText>
        <AppText tone="muted">{t(mode === 'mesh' ? 'mobile.mesh_privacy' : 'mobile.geo_privacy')}</AppText>
        <AppInput label={t('bitchat.name')} value={name} onChangeText={setName} maxLength={32} editable={ready && !busy} />
        {mode === 'geo' && <>
          <AppInput label={t('mobile.geohash')} value={hash} onChangeText={setHash} autoCapitalize="none" autoCorrect={false} maxLength={13} />
          <AppText variant="caption" tone="muted">{t('mobile.precision')}</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {[3, 4, 5].map(value => <AppButton key={value} label={t(`mobile.precision_${value}`)} fullWidth={false} variant="secondary"
              selected={precision === value} onPress={() => setPrecision(value)} disabled={busy} />)}
          </View>
          <AppButton label={t('mobile.use_location')} variant="secondary" disabled={busy}
            onPress={() => void operate(async () => { setHash(await geohashService.nearby(precision)); })} />
          <AppText variant="caption" tone="muted">{t('mobile.location_hint')}</AppText>
          <AppInput label={t('mobile.relays')} value={relays} onChangeText={setRelays} multiline autoCapitalize="none" autoCorrect={false} maxLength={1536} />
        </>}
        <AppButton label={t('mobile.join')} loading={busy} disabled={!ready || !name.trim() || bytes(name.trim()).length > 64}
          onPress={() => void operate(join)} />
      </ScrollView> : null}
      {(active || (mode === 'mesh' ? mesh.messages.length > 0 : geo.messages.length > 0)) && <>
        {mode === 'mesh' ? <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}>
          <AppButton label={t('bitchat.public')} variant="secondary" fullWidth={false} selected={!recipient} onPress={() => setRecipient(undefined)} />
          {contacts.map(p => <AppButton key={p.id} label={p.name} variant="secondary" fullWidth={false}
            selected={recipient === p.id} onPress={() => setRecipient(p.id)} />)}
        </ScrollView> : <AppText variant="caption" tone="muted">{t('mobile.geo_status', { hash: geo.hash, count: geo.connected, people: geo.present })}</AppText>}
        <AppText variant="caption" tone="muted">{t(mode === 'geo' ? 'mobile.geo_privacy' : recipient ? 'bitchat.private_notice' : 'bitchat.public_notice')}</AppText>
        {mode === 'mesh' && peer ? <AppText variant="caption" selectable tone="muted">{t('bitchat.fingerprint', { value: peer.fingerprint })}</AppText> : null}
        <AppButton label={t('mobile.older')} variant="text" disabled={busy} onPress={() => void operate(() => mode === 'mesh' ? bitchatService.older() : geohashService.older())} />
        <AppButton label={t('mobile.latest')} variant="text" disabled={busy} onPress={() => void operate(() => mode === 'mesh' ? bitchatService.latest() : geohashService.restore(geo.hash))} />
        <FlatList<BitchatMessage | GeoMessage> data={messages} keyExtractor={m => m.id + ('peer' in m ? m.peer : m.pubkey)} keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
          renderItem={({ item }) => <View style={{ padding: spacing.md, borderRadius: radius.lg, backgroundColor: item.outgoing ? c.accentSoft : c.surface }}>
            <AppText variant="caption" tone="muted" selectable accessibilityLabel={item.name + ('pubkey' in item ? ' · ' + item.pubkey : '')}>{item.name}{'pubkey' in item ? ' · ' + item.pubkey.slice(0, 8) : ''}</AppText><AppText selectable>{item.content}</AppText>
            {item.outgoing && <AppText variant="caption" tone="muted">{t(`bitchat.${item.delivery}`)}</AppText>}
          </View>}
          ListEmptyComponent={<View style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
            <Radar size={uiDensity.iconButtonSize} color={c.textMuted} /><AppText variant="subtitle">{t('bitchat.empty')}</AppText>
            <AppText tone="muted">{t(mode === 'geo' ? 'mobile.geo_empty_hint' : 'bitchat.empty_hint')}</AppText>
          </View>} />
        <AppInput label={t('bitchat.message')} value={draft} onChangeText={setDraft} multiline maxLength={mode === 'mesh' ? 255 : MAX_GEO_CONTENT_BYTES} />
        <AppButton label={t('bitchat.send')} loading={working} disabled={!active || busy || !draft.trim() || bytes(draft).length > (mode === 'mesh' ? 255 : MAX_GEO_CONTENT_BYTES) || (mode === 'geo' && !geo.connected)}
          onPress={() => void operate(send)} />
        <AppButton label={t('bitchat.leave')} variant="text" disabled={busy} onPress={() => void operate(async () => {
          if (mode === 'mesh') await bitchatService.stop(); else geohashService.stop(); setRecipient(undefined);
        })} />
      </>}
      {(error || workspace.error || (mode === 'mesh' ? mesh.error : geo.error)) && <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">{t('mobile.failed')}</AppText>}
    </View>
    <ScreenHeader title="Outlink" back={false} right={<AppButton label={t('mobile.settings')} variant="text" onPress={() => router.push('/settings')} />} />
  </AppScreen>;
}
