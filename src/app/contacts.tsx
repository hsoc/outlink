import { blockedUsersStore } from '@/services/moderation/blocked-users';
import { unreadPrivateMessages } from '@/lib/unread-messages';
import { displayNickname, duplicateNicknames, nicknameKey } from '@/lib/nicknames';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { ContactSettings } from '@/components/bitchat/ContactSettings';
import { contactsService, contactsStore, isSavedContact } from '@/services/bitchat/compatibility/contacts';
import { contactDirectory, type ContactDirectoryEntry, type ContactDirectoryTab } from '@/services/bitchat/compatibility/contact-directory';
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { nicknameStore } from '@/services/preferences/nickname';
import { workspaceStore } from '@/services/history/workspace';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

type Action = 'open' | 'save' | 'unsave' | 'favorite' | 'block' | 'ping';
type RowProps = { entry: ContactDirectoryEntry; busy: boolean; duplicate: boolean; unread: number; onAction(id: string, action: Action): void };
const ContactRow = memo(function ContactRow({ entry, busy, duplicate, unread, onAction }: RowProps) {
  const { t } = useTranslation(), c = useThemeColors(), contact = entry.contact;
  return <View style={{ padding: spacing.md, gap: spacing.sm, backgroundColor: c.surface, borderRadius: radius.lg }}>
    <AppText variant="subtitle" numberOfLines={1}>{displayNickname(entry.name, entry.id, duplicate)}</AppText>
    {unread > 0 && <AppText tone="accent">{t('mobile.unread_private_count', { count: unread })}</AppText>}
    <AppText variant="caption" tone="muted">{t(entry.online ? 'mobile.mesh_online' : 'mobile.mesh_offline')}
      {contact?.blocked ? ` · ${t('mobile.contact_blocked')}` : contact && isSavedContact(contact) ? ` · ${t('mobile.saved_contact_status')}` : ''}</AppText>
    {contact && <AppText variant="caption" tone="muted">{t(contact.verified ? 'mobile.verified' : 'mobile.unverified')}</AppText>}
    {contact && <AppText variant="caption" tone="muted" selectable>{contact.fingerprint}</AppText>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      <AppButton label={t('mobile.message_action_message')} variant="secondary" fullWidth={false} disabled={busy || contact?.blocked} onPress={() => onAction(entry.id, 'open')} />
      {contact && <>
        {!isSavedContact(contact) && <AppButton label={t('mobile.save_contact')} variant="text" fullWidth={false} disabled={busy} onPress={() => onAction(entry.id, 'save')} />}
        {contact.saved && !contact.favorite && !contact.verified && !contact.blocked && <AppButton label={t('mobile.unsave_contact')} variant="text" fullWidth={false} disabled={busy} onPress={() => onAction(entry.id, 'unsave')} />}
        <AppButton label={t(contact.favorite ? 'mobile.unfavorite' : 'mobile.favorite')} variant="text" fullWidth={false} disabled={busy || contact.blocked} onPress={() => onAction(entry.id, 'favorite')} />
        <AppButton label={t(contact.blocked ? 'mobile.unblock' : 'mobile.block')} variant="text" fullWidth={false} disabled={busy} onPress={() => onAction(entry.id, 'block')} />
        <AppButton label={t('mobile.check_connection')} variant="text" fullWidth={false} disabled={busy || !entry.online || contact.blocked} onPress={() => onAction(entry.id, 'ping')} />
      </>}
    </View>
  </View>;
}, (a, b) => a.unread === b.unread && a.duplicate === b.duplicate && a.busy === b.busy && a.onAction === b.onAction && a.entry.id === b.entry.id && a.entry.name === b.entry.name && a.entry.online === b.entry.online && a.entry.contact === b.entry.contact);

export default function Contacts() {
  const { t } = useTranslation(), c = useThemeColors(), top = useScreenHeaderClearance();
  const contacts = useStore(contactsStore), mesh = useStore(bitchatSessionStore);
  const name = useStore(nicknameStore, s => s.name);
  const duplicates = useMemo(() => duplicateNicknames(mesh.active ? [{ name, identity: mesh.id }, ...mesh.peers.filter(p => p.lastSeen > 0).map(p => ({ name: p.name, identity: p.id }))] : []), [mesh.active, mesh.id, mesh.peers, name]);
  const [tab, setTab] = useState<ContactDirectoryTab>('mesh'), [query, setQuery] = useState('');
  const [sharing, setSharing] = useState(false), [codeBusy, setCodeBusy] = useState(false), [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false), [diagnostic, setDiagnostic] = useState<{ name: string; identity: string; ms: number; hops?: number }>();
  const working = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useFocusEffect(useCallback(() => { void Promise.all([contactsService.restore().then(() => contactsService.prune()), bitchatService.restore()]).catch(() => { if (mounted.current) setFailed(true); }); }, []));
  const blockedUsers = useStore(blockedUsersStore, state => state.users);
  const unread = useMemo(() => unreadPrivateMessages(mesh.messages, new Set([...contacts.contacts.filter(c => c.blocked).map(c => c.id), ...blockedUsers.filter(user => user.key.startsWith('mesh:')).map(user => user.key.slice(5))])), [mesh.messages, contacts.contacts, blockedUsers]);
  const entries = useMemo(() => contactDirectory(contacts.contacts, mesh.peers, mesh.messages, mesh.active, tab, query), [contacts.contacts, mesh.peers, mesh.messages, mesh.active, tab, query]);
  const onAction = useCallback((id: string, action: Action) => {
    if (working.current) return;
    working.current = true; setBusy(true); setFailed(false); setDiagnostic(undefined);
    void (async () => {
      await contactsService.idle();
      const contact = contactsService.get(id);
      if (action === 'open') {
        if (contact?.blocked) throw new Error('Contact is blocked');
        workspaceStore.setState({ mode: 'mesh', recipient: id }); router.dismissTo('/'); return;
      }
      if (!contact) throw new Error('Rediscover or import this contact');
      if (action === 'save') await contactsService.save(contact);
      if (action === 'unsave') await contactsService.upsert(id, current => ({ ...(current ?? contact), saved: false, expiresAt: Date.now() + 86400000 }));
      if (action === 'favorite') await bitchatService.favorite(id, !contact.favorite);
      if (action === 'block') await contactsService.upsert(id, current => ({ ...(current ?? contact), blocked: !contact.blocked }));
      if (action === 'ping') {
        const result = await bitchatService.ping(id);
        if (mounted.current) setDiagnostic({ name: contact.name, identity: contact.fingerprint, ms: result.rttMs, hops: result.hops });
      }
    })().catch(() => { if (mounted.current) setFailed(true); }).finally(() => {
      working.current = false; if (mounted.current) setBusy(false);
    });
  }, []);
  return <AppScreen edges={['bottom']}>
    <FlatList data={contacts.ready ? entries : []} keyExtractor={entry => entry.id}
      contentContainerStyle={{ padding: spacing.lg, paddingTop: top, gap: spacing.md }} keyboardShouldPersistTaps="handled"
      initialNumToRender={10} maxToRenderPerBatch={10} windowSize={7}
      ListHeaderComponent={<View style={{ gap: spacing.md }}>
        <AppButton label={t('mobile.add_share_contact')} variant="secondary" selected={sharing} disabled={busy || codeBusy} onPress={() => setSharing(value => !value)} />
        {sharing && <ContactSettings onBusyChange={setCodeBusy} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {(['mesh', 'saved', 'recent'] as const).map(value => <AppButton key={value} label={t(value === 'mesh' ? 'mobile.mesh_online' : value === 'saved' ? 'mobile.saved_contacts' : 'mobile.recent_conversations')} variant="secondary" fullWidth={false} selected={tab === value} onPress={() => setTab(value)} />)}
        </View>
        <AppInput label={t('mobile.find_contact')} value={query} onChangeText={setQuery} maxLength={64} />
        <AppText variant="caption" tone="muted">{t('mobile.contact_retention_hint')}</AppText>
        {failed && <AppText tone="danger" accessibilityLiveRegion="polite">{t('mobile.failed')}</AppText>}
        {diagnostic && <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">{t('mobile.connection_result', { ...diagnostic, name: displayNickname(diagnostic.name, diagnostic.identity, duplicates.has(nicknameKey(diagnostic.name))) })}</AppText>}
      </View>}
      renderItem={({ item }) => <ContactRow unread={unread.get(item.id)?.count ?? 0} duplicate={duplicates.has(nicknameKey(item.name))} entry={item} busy={busy || codeBusy} onAction={onAction} />}
      ListEmptyComponent={contacts.ready ? <View style={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
        <Radar size={uiDensity.iconButtonSize} color={c.textMuted} /><AppText variant="subtitle">{t('mobile.no_contacts')}</AppText>
        <AppText tone="muted">{t('mobile.no_contacts_hint')}</AppText>
      </View> : <AppText tone="muted">{t('mobile.loading_contacts')}</AppText>} />
    <ScreenHeader title={t('mobile.contacts')} />
  </AppScreen>;
}
