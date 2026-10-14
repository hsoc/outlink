import { useFocusEffect } from 'expo-router';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, ScrollView, View } from 'react-native';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import { bytes } from '@/services/bitchat/bitchat-wire';
import { useBitchatStore } from '@/stores/bitchat.store';
import { useActiveAccount } from '@/stores/active-account.store';
import { radius, spacing, uiDensity, useThemeColors } from '@/theme';

export default function BitchatScreen() {
  const { t } = useTranslation(), c = useThemeColors(), top = useScreenHeaderClearance();
  const account = useActiveAccount((value) => value.activePubkey);
  const sessionState = useBitchatStore((value) => value);
  const state = sessionState.account === account || !sessionState.active ? sessionState :
    { ...sessionState, active: false, messages: [], peers: [] };
  const [name, setName] = useState(t('bitchat.default_name'));
  const [recipient, setRecipient] = useState<string>();
  const [draft, setDraft] = useState(''), [sending, setSending] = useState(false), [failed, setFailed] = useState(false);
  const selected = state.peers.find((peer) => peer.id === recipient);
  const messages = useMemo(() => state.messages.filter((m) => recipient ? m.recipient &&
    (m.peer === recipient || m.recipient === recipient) : !m.recipient), [state.messages, recipient]);
  useFocusEffect(useCallback(() => () => { void bitchatService.stop().catch(() => {}); }, []));
  useEffect(() => () => { void bitchatService.stop().catch(() => {}); }, [account]);
  useEffect(() => {
    if (!recipient || !state.active) return;
    for (const m of messages) if (!m.outgoing && m.delivery === 'delivered')
      void bitchatService.read(recipient, m.id).catch(() => {});
  }, [recipient, state.active, messages]); // Receipt sends do not mutate the incoming timeline.
  const start = async () => {
    if (!account) return;
    setFailed(false);
    try { await bitchatService.start(account, name.trim()); } catch { setFailed(true); }
  };
  const send = async () => {
    if (sending) return;
    setSending(true); setFailed(false);
    try { await bitchatService.send(draft, recipient); setDraft(''); } catch { setFailed(true); }
    finally { setSending(false); }
  };
  return (
    <AppScreen edges={['bottom']}>
      <View style={{ flex: 1, paddingTop: top, paddingHorizontal: spacing.lg, gap: spacing.md }}>
        {!state.active ? (
          <View style={{ gap: spacing.lg, paddingVertical: spacing.lg }}>
            <Radar size={uiDensity.iconButtonSize} color={c.textMuted} />
            <AppText variant="title">{t('bitchat.title')}</AppText>
            <AppText tone="muted">{t('bitchat.description')}</AppText>
            <AppText tone="muted">{t('bitchat.privacy')}</AppText>
            <AppInput label={t('bitchat.name')} value={name} onChangeText={setName} maxLength={16} />
            <AppButton label={t('bitchat.join')} onPress={() => void start()} loading={state.busy}
              disabled={!name.trim() || bytes(name.trim()).length > 64 || !account} />
          </View>
        ) : (
          <>
            <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}>
              <AppButton label={t('bitchat.public')} variant="secondary" selected={!recipient}
                fullWidth={false} onPress={() => setRecipient(undefined)} />
              {state.peers.filter((p) => p.lastSeen > 0).map((p) => (
                <AppButton key={p.id} label={p.name} variant="secondary" selected={recipient === p.id}
                  fullWidth={false} onPress={() => setRecipient(p.id)} />
              ))}
            </ScrollView>
            <AppText variant="caption" tone="muted">{t(recipient ? 'bitchat.private_notice' : 'bitchat.public_notice')}</AppText>
            {selected ? <AppText variant="caption" tone="muted" selectable>{t('bitchat.fingerprint', { value: selected.fingerprint })}</AppText> : null}
            <FlatList data={messages} keyExtractor={(m) => `${m.peer}:${m.id}`}
              contentContainerStyle={{ gap: spacing.sm, paddingBottom: spacing.md }}
              renderItem={({ item }) => (
                <View style={{ padding: spacing.md, borderRadius: radius.lg, backgroundColor: c.surface }}>
                  <AppText variant="caption" tone="muted">{item.name}</AppText>
                  <AppText selectable>{item.content}</AppText>
                  {item.outgoing && item.recipient ? <AppText variant="caption" tone="muted">{t(`bitchat.${item.delivery}`)}</AppText> : null}
                </View>
              )}
              ListEmptyComponent={<View style={{ gap: spacing.sm, paddingVertical: spacing.lg }}>
                <Radar size={uiDensity.iconButtonSize} color={c.textMuted} />
                <AppText variant="subtitle">{t('bitchat.empty')}</AppText>
                <AppText tone="muted">{t('bitchat.empty_hint')}</AppText>
              </View>} />
            <AppInput label={t('bitchat.message')} value={draft} onChangeText={setDraft} maxLength={255} multiline />
            <AppText variant="caption" tone="muted">{t('bitchat.limit', { count: bytes(draft).length })}</AppText>
            <AppButton label={t('bitchat.send')} onPress={() => void send()} loading={sending}
              disabled={!draft.trim() || bytes(draft).length > 255} />
          </>
        )}
        {failed || state.error ? <AppText tone="danger">{t('bitchat.error')}</AppText> : null}
      </View>
      <ScreenHeader title={t('bitchat.title')} right={state.active ?
        <AppButton variant="text" label={t('bitchat.leave')} onPress={() => void bitchatService.stop().catch(() => setFailed(true))} /> : undefined} />
    </AppScreen>
  );
}
