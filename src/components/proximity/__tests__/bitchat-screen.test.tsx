import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { bitchatService } from '@/services/bitchat/bitchat.service';
import BitchatScreen from '../../../app/(app)/bitchat';
let mockTheme = 'light';
let mockState = { active: true, busy: false, id: 'me', account: 'account', error: false,
  peers: [{ id: 'alice', name: 'Alice', fingerprint: 'abc', lastSeen: Date.now(), secure: false }],
  messages: [
    { id: 'public-1', peer: 'alice', name: 'Alice', content: 'public text', outgoing: false },
    { id: 'private-1', peer: 'alice', recipient: 'me', name: 'Alice', content: 'private text', outgoing: false, delivery: 'read' },
  ] };
let mockBlur: () => void;
jest.mock('expo-router', () => ({ useFocusEffect: (fn: () => () => void) => { mockBlur = fn(); } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({
  spacing: { sm: 8, md: 16, lg: 24 }, radius: { lg: 16 }, uiDensity: { iconButtonSize: 40 },
  useThemeColors: () => ({ surface: `${mockTheme}-surface`, textMuted: `${mockTheme}-muted` }),
}));
jest.mock('@/stores/active-account.store', () => ({ useActiveAccount: (select: (value: unknown) => unknown) => select({ activePubkey: 'account' }) }));
jest.mock('@/stores/bitchat.store', () => ({ useBitchatStore: (select: (value: unknown) => unknown) => select(mockState) }));
jest.mock('@/services/bitchat/bitchat.service', () => ({ bitchatService: {
  start: jest.fn(async () => {}), stop: jest.fn(async () => {}), send: jest.fn(async () => {}), read: jest.fn(async () => {}),
} }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'AppScreen' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'AppText' }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: 'AppInput' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'AppButton' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader', useScreenHeaderClearance: () => 56 }));
jest.mock('@solar-icons/react-native/category/map/Linear/Radar', () => ({ Radar: 'Radar' }), { virtual: true });
let renderer: ReactTestRenderer;
afterEach(() => { act(() => renderer?.unmount()); jest.clearAllMocks(); });
it.each(['light', 'dark'])('keeps private content out of the public room and uses %s theme tokens', async (theme) => {
  mockTheme = theme;
  act(() => { renderer = create(<BitchatScreen />); });
  const texts = () => renderer.root.findAllByType(AppText).map((node) => node.props.children);
  expect(texts()).toContain('public text'); expect(texts()).not.toContain('private text');
  const surfaces = renderer.root.findAll((node) => node.props.style?.backgroundColor === `${theme}-surface`);
  expect(surfaces.length).toBeGreaterThan(0);
  await act(async () => { renderer.root.findAllByType(AppButton).find((node) => node.props.label === 'Alice')!.props.onPress(); });
  expect(texts()).toContain('private text'); expect(texts()).not.toContain('public text');
  await act(async () => { renderer.root.findByType(AppInput).props.onChangeText('hello'); });
  await act(async () => renderer.root.findAllByType(AppButton).find((node) => node.props.label === 'bitchat.send')!.props.onPress());
  expect(bitchatService.send).toHaveBeenCalledWith('hello', 'alice');
  mockBlur(); expect(bitchatService.stop).toHaveBeenCalled();
});
