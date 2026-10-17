import { useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { platform } from '@/platform';
import catalog from '@/generated/licenses/catalog.json';
import { spacing } from '@/theme';
export default function Licenses() {
  const { t } = useTranslation(), top = useScreenHeaderClearance();
  const [query, setQuery] = useState(''), [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const entries = catalog.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase()));
  return <AppScreen edges={['bottom']}><View style={{ flex: 1, padding: spacing.lg, paddingTop: top, gap: spacing.md }}>
    {text !== null ? <><AppButton variant="secondary" label={t('common.back')} onPress={() => setText(null)} />
      <ScrollView><AppText selectable variant="code">{text}</AppText></ScrollView></> : <>
      <AppInput label={t('mobile.licenses')} value={query} onChangeText={setQuery} />
      <FlatList data={entries} keyExtractor={entry => entry.id} renderItem={({ item }) => <View style={{ paddingVertical: spacing.sm }}>
        <AppText>{item.name} · {item.license}</AppText>
        {item.documents.map(document => <AppButton key={document.id} label={document.title} variant="text" disabled={busy}
          onPress={() => { setBusy(true); setFailed(false); void platform.notices.readText(document.id)
            .then(setText).catch(() => setFailed(true)).finally(() => setBusy(false)); }} />)}
      </View>} />
    </>}
    {failed && <AppText tone="danger">{t('mobile.failed')}</AppText>}
  </View><ScreenHeader title={t('mobile.licenses')} /></AppScreen>;
}
