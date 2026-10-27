import { useCallback, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { Radar } from '@solar-icons/react-native/category/map/Linear/Radar';
import { AppScreen } from '@/components/common/AppScreen';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { platform } from '@/platform';
import { cashuStore, cashuTransfers, type TransferSummary } from '@/services/cashu/transfers';
import { inspectToken, MAX_TOKEN } from '@/services/cashu/token';
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { contactsStore } from '@/services/bitchat/compatibility/contacts';
import { blockedUsersStore } from '@/services/moderation/blocked-users';
import { sessionIntent } from '@/services/history/lifecycle';
import { spacing, uiDensity, useThemeColors } from '@/theme';
export default function Payments() {
  const { t } = useTranslation(), top = useScreenHeaderClearance(), colors = useThemeColors();
  const params = useLocalSearchParams<{ peer?: string }>(), peer = typeof params.peer === 'string' && /^[0-9a-f]{16}$/.test(params.peer) ? params.peer : undefined;
  const transfers = useStore(cashuStore, state => state.transfers), mesh = useStore(bitchatSessionStore);
  const contacts = useStore(contactsStore, state => state.contacts), blocks = useStore(blockedUsersStore, state => state.users);
  const [input, setInput] = useState(''), [preview, setPreview] = useState<ReturnType<typeof inspectToken>>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [ready, setReady] = useState(false);
  const mounted = useRef(false), locked = useRef(false);
  useFocusEffect(useCallback(() => {
    mounted.current = true;
    void cashuTransfers.restore().then(() => { if (mounted.current) setReady(true); }).catch(() => { if (mounted.current) setNotice('failed'); });
    const remove = platform.appState.addChangeListener(state => { if (state !== 'active') { setInput(''); setPreview(undefined); } });
    return () => { mounted.current = false; remove(); setInput(''); setPreview(undefined); };
  }, []));
  const run = async (task: (valid: () => boolean) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setNotice('');
    const epoch = sessionIntent(), valid = () => mounted.current && epoch === sessionIntent() && platform.appState.currentState() === 'active';
    try { await task(valid); } catch { if (valid()) setNotice('failed'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  const send = (item: TransferSummary) => void run(async valid => {
    await bitchatService.sendCashu(item.peer, item.id);
    if (valid()) setNotice('attempted');
  });
  const data = transfers.filter(item => (!peer || item.peer === peer) && !blocks.some(block => block.key === 'mesh:' + item.peer) && !contacts.find(contact => contact.id === item.peer)?.blocked);
  return <AppScreen edges={['bottom']}><FlatList style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.lg, paddingTop: top, gap: spacing.md }}
    data={data} keyExtractor={item => item.peer + item.id + item.outgoing}
    ListHeaderComponent={<View style={{ gap: spacing.md }}>
      <AppText>{t('cashu.intro')}</AppText><AppText tone="muted">{t('cashu.risk')}</AppText>
      <AppText tone="danger">{t('cashu.erase')}</AppText><AppText variant="caption" tone="muted">{t('cashu.limits')}</AppText>
      {peer ? <>
        <AppText selectable variant="code">{t('cashu.peer', { peer })}</AppText>
        <AppInput label={t('cashu.input')} value={input} maxLength={MAX_TOKEN + 8} multiline compactMultiline autoCorrect={false} autoCapitalize="none" editable={!busy} onChangeText={value => { setInput(value); setPreview(undefined); }} />
        <AppButton label={t('cashu.review')} variant="secondary" disabled={busy || !ready || !input.trim()} onPress={() => { try { setPreview(inspectToken(input)); setNotice(''); } catch { setNotice('failed'); } }} />
        {preview && <><AppText>{t('cashu.amount', preview)}</AppText><AppText selectable>{t('cashu.mint', preview)}</AppText>
          <AppButton label={t('cashu.send')} disabled={busy || !mesh.active} onPress={() => void run(async valid => {
            if (!await platform.confirmationDialog.confirm(t('cashu.title'), t('cashu.confirm', { ...preview, peer }), t('common.cancel'), t('cashu.send')) || !valid()) return;
            const item = await cashuTransfers.prepare(peer, preview.wire);
            if (!valid()) return;
            setInput(''); setPreview(undefined);
            await bitchatService.sendCashu(peer, item.id);
            if (valid()) setNotice('attempted');
          })} /></>}
      </> : <AppText tone="muted">{t('cashu.select')}</AppText>}
      {!!notice && <AppText accessibilityLiveRegion="polite" tone={notice === 'failed' ? 'danger' : 'muted'}>{t('cashu.' + notice)}</AppText>}
    </View>}
    ListEmptyComponent={ready ? <View style={{ gap: spacing.sm }}><Radar size={uiDensity.iconButtonSize} color={colors.textMuted} /><AppText variant="subtitle">{t('cashu.empty')}</AppText><AppText tone="muted">{t('cashu.empty_hint')}</AppText></View> : null}
    renderItem={({ item }) => <View style={{ gap: spacing.sm, paddingVertical: spacing.md }}>
      <AppText variant="subtitle">{t(item.outgoing ? 'cashu.outgoing' : item.complete ? 'cashu.incoming' : 'cashu.partial', item)}</AppText>
      <AppText selectable variant="caption">{t('cashu.peer', item)}</AppText>
      {item.complete && <><AppText>{t('cashu.amount', item)}</AppText><AppText selectable>{t('cashu.mint', item)}</AppText>
        {item.outgoing && <AppButton variant="secondary" label={t('cashu.retry')} disabled={busy || !mesh.active} onPress={() => send(item)} />}
        <AppButton variant="secondary" label={t('cashu.copy')} disabled={busy} onPress={() => void run(async valid => {
          if (!await platform.confirmationDialog.confirm(t('cashu.copy'), t('cashu.copy_warning'), t('common.cancel'), t('cashu.copy')) || !valid()) return;
          const token = await cashuTransfers.token(item);
          if (!valid()) return;
          await platform.clipboard.writeText(token);
          if (valid()) setNotice('copied');
        })} />
      </>}
    </View>} /><ScreenHeader title={t('cashu.title')} /></AppScreen>;
}
