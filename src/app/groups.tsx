import { displayNickname, duplicateNicknames, nicknameKey } from '@/lib/nicknames';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams } from 'expo-router';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react-native';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { bitchatService, bitchatSessionStore, meshGroupsStore } from '@/services/bitchat/bitchat.service';
import { type GroupMessage } from '@/services/bitchat/compatibility/group-runtime';
import { groupCommand } from '@/services/bitchat/compatibility/group-commands';
import { contactsStore } from '@/services/bitchat/compatibility/contacts';
import { workspaceStore } from '@/services/history/workspace';
import { nicknameStore } from '@/services/preferences/nickname';
import { platform } from '@/platform';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

export default function Groups() {
  const self = useStore(meshGroupsStore, s => s.self), ready = useStore(workspaceStore, s => s.ready);
  const { t } = useTranslation();
  // Identity erasure unmounts local drafts, selectors and loaded history immediately.
  return ready ? <GroupScreen key={self} /> : <AppScreen><AppText>{t('mobile.quick_erasing')}</AppText></AppScreen>;
}
function GroupScreen() {
  const { t } = useTranslation(), c = useThemeColors(), top = useScreenHeaderClearance();
  const state = useStore(meshGroupsStore), mesh = useStore(bitchatSessionStore), contacts = useStore(contactsStore, s => s.contacts);
  const ownName = useStore(nicknameStore, s => s.name);
  const params = useLocalSearchParams<{ id?: string }>();
  const [selected, setSelected] = useState<string | undefined>(params.id), [name, setName] = useState('');
  const draftKey = `group:${selected ?? ''}`;
  const draft = useStore(workspaceStore, s => s.drafts[draftKey] ?? '');
  const setDraft = (value: string) => workspaceStore.setState(s => ({ drafts: { ...s.drafts, [draftKey]: value } }));
  const [members, setMembers] = useState(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [older, setOlder] = useState<GroupMessage[]>([]), [before, setBefore] = useState<number>();
  const [loadedFor, setLoadedFor] = useState('');
  const historyKey = `${selected}:${state.self}:${state.historyEpoch}`;
  const working = useRef(false), revision = useRef(0);
  const group = state.groups.find(g => g.id === selected), creator = group?.creator === state.self;
  const duplicates = useMemo(() => duplicateNicknames(mesh.active ? (group?.members ?? []).filter(m => m.fingerprint === state.self || mesh.peers.some(p => p.fingerprint === m.fingerprint && p.lastSeen > 0)).map(m => ({ name: m.nickname, identity: m.fingerprint })) : []), [mesh.active, mesh.peers, group, state.self]);
  const nearbyDuplicates = useMemo(() => duplicateNicknames(mesh.active ? [...mesh.peers.filter(p => p.lastSeen > 0).map(p => ({ name: p.name, identity: p.id })), { name: ownName, identity: mesh.id }] : []), [mesh.active, mesh.peers, ownName, mesh.id]);
  useEffect(() => {
    let alive = true; ++revision.current;
    void (async () => {
      const result = selected ? await bitchatService.groupHistory(selected) : { messages: [], before: undefined };
      if (alive) { setOlder(result.messages); setBefore(result.before); setLoadedFor(historyKey); }
    })().catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [selected, historyKey]);
  const messages = useMemo(() => {
    const map = new Map((loadedFor === historyKey ? older : []).map(m => [m.sender + ':' + m.id, m]));
    for (const m of state.messages) if (m.group === selected) map.set(m.sender + ':' + m.id, m);
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp).reverse();
  }, [older, state.messages, selected, loadedFor, historyKey]);
  async function act(task: () => Promise<unknown>) {
    if (working.current) return;
    working.current = true; setBusy(true); setFailed(false);
    try { await task(); } catch { setFailed(true); } finally { working.current = false; setBusy(false); }
  }
  function live(fingerprint: string) { return mesh.active && mesh.peers.some(p => p.fingerprint === fingerprint && p.lastSeen > 0); }
  async function leave() {
    if (!group || !await platform.confirmationDialog.confirm(t('groups.leave'), t(creator ? 'groups.creator_leave_hint' : 'groups.leave_hint'), t('mobile.cancel'), t('groups.leave'))) return;
    await bitchatService.leaveGroup(group.id); setSelected(undefined);
  }
  async function submit() {
    const command = groupCommand(draft);
    if (command) {
      if (command.action === 'create') { setSelected(await bitchatService.createGroup(command.argument)); }
      else if (command.action === 'list') setSelected(undefined);
      else {
        if (!group) throw new Error('Select a group');
        if (command.action === 'members') setMembers(true);
        if (command.action === 'leave') await leave();
        if (command.action === 'invite' || command.action === 'remove') {
          const target = command.argument.replace(/^@/, '');
          if (command.action === 'invite') {
            const peers = mesh.peers.filter(p => p.id === target || p.fingerprint === target || p.name === target || displayNickname(p.name, p.fingerprint, true) === target);
            if (peers.length !== 1) throw new Error('Use an unambiguous peer identity');
            await bitchatService.inviteGroup(group.id, peers[0].id);
          } else {
            const matches = group.members.filter(m => m.fingerprint === target || m.nickname === target || displayNickname(m.nickname, m.fingerprint, true) === target);
            if (matches.length !== 1) throw new Error('Use an unambiguous member identity');
            await bitchatService.removeGroupMember(group.id, matches[0].fingerprint);
          }
        }
      }
    } else { if (!group) throw new Error('Select a group'); await bitchatService.sendGroup(group.id, draft); }
    setDraft('');
  }
  const controls = <View style={{ gap: spacing.sm }}>
    {!mesh.active && <AppText tone="muted">{t('groups.connect_hint')}</AppText>}
    <AppText variant="caption" tone="muted">{t('groups.privacy_hint')}</AppText>
    {failed && <AppText tone="danger" accessibilityLiveRegion="polite">{t('groups.failed')}</AppText>}
  </View>;
  return <AppScreen edges={['bottom']}>
    {!group ? <FlatList style={{ flex: 1 }} data={state.groups} keyExtractor={g => g.id} keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: spacing.lg, paddingTop: top, gap: spacing.md }}
      ListHeaderComponent={<View style={{ gap: spacing.sm }}>{controls}
        <AppInput label={t('groups.name')} value={name} maxLength={64} onChangeText={setName} />
        <AppButton label={t('groups.create')} disabled={!mesh.active || busy || !name.trim() || new TextEncoder().encode(name.trim()).length > 64}
          onPress={() => void act(async () => { setSelected(await bitchatService.createGroup(name)); setName(''); })} />
      </View>}
      ListEmptyComponent={<View style={{ gap: spacing.sm }}><Users size={uiDensity.iconButtonSize} color={c.textMuted} /><AppText variant="subtitle">{t('groups.empty')}</AppText><AppText tone="muted">{t('groups.empty_hint')}</AppText></View>}
      renderItem={({ item }) => <AppButton variant="secondary" label={`${item.name} · ${item.members.length}${item.status === 'invited' ? ' · ' + t('groups.invitation') : ''}`} onPress={() => { setSelected(item.id); setMembers(false); }} />} /> : <KeyboardAvoidingView behavior="padding" style={{ flex: 1, padding: spacing.lg, paddingTop: top, gap: spacing.sm }}>
      <AppButton label={t('groups.all')} variant="text" fullWidth={false} onPress={() => setSelected(undefined)} />
      {controls}
      <AppText variant="subtitle">{group.name} · {group.members.length}</AppText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <AppButton label={t('groups.members')} variant="secondary" fullWidth={false} selected={members} onPress={() => setMembers(v => !v)} />
        <AppButton label={t('groups.leave')} variant="text" fullWidth={false} disabled={busy || !mesh.active} onPress={() => void act(leave)} />
      </View>
      {group.status === 'invited' && <AppButton label={t('groups.accept')} disabled={busy || !mesh.active} onPress={() => void act(() => bitchatService.acceptGroup(group.id))} />}
      {(members || group.status === 'invited') ? <FlatList style={{ flex: 1, minHeight: 0 }}
        data={group.members} keyExtractor={m => m.fingerprint} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md }}
        ListFooterComponent={creator ? <View style={{ gap: spacing.sm }}><AppText variant="subtitle">{t('groups.invite')}</AppText>
          {mesh.peers.filter(p => p.lastSeen > 0 && !!(p.capabilities! & 8) && !contacts.some(contact => contact.id === p.id && contact.blocked) && !group.members.some(m => m.fingerprint === p.fingerprint)).map(peer => <AppButton key={peer.id} label={displayNickname(peer.name, peer.fingerprint, nearbyDuplicates.has(nicknameKey(peer.name)))} variant="secondary" disabled={busy || !mesh.active} onPress={() => void act(() => bitchatService.inviteGroup(group.id, peer.id))} />)}
          <AppText tone="muted">{t('groups.invite_hint')}</AppText></View> : null}
        renderItem={({ item }) => <View style={{ gap: spacing.xs }}><AppText>{displayNickname(item.nickname, item.fingerprint, duplicates.has(nicknameKey(item.nickname)))}{item.fingerprint === group.creator ? ' · ' + t('groups.creator') : ''}</AppText>
          <AppText variant="caption" tone="muted">{t(item.fingerprint === state.self ? 'groups.you' : live(item.fingerprint) ? 'mobile.mesh_online' : 'mobile.mesh_offline')}</AppText>
          <AppText variant="caption" tone="muted" selectable>{item.fingerprint}</AppText>
          {creator && item.fingerprint !== group.creator && <AppButton label={t('groups.remove')} variant="text" disabled={busy || !mesh.active} onPress={() => void act(async () => {
            if (await platform.confirmationDialog.confirm(t('groups.remove'), t('groups.remove_hint'), t('mobile.cancel'), t('groups.remove'))) await bitchatService.removeGroupMember(group.id, item.fingerprint);
          })} />}</View>} /> : <>
        <FlatList style={{ flex: 1, minHeight: 0 }} data={messages} inverted keyExtractor={m => m.sender + ':' + m.id} contentContainerStyle={{ gap: spacing.sm }}
          ListFooterComponent={loadedFor === historyKey && before !== undefined ? <AppButton label={t('groups.older')} variant="text" disabled={busy} onPress={() => void act(async () => { const version = revision.current, page = await bitchatService.groupHistory(group.id, before); if (revision.current === version) { setOlder(old => [...page.messages, ...old]); setBefore(page.before); } })} /> : null}
          renderItem={({ item }) => <View style={{ alignSelf: item.outgoing ? 'flex-end' : 'flex-start', maxWidth: uiDensity.messageBubbleMaxWidth,
            paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs, borderRadius: radius.xl,
            borderEndStartRadius: item.outgoing ? radius.xl : radius.xs, borderEndEndRadius: item.outgoing ? radius.xs : radius.xl,
            backgroundColor: item.outgoing ? c.accentSoft : c.surfaceElevated }}><AppText variant="caption" tone="muted">{displayNickname(item.name, item.sender, duplicates.has(nicknameKey(item.name)))}</AppText><AppText selectable>{item.content}</AppText></View>} />
        <AppInput label={t('groups.message')} value={draft} multiline compactMultiline maxLength={65000} editable={!busy} onChangeText={setDraft} />
        <AppButton label={t('bitchat.send')} disabled={busy || !mesh.active || !draft.trim() || new TextEncoder().encode(draft).length > 65000} onPress={() => void act(submit)} />
        <AppText variant="caption" tone="muted">{t('groups.commands_hint')}</AppText>
      </>}
    </KeyboardAvoidingView>}
    <ScreenHeader title={t('groups.title')} />
  </AppScreen>;
}
