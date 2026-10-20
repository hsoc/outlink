import { sessionIntent } from '@/services/history/lifecycle';
import { isChatAtLatest } from '@/lib/chat-scroll';
import { areaRelays } from '@/services/geohash/relay-directory';
import { contactsStore, contactsService, contactAvailable } from '@/services/bitchat/compatibility/contacts';
import { workspaceStore, restoreWorkspace } from '@/services/history/workspace';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { router, useFocusEffect } from 'expo-router';
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
import { normalizeGeohash } from '@/services/geohash/geohash';
import { ensureNickname } from '@/services/preferences/nickname';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

export default function Chats() {
  const { t } = useTranslation(), c = useThemeColors(), top = useScreenHeaderClearance();
  const savedContacts = useStore(contactsStore, state => state.contacts);
  const mesh = useStore(bitchatSessionStore), geo = useStore(geohashStore);
  const workspace = useStore(workspaceStore);
  const { mode, hash, precision, relays, recipient } = workspace;
  const setMode = (mode: 'mesh' | 'geo') => workspaceStore.setState({ mode });
  const setHash = (hash: string) => workspaceStore.setState({ hash, precision: 0 });
  const setRelays = (relays: string) => workspaceStore.setState({ relays });
  const setRecipient = (recipient?: string) => workspaceStore.setState({ recipient });
  const [privateTarget, setPrivateTarget] = useState<{ hash: string; pubkey: string }>();
  const geoRecipient = privateTarget?.hash === geo.hash ? geohashService.privatePeer(privateTarget.pubkey) : undefined;
  const geoThread = geo.privateThreads.find(thread => thread.peer === geoRecipient);
  const draftKey = mode === 'mesh' ? `mesh:${recipient ?? 'public'}` : `geo:${hash.trim().toLowerCase().replace(/^#/, '')}${geoRecipient ? ':private:' + geoRecipient : ''}`;
  const draft = workspace.drafts[draftKey] ?? '';
  const setDraft = (value: string) => workspaceStore.setState(state => ({ drafts: { ...state.drafts, [draftKey]: value } }));
  const [name, setName] = useState(''), [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false), [editingArea, setEditingArea] = useState(false);
  const areaRequest = useRef(0);
  useEffect(() => () => { ++areaRequest.current; }, []);
  let validArea = false;
  try { normalizeGeohash(hash); validArea = true; } catch { /* Keep custom input editable until valid. */ }
  const [actionError, setActionError] = useState<'join' | 'send' | 'other' | null>(null);
  const active = mode === 'mesh' ? mesh.active : geo.active;
  const busy = working || mesh.busy || geo.busy;
  const peer = mesh.peers.find(p => p.id === recipient);
  const savedContact = savedContacts.find(contact => contact.id === recipient && contactAvailable(contact));
  const selectedOnline = mesh.active && !!peer?.lastSeen && !savedContact?.blocked;
  const selectedName = peer?.name ?? savedContact?.name ?? mesh.messages.find(message => !message.outgoing && message.peer === recipient)?.name ?? recipient;
  const fingerprint = peer?.fingerprint || savedContact?.fingerprint;
  const listRef = useRef<FlatList<BitchatMessage | GeoMessage>>(null);
  const atLatest = useRef(true);
  useEffect(() => { atLatest.current = true; }, [mode, recipient, geoRecipient, geo.hash]);
  const messages = useMemo(() => mode === 'geo' ? geoRecipient ? geo.privateMessages.filter(m => m.channelThread === geoRecipient || m.peer === geoRecipient || m.recipient === geoRecipient) : geo.messages : mesh.messages.filter(m => recipient ?
    m.recipient && (m.peer === recipient || m.recipient === recipient) : !m.recipient), [mode, recipient, mesh.messages, geo.messages, geo.privateMessages, geoRecipient]);
  useEffect(() => {
    let alive = true;
    void Promise.all([ensureNickname(), restoreWorkspace(), bitchatService.restore(), contactsService.restore()]).then(async ([value]) => {
      const savedHash = workspaceStore.getState().hash;
      if (savedHash) await geohashService.restore(savedHash).catch(() => {});
      if (alive) { setName(value); setReady(true); }
    }).catch(() => { if (alive) { setReady(true); setActionError('other'); } });
    return () => { alive = false; };
  }, [t]);
  useEffect(() => {
    if (mode !== 'mesh' || !recipient || !mesh.active) return;
    for (const message of mesh.messages) if (!message.outgoing && message.recipient && message.peer === recipient && message.delivery === 'delivered')
      void bitchatService.read(recipient, message.id).catch(() => {});
  }, [mode, recipient, mesh.active, mesh.messages]);
  useEffect(() => {
    if (mode !== 'geo' || !geoRecipient || !geo.privateActive) return;
    for (const message of geo.privateMessages) if (!message.outgoing && (message.channelThread === geoRecipient || message.peer === geoRecipient) && message.delivery === 'delivered') void geohashService.readPrivate(geoRecipient, message.id, message.peer).catch(() => {});
  }, [mode, geoRecipient, geo.privateActive, geo.privateMessages]);
  async function operate(task: () => Promise<void>, action: 'join' | 'send' | 'other' = 'other') {
    if (working) return;
    setWorking(true); setActionError(null);
    try { await task(); } catch { setActionError(action); } finally { setWorking(false); }
  }
  useFocusEffect(useCallback(() => {
    let alive = true;
    void ensureNickname().then(value => { if (alive) setName(value); }).catch(() => { if (alive) setActionError('other'); });
    return () => { alive = false; };
  }, []));
  async function selectArea(precision: number) {
    const request = ++areaRequest.current, intent = sessionIntent();
    const hash = await geohashService.nearby(precision);
    if (request !== areaRequest.current || intent !== sessionIntent()) return;
    workspaceStore.setState({ hash, precision });
  }
  async function join() {
    const intent = sessionIntent();
    const value = await ensureNickname();
    setName(value);
    const identity = mode === 'mesh' ? await mobileIdentity() : undefined;
    if (intent !== sessionIntent()) throw new Error('Join canceled');
    if (identity) await bitchatService.start(identity, value);
    else { await geohashService.join(hash, value, workspace.autoAreaRelays ? areaRelays(hash) : relays.split(/\s+/).filter(Boolean)); await bitchatService.refreshNetwork(); setEditingArea(false); }
  }
  async function send() {
    if (mode === 'mesh') await bitchatService.send(draft, recipient, workspace.nearbyOnly);
    else if (geoRecipient) await geohashService.sendPrivate(geoRecipient, draft);
    else await geohashService.send(draft);
    workspaceStore.setState(state => state.drafts[draftKey] === draft ? { drafts: { ...state.drafts, [draftKey]: '' }, ...(mode === 'mesh' && !recipient ? { nearbyOnly: false } : {}) } : state);
  }
  // Disconnected peers are marked lastSeen=0 by BitchatSession; avoid a clock read during render.
  const onlinePeerCount = mesh.peers.filter(p => p.lastSeen > 0).length;
  const hasMeshPeers = onlinePeerCount > 0;
  const canSendPublicMesh = hasMeshPeers || (workspace.bridge && !workspace.nearbyOnly);
  const isComposing = active || (mode === 'mesh' ? mesh.messages.length > 0 || savedContacts.length > 0 || !!recipient : geo.messages.length > 0 || geo.privateMessages.length > 0 || geo.privatePeers.length > 0);
  const transportHint = mode === 'mesh'
    ? `Bluetooth · ${mesh.active ? (hasMeshPeers ? t('mobile.mesh_connected', { count: onlinePeerCount }) : t('mobile.mesh_searching')) : t('mobile.disconnected')}`
    : `Internet · ${geo.connected > 0 ? t('mobile.relays_connected', { count: geo.connected }) : t('mobile.relays_disconnected')}`;
  if (!ready) return <AppScreen><AppText>Outlink</AppText></AppScreen>;
  return <AppScreen edges={['bottom']}>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, paddingTop: top, paddingHorizontal: spacing.lg, gap: spacing.sm, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {(['mesh', 'geo'] as const).map(value => <AppButton key={value} label={t(`mobile.${value}`)} variant="secondary"
          fullWidth={false} selected={mode === value} disabled={busy} onPress={() => { setMode(value); setActionError(null); }} />)}
      </View>
      {(mode === 'geo' && editingArea) || (!active && !isComposing) ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
        <Radar size={uiDensity.iconButtonSize} color={c.textMuted} />
        <AppText variant="title">{t(mode === 'mesh' ? 'bitchat.title' : 'mobile.geo')}</AppText>
        <AppText tone="muted">{t(mode === 'mesh' ? 'mobile.mesh_privacy' : 'mobile.geo_privacy')}</AppText>
        <View style={{ gap: spacing.xs }}>
          <AppText variant="caption" tone="muted">{t('mobile.shared_public_name')}</AppText>
          <AppText selectable>{name}</AppText>
          <AppButton label={t('mobile.change_name')} variant="text" fullWidth={false} disabled={busy} onPress={() => router.push('/settings')} />
        </View>
        {mode === 'geo' && <>
          <AppText variant="caption" tone="muted">{t('mobile.area_picker_title')}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {[3, 4, 5].map(value => <AppButton key={value} label={t(`mobile.precision_${value}`)} fullWidth={false} variant="secondary"
              selected={!!hash && precision === value} onPress={() => void operate(() => selectArea(value))} disabled={busy} />)}
          </View>
          <AppText variant="caption" tone="muted">{t('mobile.area_picker_hint')}</AppText>
          <AppInput label={t('mobile.geohash')} value={hash} onChangeText={setHash} autoCapitalize="none" autoCorrect={false} maxLength={13}
            editable={!busy} error={hash.trim() && !validArea ? t('mobile.invalid_area') : undefined} returnKeyType="go"
            onSubmitEditing={() => { if (!busy && validArea && name.trim() && bytes(name.trim()).length <= 64) void operate(join, 'join'); }} />
          {workspace.autoAreaRelays ? <AppText variant="caption" tone="muted" selectable>{t('mobile.automatic_area_hint')}{'\n'}{(() => { try { return areaRelays(hash).join('\n'); } catch { return ''; } })()}</AppText> : <AppInput label={t('mobile.relays')} value={relays} onChangeText={setRelays} multiline autoCapitalize="none" autoCorrect={false} maxLength={1536} />}
        </>}
        <AppButton label={t('mobile.join')} loading={busy} disabled={busy || !ready || !name.trim() || bytes(name.trim()).length > 64 || (mode === 'geo' && !validArea)}
          onPress={() => void operate(join, 'join')} />
        {mode === 'geo' && editingArea && isComposing && <AppButton label={t('common.cancel')} variant="text" disabled={busy} onPress={() => { workspaceStore.setState(state => ({ hash: geo.hash, precision: state.hash === geo.hash ? state.precision : 0 })); setEditingArea(false); }} />}
      </ScrollView> : null}
      {isComposing && !(mode === 'geo' && editingArea) && <>
        {mode === 'mesh' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <AppButton label={t('bitchat.public')} variant="secondary" fullWidth={false} selected={!recipient} onPress={() => setRecipient(undefined)} />
          {recipient && <AppButton label={`${selectedName} · ${t(selectedOnline ? 'mobile.mesh_online' : 'mobile.mesh_offline')}`} labelNumberOfLines={1} variant="secondary" fullWidth={false} selected onPress={() => router.push('/contacts')} />}
          <AppButton label={t('mobile.contacts')} variant="text" fullWidth={false} onPress={() => router.push('/contacts')} />
        </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' }}><AppText variant="caption" tone="muted">{t('mobile.geo_area_people', { hash: geo.hash, people: geo.present })}</AppText><AppButton label={t('mobile.change_area')} variant="text" fullWidth={false} disabled={busy} onPress={() => setEditingArea(true)} /></View>}
        {mode === 'mesh' && recipient && !selectedOnline && <AppText variant="caption" tone="muted">{t(savedContact?.blocked ? 'mobile.contact_blocked' : savedContact ? 'mobile.mesh_offline_hint' : 'mobile.contact_reconnect_hint')}</AppText>}
        {mode === 'geo' && <FlatList horizontal data={geo.privatePeers} keyExtractor={key => key} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}
          ListHeaderComponent={<AppButton label={t('mobile.public_channel')} variant="secondary" fullWidth={false} selected={!geoRecipient} onPress={() => setPrivateTarget(undefined)} />}
          renderItem={({ item: key }) => <AppButton label={key.slice(0, 8)} variant="secondary" fullWidth={false} selected={geoRecipient === key} onPress={() => setPrivateTarget({ hash: geo.hash, pubkey: key })} />} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <AppText variant="caption" tone="muted">{transportHint}</AppText>
          {active ? <AppButton label={t('bitchat.leave')} variant="text" fullWidth={false} size="sm" disabled={busy} onPress={() => void operate(async () => {
            if (mode === 'mesh') await bitchatService.stop(); else geohashService.stop(); setRecipient(undefined);
          })} /> : <AppButton label={t('mobile.join')} variant="secondary" fullWidth={false} size="sm" loading={busy} disabled={!name.trim() || busy} onPress={() => void operate(join, 'join')} />}
        </View>
        {mode === 'geo' && !geo.privateActive && geoRecipient && <AppText variant="caption" tone="muted">{t('mobile.geo_private_disabled')}</AppText>}
        {mode === 'geo' && geoRecipient && <AppText variant="caption" selectable tone="muted">{geoThread?.head ?? geoRecipient}</AppText>}
        {mode === 'geo' && !geoRecipient && <AppText variant="caption" tone="muted">{t('mobile.channel_rotation_short')}</AppText>}
        {mode === 'geo' && geoRecipient && geoThread?.blocked && <>
          <AppText variant="caption" tone="danger">{t('mobile.channel_identity_expired')}</AppText>
          <AppButton label={t('mobile.channel_identity_recover')} variant="secondary" disabled={busy || !geo.privateActive} onPress={() => void operate(() => geohashService.useCurrentIdentity(geoRecipient))} />
        </>}
        {mode === 'geo' && geoRecipient && geoThread?.migrating && !geoThread.blocked && <AppText variant="caption" tone="muted">{t('mobile.channel_identity_pending')}</AppText>}
        <AppText variant="caption" tone="muted">{t(mode === 'geo' ? geoRecipient ? 'mobile.geo_private_active_notice' : 'mobile.geo_public_notice' : recipient ? 'bitchat.private_notice' : workspace.bridge && !workspace.nearbyOnly ? 'mobile.bridge_notice' : 'bitchat.public_notice')}</AppText>
        {mode === 'mesh' && (workspace.gateway || workspace.bridge) && <AppText variant="caption" tone="muted">
          {t('mobile.bridge_relay_status', { count: mesh.bridgeRelays })}
        </AppText>}
        {mode === 'mesh' && workspace.internet && <AppText variant="caption" tone="muted">
          {t('mobile.private_relay_status', { count: mesh.privateRelays })}
        </AppText>}
        {mode === 'mesh' && recipient && savedContact?.verified && <AppText variant="caption" tone="muted">{t('mobile.verified')}</AppText>}
        {mode === 'mesh' && recipient && fingerprint ? <AppText variant="caption" selectable tone="muted">{t('bitchat.fingerprint', { value: fingerprint })}</AppText> : null}
        <FlatList<BitchatMessage | GeoMessage> ref={listRef} key={draftKey} data={messages} keyExtractor={m => m.id + ('peer' in m ? m.peer : m.pubkey)} keyboardShouldPersistTaps="handled"
          style={{ flex: 1, minHeight: 0 }}
          scrollEventThrottle={100}
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            atLatest.current = isChatAtLatest(layoutMeasurement.height, contentOffset.y, contentSize.height, spacing.xl);
          }}
          onContentSizeChange={() => { if (atLatest.current) listRef.current?.scrollToEnd({ animated: false }); }}
          onLayout={() => { if (atLatest.current) listRef.current?.scrollToEnd({ animated: false }); }}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={messages.length > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <AppButton label={t('mobile.older')} variant="text" size="sm" disabled={busy} onPress={() => void operate(async () => { atLatest.current = false; await (mode === 'mesh' ? bitchatService.older() : geoRecipient ? geohashService.olderPrivate() : geohashService.older()); })} />
            <AppButton label={t('mobile.latest')} variant="text" size="sm" disabled={busy} onPress={() => void operate(async () => { atLatest.current = true; await (mode === 'mesh' ? bitchatService.latest() : geohashService.restore(geo.hash)); listRef.current?.scrollToEnd({ animated: true }); })} />
          </View> : null}
          renderItem={({ item }) => <View style={{ padding: spacing.md, borderRadius: radius.lg, backgroundColor: item.outgoing ? c.accentSoft : c.surface }}>
            <AppText variant="caption" tone="muted" selectable accessibilityLabel={item.name + ('pubkey' in item ? ' · ' + item.pubkey : '')}>{item.name}{'pubkey' in item ? ' · ' + item.pubkey.slice(0, 8) : ''}</AppText><AppText selectable>{item.content}</AppText>
            {'bridge' in item && item.bridge && <AppText variant="caption" tone="muted">{t('mobile.via_bridge')}</AppText>}
            {mode === 'geo' && !geoRecipient && 'pubkey' in item && !item.outgoing && <AppButton label={t('mobile.private_message')} variant="text" fullWidth={false} disabled={busy || !geo.privateActive} onPress={() => setPrivateTarget({ hash: geo.hash, pubkey: item.pubkey })} />}
            {item.outgoing && <AppText variant="caption" tone="muted">{t(mode === 'geo' && item.delivery === 'sent' ? 'mobile.relay_accepted' : `bitchat.${item.delivery}`)}</AppText>}
          </View>}
          ListEmptyComponent={<View style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
            <Radar size={uiDensity.iconButtonSize} color={c.textMuted} /><AppText variant="subtitle">{t('bitchat.empty')}</AppText>
            <AppText tone="muted">{t(mode === 'geo' ? 'mobile.geo_empty_hint' : 'bitchat.empty_hint')}</AppText>
          </View>} />
        {mode === 'mesh' && !recipient && workspace.bridge && <AppButton label={t('mobile.nearby_only')} variant="secondary" selected={workspace.nearbyOnly} disabled={busy} onPress={() => workspaceStore.setState({ nearbyOnly: !workspace.nearbyOnly })} />}
        <AppInput label={t('bitchat.message')} value={draft} onChangeText={setDraft} multiline compactMultiline scrollEnabled maxLength={mode === 'mesh' ? 255 : geoRecipient ? 4096 : MAX_GEO_CONTENT_BYTES} />
        <AppButton label={t(mode === 'mesh' && !recipient && !canSendPublicMesh ? 'mobile.nobody_around' : 'bitchat.send')} loading={working} disabled={(mode === 'mesh' && !!recipient && (!contactsService.get(recipient) || !!savedContact?.blocked)) || (!active && !(mode === 'mesh' && recipient && contactsService.get(recipient))) || (mode === 'mesh' && !recipient && !canSendPublicMesh) || busy || !draft.trim() || bytes(draft).length > (mode === 'mesh' ? 255 : geoRecipient ? 4096 : MAX_GEO_CONTENT_BYTES) || (mode === 'geo' && (geoRecipient ? !geo.privateActive || geoThread?.blocked : !geo.connected && !bitchatService.hasGateway()))}
          onPress={() => void operate(send, 'send')} />
      </>}
      {actionError && <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
        {t(actionError === 'send' ? 'mobile.send_failed' : actionError === 'join' ? (mode === 'mesh' ? 'mobile.mesh_join_failed' : 'mobile.geo_join_failed') : 'mobile.operation_failed')}
      </AppText>}
      {!actionError && workspace.error && <AppText variant="caption" tone="danger">{t('mobile.storage_failed')}</AppText>}
    </KeyboardAvoidingView>
    <ScreenHeader title="Outlink" back={false} right={<AppButton label={t('mobile.settings')} variant="text" onPress={() => router.push('/settings')} />} />
  </AppScreen>;
}
