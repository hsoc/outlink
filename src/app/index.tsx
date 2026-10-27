import { configurePrivateInternet } from '@/services/preferences/internet-private';
import { MessageActions, type MessageAction } from '@/components/common/MessageActions';
import { messageUserKey, socialMessage, privateMessageTarget } from '@/lib/message-actions';
import { blockedUsers, blockedUsersStore } from '@/services/moderation/blocked-users';
import { displayNickname, duplicateNicknames, nicknameKey, nicknameMentionLabels, nicknameBase } from '@/lib/nicknames';
import { unreadPrivateMessages, unreadLocationMessages } from '@/lib/unread-messages';
import { platform } from '@/platform';
import { groupCommand } from '@/services/bitchat/compatibility/group-commands';
import { sessionIntent } from '@/services/history/lifecycle';
import { isChatAtLatest } from '@/lib/chat-scroll';
import { areaRelays } from '@/services/geohash/relay-directory';
import { contactsStore, contactsService, contactAvailable } from '@/services/bitchat/compatibility/contacts';
import { workspaceStore, restoreWorkspace } from '@/services/history/workspace';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { FlatList, ScrollView, View, Keyboard, type NativeScrollEvent, type TextInput } from 'react-native';
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
import { appendMention, mentionMatcher } from '@/lib/mentions';
import { panicWipe } from '@/services/bitchat/panic';
import { QuickEraseButton } from '@/components/bitchat/QuickEraseButton';
import { normalizeGeohash } from '@/services/geohash/geohash';
import { ensureNickname, nicknameStore } from '@/services/preferences/nickname';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

