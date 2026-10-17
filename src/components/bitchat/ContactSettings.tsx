import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Svg, { Path, Rect } from 'react-native-svg';
import generateQr from 'qrcode-generator';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { spacing, verificationLayout, useThemeColors } from '@/theme';
import { platform } from '@/platform';
import { contactsService, contactsStore } from '@/services/bitchat/compatibility/contacts';
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { getDevicePreference } from '@/services/preferences/device-preferences.service';
function VerificationCode({ link }: { link: string }) {
  const c = useThemeColors(), { t } = useTranslation();
  const matrix = useMemo(() => {
    const qr = generateQr(0, 'M'); qr.addData(link); qr.make();
    const size = qr.getModuleCount(); let path = '';
    for (let row = 0; row < size; ++row) for (let col = 0; col < size; ++col) if (qr.isDark(row, col)) path += `M${col + 4},${row + 4}h1v1h-1z`;
    return { size: size + 8, path };
  }, [link]);
  return <Svg accessibilityLabel={t('mobile.contact_code')} width={verificationLayout.size} height={verificationLayout.size} viewBox={`0 0 ${matrix.size} ${matrix.size}`}>
    <Rect width={matrix.size} height={matrix.size} fill={c.qrPaper} /><Path d={matrix.path} fill={c.qrInk} />
  </Svg>;
}
export function ContactSettings({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { t } = useTranslation(), contacts = useStore(contactsStore, state => state.contacts);
  const [permission, requestPermission] = useCameraPermissions();
  const [link, setLink] = useState(''), [input, setInput] = useState(''), [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const active = useStore(bitchatSessionStore, state => state.active);
  const [diagnostic, setDiagnostic] = useState<{ name: string; ms: number; hops?: number }>();
  const working = useRef(false), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void contactsService.restore().catch(() => setStatus('mobile.failed'));
    const remove = platform.appState.addChangeListener(state => { if (state !== 'active') setScanning(false); });
    return () => { mounted.current = false; remove(); };
  }, []);
  useFocusEffect(useCallback(() => () => { setScanning(false); setLink(''); }, []));
  useEffect(() => { if (!link) return; const timer = setTimeout(() => setLink(''), 240000); return () => clearTimeout(timer); }, [link]);
  async function operate(task: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange?.(true); setStatus(''); setDiagnostic(undefined);
    try { await new Promise(resolve => setTimeout(resolve, 0)); await task(); }
    catch { if (mounted.current) setStatus('mobile.failed'); }
    finally { working.current = false; onBusyChange?.(false); if (mounted.current) setBusy(false); }
  }
  async function add(value: string) {
    setScanning(false);
    await operate(async () => {
      const contact = await bitchatService.importContact(value);
      if (mounted.current) { setInput(''); setStatus(contact.verified ? 'mobile.contact_verified' : 'mobile.contact_saved'); }
    });
  }
  const filtered = contacts.filter(contact => contact.name.toLowerCase().includes(search.toLowerCase()) || contact.id.includes(search.toLowerCase())).slice(0, 50);
  return <View style={{ gap: spacing.md }}>
    <AppText variant="subtitle">{t('mobile.contacts')}</AppText>
    <AppText tone="muted">{t('mobile.contact_hint')}</AppText>
    <AppButton label={t('mobile.show_code')} variant="secondary" disabled={busy} onPress={() => void operate(async () => {
      const name = await getDevicePreference('mobile.nickname') ?? t('bitchat.default_name');
      const value = await bitchatService.verification(name); if (mounted.current) setLink(value);
    })} />
    {!!link && <><VerificationCode link={link} /><AppText variant="caption" tone="muted">{t('mobile.code_expiry')}</AppText>
      <AppButton label={t('mobile.share_contact')} variant="text" onPress={() => void operate(async () => { await Share.share({ message: link }); })} /></>}
    <AppButton label={t(scanning ? 'mobile.cancel' : 'mobile.scan_contact')} variant="secondary" disabled={busy} onPress={() => void operate(async () => {
      if (scanning) { setScanning(false); return; }
      if (permission?.granted || (await requestPermission()).granted) setScanning(true); else setStatus('mobile.camera_denied');
    })} />
    {scanning && <CameraView style={{ height: verificationLayout.size }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      onBarcodeScanned={({ data }) => { if (!working.current) void add(data); }} onMountError={() => { setScanning(false); setStatus('mobile.failed'); }} />}
    <AppInput label={t('mobile.contact_link')} value={input} onChangeText={setInput} autoCapitalize="none" autoCorrect={false} maxLength={4096} multiline />
    <AppButton label={t('mobile.add_contact')} variant="secondary" disabled={busy || !input.trim()} onPress={() => void add(input.trim())} />
    {!!status && <AppText tone={status === 'mobile.failed' ? 'danger' : 'muted'} accessibilityLiveRegion="polite">{t(status)}</AppText>}
    {diagnostic && <AppText variant="caption" tone="muted" accessibilityLiveRegion="polite">{t('mobile.connection_result', diagnostic)}</AppText>}
    {contacts.length > 0 && <AppInput label={t('mobile.find_contact')} value={search} onChangeText={setSearch} maxLength={64} />}
    {filtered.map(contact => <View key={contact.id} style={{ gap: spacing.sm }}>
      <AppText>{contact.name} · {t(contact.verified ? 'mobile.verified' : 'mobile.unverified')}</AppText>
      <AppText selectable variant="caption" tone="muted">{contact.fingerprint}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        <AppButton label={t('mobile.check_connection')} variant="text" fullWidth={false} disabled={busy || !active || contact.blocked}
          onPress={() => void operate(async () => { const result = await bitchatService.ping(contact.id); if (mounted.current) setDiagnostic({ name: contact.name, ms: result.rttMs, hops: result.hops }); })} />
        <AppButton label={t(contact.favorite ? 'mobile.unfavorite' : 'mobile.favorite')} variant="text" fullWidth={false} disabled={busy}
          onPress={() => void operate(() => bitchatService.favorite(contact.id, !contact.favorite))} />
        <AppButton label={t(contact.blocked ? 'mobile.unblock' : 'mobile.block')} variant="text" fullWidth={false} disabled={busy}
          onPress={() => void operate(() => contactsService.save({ ...contact, blocked: !contact.blocked }))} />
      </View>
    </View>)}
  </View>;
}