export default function Chats() {
  const { t } = useTranslation(), c = useThemeColors(), top = useScreenHeaderClearance();
  const savedContacts = useStore(contactsStore, state => state.contacts);
  const mesh = useStore(bitchatSessionStore), geo = useStore(geohashStore);
  const blocked = useStore(blockedUsersStore, s => s.users);
  const blockedKeys = useMemo(() => {
    const keys = new Set(blocked.map(user => user.key));
    for (const contact of savedContacts) if (contact.blocked) keys.add('mesh:' + contact.id);
    for (const thread of geo.privateThreads) if (thread.keys.some(key => keys.has('nostr:' + key))) for (const key of thread.keys) keys.add('nostr:' + key);
    return keys;
  }, [blocked, savedContacts, geo.privateThreads]);
  const unread = useMemo(() => unreadPrivateMessages(mesh.messages, new Set([...blockedKeys].filter(key => key.startsWith('mesh:')).map(key => key.slice(5)))), [mesh.messages, blockedKeys]);
  const geoUnread = useMemo(() => unreadLocationMessages(geo.privateMessages.filter(message => !blockedKeys.has(messageUserKey(message))), geo.privateThreads), [geo.privateMessages, geo.privateThreads, blockedKeys]);
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
  const name = useStore(nicknameStore, state => state.name);
  const nearbyDuplicates = useMemo(() => duplicateNicknames(mesh.active ? [{ name, identity: mesh.id }, ...mesh.peers.filter(p => p.lastSeen > 0).map(p => ({ name: p.name, identity: p.id }))] : []), [mesh.active, mesh.id, mesh.peers, name]);
  const duplicates = useMemo(() => mode === 'mesh' ? nearbyDuplicates : duplicateNicknames(geo.connected ? [{ name, identity: geo.publicIdentity }, ...geo.participants] : []), [mode, nearbyDuplicates, name, geo.connected, geo.publicIdentity, geo.participants]);
  const [messageMenu, setMessageMenu] = useState<{ message: BitchatMessage | GeoMessage; name: string; scope: string; epoch: number }>();
  const longPressed = useRef(false), menuConsumed = useRef(false);
  useFocusEffect(useCallback(() => {
    const remove = platform.appState.addChangeListener(state => { if (state !== 'active') setMessageMenu(undefined); });
    return () => { remove(); setMessageMenu(undefined); };
  }, []));
  const composerRef = useRef<TextInput>(null);
  const [ready, setReady] = useState(false);
  const ownIdentities = mode === 'mesh' ? [mesh.id, ...bitchatService.nicknameIdentities()].join(',') : geo.publicIdentity;
  const mentioned = useMemo(() => { const matches = [mentionMatcher(name), ...ownIdentities.split(',').filter(Boolean).flatMap(id => nicknameMentionLabels(name, id).map(mentionMatcher))]; return (content: string) => matches.some(match => match(content)); }, [name, ownIdentities]);
  const [working, setWorking] = useState(false), [editingArea, setEditingArea] = useState(false);
  const [wiping, setWiping] = useState(false), [wipeStatus, setWipeStatus] = useState<'done' | 'failed' | null>(null);
  const wipingRef = useRef(false);
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
  const userScrolling = useRef(false);
  const recordScrollPosition = (event: NativeScrollEvent) => {
    const { layoutMeasurement, contentOffset, contentSize } = event;
    atLatest.current = isChatAtLatest(layoutMeasurement.height, contentOffset.y, contentSize.height, spacing.xl);
  };
  useEffect(() => { atLatest.current = true; userScrolling.current = false; }, [mode, recipient, geoRecipient, geo.hash]);
  const messages = useMemo(() => (mode === 'geo' ? geoRecipient ? geo.privateMessages.filter(m => m.channelThread === geoRecipient || m.peer === geoRecipient || m.recipient === geoRecipient) : geo.messages : mesh.messages.filter(m => recipient ?
    m.recipient && (m.peer === recipient || m.recipient === recipient) : !m.recipient)).filter(m => !blockedKeys.has(messageUserKey(m))), [blockedKeys, mode, recipient, mesh.messages, geo.messages, geo.privateMessages, geoRecipient]);
  useEffect(() => {
    let alive = true;
    void Promise.all([blockedUsers.restore(), ensureNickname(), restoreWorkspace(), bitchatService.restore(), contactsService.restore()]).then(async () => {
      const savedHash = workspaceStore.getState().hash;
      if (savedHash) await geohashService.restore(savedHash).catch(() => {});
      if (alive) setReady(true);
    }).catch(() => { if (alive) { setReady(true); setActionError('other'); } });
    return () => { alive = false; };
  }, [t]);
  useFocusEffect(useCallback(() => {
    if (mode !== 'mesh' || !recipient) return;
    const markRead = () => {
      if (platform.appState.currentState() !== 'active') return;
      for (const message of mesh.messages) if (!message.outgoing && message.recipient && message.peer === recipient && message.delivery === 'delivered')
        void bitchatService.read(recipient, message.id).catch(() => {});
    };
    markRead();
    return platform.appState.addChangeListener(markRead);
  }, [mode, recipient, mesh.messages]));
  useFocusEffect(useCallback(() => {
    if (mode !== 'geo' || !geoRecipient || !geo.privateActive) return;
    const markRead = () => {
      if (platform.appState.currentState() !== 'active') return;
      for (const message of geo.privateMessages) if (!message.outgoing && (message.channelThread === geoRecipient || geohashService.privatePeer(message.peer) === geoRecipient) && message.delivery === 'delivered') void geohashService.readPrivate(geoRecipient, message.id, message.peer).catch(() => {});
    };
    markRead();
    return platform.appState.addChangeListener(markRead);
  }, [mode, geoRecipient, geo.privateActive, geo.privateMessages]));
  async function operate(task: () => Promise<void>, action: 'join' | 'send' | 'other' = 'other') {
    if (working) return;
    setWorking(true); setActionError(null);
    try { await task(); } catch { setActionError(action); } finally { setWorking(false); }
  }
  useFocusEffect(useCallback(() => {
    let alive = true;
    void ensureNickname().catch(() => { if (alive) setActionError('other'); });
    return () => { alive = false; };
  }, []));
  const quickErase = useCallback(() => {
    if (wipingRef.current) return;
    wipingRef.current = true; ++areaRequest.current;
    setMessageMenu(undefined); longPressed.current = false;
    setWiping(true); setWipeStatus(null); setActionError(null);
    void (async () => {
      try {
        await panicWipe();
        setPrivateTarget(undefined); setEditingArea(false); setWorking(false); setActionError(null);
        setWipeStatus('done');
        try { await ensureNickname(); } catch { setActionError('other'); }
      } catch { setWipeStatus('failed'); }
      finally { wipingRef.current = false; setWiping(false); }
    })();
  }, []);
  async function selectArea(precision: number) {
    const request = ++areaRequest.current, intent = sessionIntent();
    const { hash, neighborhood } = await geohashService.nearby(precision);
    if (request !== areaRequest.current || intent !== sessionIntent()) return;
    workspaceStore.setState(state => ({ hash, precision, bridgeCell: state.bridgeCell.trim() ? state.bridgeCell : neighborhood }));
  }
  async function join() {
    const intent = sessionIntent();
    const value = await ensureNickname();
    const identity = mode === 'mesh' ? await mobileIdentity() : undefined;
    if (intent !== sessionIntent()) throw new Error('Join canceled');
    if (identity) await bitchatService.start(identity, value);
    else { await geohashService.join(hash, value, workspace.autoAreaRelays ? areaRelays(hash) : relays.split(/\s+/).filter(Boolean)); await bitchatService.refreshNetwork(); setEditingArea(false); }
  }
  async function messageAction(action: MessageAction) {
    if (menuConsumed.current) return;
    menuConsumed.current = true;
    const target = messageMenu; setMessageMenu(undefined);
    if (!target || target.epoch !== sessionIntent() || target.scope !== draftKey) return;
    const item = target.message, key = messageUserKey(item);
    await operate(async () => {
      if (action === 'copy') { await platform.clipboard.writeText(item.content); return; }
      if (item.outgoing) return;
      if (action === 'block') {
        const identity = key.slice(key.indexOf(':') + 1);
        const thread = key.startsWith('nostr:') ? geo.privateThreads.find(t => t.peer === identity || t.keys.includes(identity)) : undefined;
        await blockedUsers.set([key, ...(thread?.keys ?? []).map(id => 'nostr:' + id)], nicknameBase(target.name), true); return;
      }
      if (action === 'message') {
        const destination = privateMessageTarget(item, mode);
        if (destination.kind === 'geo') setPrivateTarget({ hash: geo.hash, pubkey: destination.peer });
        else if (destination.kind === 'mesh') {
          await bitchatService.preparePrivateConversation(destination.peer);
          if (target.epoch === sessionIntent()) setRecipient(destination.peer);
        } else if (await platform.confirmationDialog.confirm(t('mobile.message_action_message'), t('mobile.bridge_dm_unavailable'), t('common.cancel'), t('mobile.contacts'))) {
          if (target.epoch === sessionIntent()) router.push('/contacts');
        }
        return;
      }
      const content = socialMessage(action, target.name);
      if (mode === 'mesh') await bitchatService.send(content, recipient, workspace.nearbyOnly);
      else if (geoRecipient) await geohashService.sendPrivate(geoRecipient, content);
      else await geohashService.send(content);
    });
  }
  async function send() {
    if (/^(?:cashu:)?cashu[AB]|^OLC1:/.test(draft.trim())) throw new Error('Use Cashu transfers for tokens');
    atLatest.current = true;
    userScrolling.current = false;
    listRef.current?.scrollToEnd({ animated: false });
    const command = mode === 'mesh' ? groupCommand(draft) : null;
    if (command) {
      if (command.action === 'create') { const id = await bitchatService.createGroup(command.argument); router.push({ pathname: '/groups', params: { id } }); }
      else if (command.action === 'list') router.push('/groups');
      else throw new Error('Select a private group for this command');
    } else if (mode === 'mesh') await bitchatService.send(draft, recipient, workspace.nearbyOnly);
    else if (geoRecipient) await geohashService.sendPrivate(geoRecipient, draft);
    else await geohashService.send(draft);
    workspaceStore.setState(state => state.drafts[draftKey] === draft ? { drafts: { ...state.drafts, [draftKey]: '' }, ...(mode === 'mesh' && !recipient ? { nearbyOnly: false } : {}) } : state);
  }
  // Disconnected peers are marked lastSeen=0 by BitchatSession; avoid a clock read during render.
  const onlinePeerCount = mesh.peers.filter(p => p.lastSeen > 0).length;
  const hasMeshPeers = onlinePeerCount > 0;
  const groupAction = mode === 'mesh' && /^\/group(?:\s|$)/i.test(draft.trim());
  const canSendPublicMesh = groupAction && mesh.active || hasMeshPeers || (workspace.bridge && !workspace.nearbyOnly);
  const isComposing = active || (mode === 'mesh' ? mesh.messages.length > 0 || savedContacts.length > 0 || !!recipient : geo.messages.length > 0 || geo.privateMessages.length > 0 || geo.privatePeers.length > 0);
  const transportHint = mode === 'mesh'
    ? `Bluetooth · ${mesh.active ? (hasMeshPeers ? t('mobile.mesh_connected', { count: onlinePeerCount }) : t('mobile.mesh_searching')) : t('mobile.disconnected')}`
    : `Internet · ${geo.connected > 0 ? t('mobile.relays_connected', { count: geo.connected }) : t('mobile.relays_disconnected')}`;
  if (!ready) return <AppScreen><AppText>Outlink</AppText></AppScreen>;
  return <AppScreen edges={['bottom']}>
    {messageMenu && messageMenu.scope === draftKey && !wiping && <MessageActions name={messageMenu.name} own={messageMenu.message.outgoing}
      canMessage={!busy}
      canPost={!busy && active && (mode === 'mesh' ? !!recipient || hasMeshPeers || workspace.bridge && !workspace.nearbyOnly : !!geoRecipient ? geo.privateActive && !geoThread?.blocked : !!geo.connected)}
      onAction={action => void messageAction(action)} onClose={() => setMessageMenu(undefined)} />}
    {wiping || wipeStatus === 'failed' ? <View style={{ paddingTop: top, paddingHorizontal: spacing.lg }}>
      <AppText tone={wiping ? 'muted' : 'danger'} accessibilityLiveRegion="assertive">{t(wiping ? 'mobile.quick_erasing' : 'mobile.quick_erase_failed')}</AppText>
    </View> : <KeyboardAvoidingView behavior="padding" style={{ flex: 1, paddingTop: top, paddingHorizontal: spacing.lg, gap: spacing.sm, minHeight: 0 }}>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        {(['mesh', 'geo'] as const).map(value => <AppButton key={value} label={t(`mobile.${value}`)} variant="secondary"
          fullWidth={false} selected={mode === value} disabled={busy} onPress={() => { setMode(value); setActionError(null); }} />)}
      </View>
      {unread.size > 0 && <View style={{ gap: spacing.xs }}>
        <AppText variant="caption" tone="accent" accessibilityLiveRegion="polite">{t('mobile.unread_private_messages')}</AppText>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
          {[...unread].map(([id, entry]) => <AppButton key={id} variant="secondary" fullWidth={false}
            label={t('mobile.unread_private_sender', { name: displayNickname(entry.name, id, nearbyDuplicates.has(nicknameKey(entry.name))), count: entry.count })}
            onPress={() => { setMode('mesh'); setRecipient(id); }} />)}
        </ScrollView>
      </View>}
      {geoUnread.size > 0 && <View style={{ gap: spacing.xs }}>
        <AppText variant="caption" tone="accent" accessibilityLiveRegion="polite">{t('mobile.unread_location_messages')}</AppText>
        <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.sm }}>
          {[...geoUnread].map(([id, entry]) => <AppButton key={id} variant="secondary" fullWidth={false}
            label={t('mobile.unread_private_sender', { name: entry.name, count: entry.count })}
            onPress={() => { workspaceStore.setState(state => ({ mode: 'geo', hash: geo.hash, precision: state.hash === geo.hash ? state.precision : 0 })); setPrivateTarget({ hash: geo.hash, pubkey: id }); setEditingArea(false); }} />)}
        </ScrollView>
      </View>}
      {(mode === 'geo' && editingArea) || (!active && !isComposing) ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.lg }}>
        <Radar size={uiDensity.iconButtonSize} color={c.textMuted} />
        <AppText variant="title">{t(mode === 'mesh' ? 'bitchat.title' : 'mobile.geo')}</AppText>
        <AppText tone="muted">{t(mode === 'mesh' ? 'mobile.mesh_privacy' : 'mobile.geo_privacy')}</AppText>
        {mode === 'geo' && <>
          <AppText variant="caption" tone="muted">{t('mobile.area_picker_title')}</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {[3, 4, 5, 6, 7].map(value => <AppButton key={value} label={t('mobile.area_preset', { area: t(`mobile.precision_${value}`), size: t(`mobile.area_size_${value}`) })} fullWidth={false} variant="secondary"
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
        {mode === 'mesh' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <AppButton label={t('bitchat.public')} variant="secondary" fullWidth={false} selected={!recipient} onPress={() => setRecipient(undefined)} />
          {recipient && <AppButton label={`${displayNickname(selectedName ?? t('mobile.unknown_nickname'), recipient ?? '', duplicates.has(nicknameKey(selectedName ?? '')))} · ${t(selectedOnline ? 'mobile.mesh_online' : 'mobile.mesh_offline')}`} labelNumberOfLines={1} variant="secondary" fullWidth={false} selected onPress={() => router.push('/contacts')} />}
          <AppButton label={t('groups.title')} variant="text" fullWidth={false} onPress={() => router.push('/groups')} />
          <AppButton label={t('mobile.contacts')} variant="text" fullWidth={false} onPress={() => router.push('/contacts')} />
        </View>}
        {mode === 'geo' && <View style={{ gap: spacing.xs }}>
          <AppText variant="caption" weight="semibold" tone={geo.connected > 0 ? 'accent' : 'muted'}>
            {t(geo.connected > 0 ? 'mobile.geo_active_count' : 'mobile.geo_active_unavailable', { count: geo.present })}
          </AppText>
          {geo.connected > 0 && <AppText variant="caption" tone="muted">{t('mobile.geo_active_hint')}</AppText>}
        </View>}
        {mode === 'mesh' && recipient && (!selectedOnline || !savedContact) && <AppText variant="caption" tone="muted">{t(savedContact?.blocked ? 'mobile.contact_blocked' : savedContact ? 'mobile.mesh_offline_hint' : 'mobile.contact_reconnect_hint')}</AppText>}
        {mode === 'geo' && <FlatList horizontal data={geo.privatePeers} keyExtractor={key => key} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}
          ListHeaderComponent={<AppButton label={`#${geo.hash}`} accessibilityLabel={`${t('mobile.public_channel')} · #${geo.hash}`} labelNumberOfLines={1} accessibilityHint={t('mobile.change_area')} variant="secondary" fullWidth={false} selected={!geoRecipient} disabled={busy} onPress={() => { setPrivateTarget(undefined); setEditingArea(true); }} />}
          renderItem={({ item: key }) => <AppButton label={geoUnread.has(key) ? t('mobile.unread_private_sender', { name: key.slice(0, 8), count: geoUnread.get(key)!.count }) : key.slice(0, 8)} variant="secondary" fullWidth={false} selected={geoRecipient === key} onPress={() => setPrivateTarget({ hash: geo.hash, pubkey: key })} />} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <AppText variant="caption" tone="muted">{transportHint}</AppText>
          {active ? <AppButton label={t('bitchat.leave')} variant="text" fullWidth={false} size="sm" disabled={busy} onPress={() => void operate(async () => {
            if (mode === 'mesh') await bitchatService.stop(); else geohashService.stop(); setRecipient(undefined);
          })} /> : <AppButton label={t('mobile.join')} variant="secondary" fullWidth={false} size="sm" loading={busy} disabled={!name.trim() || busy} onPress={() => void operate(join, 'join')} />}
        </View>
        {mode === 'geo' && !geo.privateActive && geoRecipient && <View style={{ gap: spacing.sm }}>
          <AppText variant="caption" tone="muted">{t('mobile.geo_private_disabled')}</AppText>
          <AppText variant="caption" tone="muted">{t('mobile.internet_private_hint')}</AppText>
          <AppButton label={t(workspace.internet ? 'mobile.retry_private_messaging' : 'mobile.enable_private_messaging')} variant="secondary" disabled={busy || !geo.active} onPress={() => void operate(() => configurePrivateInternet(true))} />
        </View>}
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
          onScrollBeginDrag={() => { userScrolling.current = true; }}
          onScrollEndDrag={({ nativeEvent }) => { recordScrollPosition(nativeEvent); userScrolling.current = false; }}
          onMomentumScrollBegin={() => { userScrolling.current = true; }}
          onMomentumScrollEnd={({ nativeEvent }) => { recordScrollPosition(nativeEvent); userScrolling.current = false; }}
          onScroll={({ nativeEvent }) => {
            // Layout/content changes also emit scroll events; only a gesture changes follow intent.
            if (!userScrolling.current) return;
            recordScrollPosition(nativeEvent);
          }}
          onContentSizeChange={() => { if (atLatest.current) listRef.current?.scrollToEnd({ animated: false }); }}
          onLayout={() => { if (atLatest.current) listRef.current?.scrollToEnd({ animated: false }); }}
          contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md, flexGrow: 1 }}
          ListHeaderComponent={messages.length > 0 ? <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <AppButton label={t('mobile.older')} variant="text" size="sm" disabled={busy} onPress={() => void operate(async () => { atLatest.current = false; await (mode === 'mesh' ? bitchatService.older() : geoRecipient ? geohashService.olderPrivate() : geohashService.older()); })} />
            <AppButton label={t('mobile.latest')} variant="text" size="sm" disabled={busy} onPress={() => void operate(async () => { atLatest.current = true; await (mode === 'mesh' ? bitchatService.latest() : geohashService.restore(geo.hash)); listRef.current?.scrollToEnd({ animated: true }); })} />
          </View> : null}
          renderItem={({ item }) => {
            const publicChat = mode === 'mesh' ? !recipient : !geoRecipient;
            const canMention = !item.outgoing;
            const displayName = displayNickname(item.name, 'pubkey' in item ? item.pubkey : item.bridge?.pubkey ?? item.peer, duplicates.has(nicknameKey(item.name)));
            const mentionName = displayName;
            const isMentioned = publicChat && canMention && mentioned(item.content);
            const openMenu = () => { if (busy) return; menuConsumed.current = false; longPressed.current = true; Keyboard.dismiss(); setMessageMenu({ message: item, name: displayName, scope: draftKey, epoch: sessionIntent() }); };
            const insertMention = () => { if (longPressed.current) return; setDraft(appendMention(workspaceStore.getState().drafts[draftKey] ?? '', mentionName)); composerRef.current?.focus(); };
            return <View style={{
            alignSelf: item.outgoing ? 'flex-end' : 'flex-start', maxWidth: uiDensity.messageBubbleMaxWidth,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs,
            borderWidth: isMentioned ? uiDensity.selectedControlRingWidth : 0, borderColor: c.accent,
            borderRadius: radius.xl,
            borderEndStartRadius: item.outgoing ? radius.xl : radius.xs,
            borderEndEndRadius: item.outgoing ? radius.xs : radius.xl,
            backgroundColor: item.outgoing ? c.accentSoft : c.surfaceElevated,
          }}>
            <AppText variant="caption" tone={canMention ? 'accent' : 'muted'} selectable={!canMention}
              accessibilityRole={canMention ? 'button' : undefined}
              accessibilityLabel={(canMention ? t('mobile.mention_name', { name: mentionName }) : displayName) + ('pubkey' in item ? ' · ' + item.pubkey : '')}
              onPressIn={() => { longPressed.current = false; }} onPress={canMention ? insertMention : undefined}>{displayName}</AppText>
            {isMentioned && <AppText variant="caption" tone="accent">{t('mobile.mentioned_you')}</AppText>}
            <AppText selectable={false} onPressIn={() => { longPressed.current = false; }}
              onLongPress={openMenu}
              accessibilityRole="button" accessibilityActions={[{ name: 'longpress', label: t('mobile.message_actions') }]}
              onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'longpress') openMenu(); }}
              onPress={canMention ? insertMention : undefined}
              accessibilityHint={t(item.outgoing ? 'mobile.own_message_menu_hint' : 'mobile.message_menu_hint')}>{item.content}</AppText>
            {'bridge' in item && item.bridge && <AppText variant="caption" tone="muted">{t('mobile.via_bridge')}</AppText>}
            {item.outgoing && <AppText variant="caption" tone="muted" align="end">{t(mode === 'geo' && item.delivery === 'sent' ? 'mobile.relay_accepted' : `bitchat.${item.delivery}`)}</AppText>}
          </View>; }}
          ListEmptyComponent={<View style={{ gap: spacing.md, paddingVertical: spacing.lg }}>
            <Radar size={uiDensity.iconButtonSize} color={c.textMuted} /><AppText variant="subtitle">{t('bitchat.empty')}</AppText>
            <AppText tone="muted">{t(mode === 'geo' ? 'mobile.geo_empty_hint' : 'bitchat.empty_hint')}</AppText>
          </View>} />
        {mode === 'mesh' && !recipient && workspace.bridge && <AppButton label={t('mobile.nearby_only')} variant="secondary" selected={workspace.nearbyOnly} disabled={busy} onPress={() => workspaceStore.setState({ nearbyOnly: !workspace.nearbyOnly })} />}
        {mode === 'mesh' && recipient && <AppButton label={t('cashu.title')} variant="secondary" disabled={busy} onPress={() => router.push({ pathname: '/payments', params: { peer: recipient } })} />}
        <AppInput ref={composerRef} label={t('bitchat.message')} value={draft} onChangeText={setDraft} multiline compactMultiline scrollEnabled maxLength={mode === 'mesh' ? 255 : geoRecipient ? 4096 : MAX_GEO_CONTENT_BYTES} />
        <AppButton label={t(mode === 'mesh' && !recipient && !canSendPublicMesh ? 'mobile.nobody_around' : 'bitchat.send')} loading={working} disabled={(mode === 'mesh' && !!recipient && (!contactsService.get(recipient) || !!savedContact?.blocked)) || (!active && !(mode === 'mesh' && recipient && contactsService.get(recipient))) || (mode === 'mesh' && !recipient && !canSendPublicMesh) || busy || !draft.trim() || bytes(draft).length > (mode === 'mesh' ? 255 : geoRecipient ? 4096 : MAX_GEO_CONTENT_BYTES) || (mode === 'geo' && (geoRecipient ? !geo.privateActive || geoThread?.blocked : !geo.connected && !bitchatService.hasGateway()))}
          onPress={() => void operate(send, 'send')} />
      </>}
      {actionError && <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
        {t(actionError === 'send' ? 'mobile.send_failed' : actionError === 'join' ? (mode === 'mesh' ? 'mobile.mesh_join_failed' : 'mobile.geo_join_failed') : 'mobile.operation_failed')}
      </AppText>}
      {!actionError && workspace.error && <AppText variant="caption" tone="danger">{t('mobile.storage_failed')}</AppText>}
      {wipeStatus === 'done' && <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">{t('mobile.wipe_done')}</AppText>}
    </KeyboardAvoidingView>}
    <ScreenHeader back={false} left={<View><QuickEraseButton onErase={quickErase} busy={wiping} /></View>} right={<AppButton label={t('mobile.settings')} variant="text" disabled={wiping} onPress={() => router.push('/settings')} />} />
  </AppScreen>;
}
