/** @jest-environment node */
import React from 'react';
import { ScrollView } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import Settings from '../../app/settings';
import { ensureNickname, saveNickname, validateNickname } from '@/services/preferences/nickname';
import { mentionService } from '@/services/mentions/mentions';
import { bitchatService } from '@/services/bitchat/bitchat.service';
const mockFocusCallbacks: (() => void | (() => void))[] = [];
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: (callback: () => void | (() => void)) => {
  mockFocusCallbacks.push(callback);
  jest.requireActual('react').useEffect(callback, [callback]);
} }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/services/preferences/nickname', () => ({ ensureNickname: jest.fn(), saveNickname: jest.fn(), validateNickname: jest.fn((value: string) => { if (!value.trim()) throw new Error('empty'); return value.trim(); }) }));
jest.mock('@/services/mentions/mentions', () => ({ mentionService: { enabled: jest.fn(), configure: jest.fn() } }));
jest.mock('@/services/bitchat/bitchat.service', () => ({ bitchatService: { rename: jest.fn() } }));
jest.mock('@/services/geohash/geohash.service', () => ({ geohashService: { rename: jest.fn() } }));
jest.mock('@/services/bitchat/panic', () => ({ panicWipe: jest.fn() }));
jest.mock('@/services/history/history', () => ({ clearHistory: jest.fn() }));
jest.mock('@/services/history/workspace', () => ({ workspaceStore: jest.requireActual('zustand/vanilla').createStore(() => ({ ready: true })), restoreWorkspace: jest.fn(async () => {}) }));
jest.mock('@/platform', () => ({ platform: { backgroundConnectivity: { supported: () => false } } }));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (value: unknown) => unknown) => select({ preference: 'system', accent: 'blue' }) }));
jest.mock('@/theme', () => ({ spacing: { lg: 16, sm: 8 }, ACCENT_KEYS: [], useThemeColors: () => ({}) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'AppScreen' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'AppText' }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: 'AppInput' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'AppButton' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader', useScreenHeaderClearance: () => 0 }));
jest.mock('@/components/bitchat/NetworkSettings', () => ({ NetworkSettings: 'NetworkSettings' }));
let screen: renderer.ReactTestRenderer;
const input = () => screen.root.findByType('AppInput' as never);
const save = () => screen.root.findAllByType('AppButton' as never).find(button => button.props.label === 'common.save')!;
beforeEach(async () => {
  jest.clearAllMocks(); mockFocusCallbacks.length = 0;
  jest.mocked(ensureNickname).mockResolvedValue('Old');
  jest.mocked(saveNickname).mockImplementation(async name => name);
  jest.mocked(mentionService.enabled).mockResolvedValue(false);
});
afterEach(async () => { await act(async () => { screen?.unmount(); }); });
it('saves on the first activation, guards duplicate taps, and shows pending feedback', async () => {
  let release!: (name: string) => void;
  jest.mocked(saveNickname).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { screen = renderer.create(<Settings />); });
  await act(async () => { input().props.onChangeText('New'); });
  expect(save().props.disabled).toBe(false);
  await act(async () => { const press = save().props.onPress; press(); press(); });
  expect(saveNickname).toHaveBeenCalledTimes(1); expect(saveNickname).toHaveBeenCalledWith('New');
  expect(save().props.loading).toBe(true);
  await act(async () => { release('New'); });
  expect(input().props.value).toBe('New'); expect(bitchatService.rename).toHaveBeenCalledWith('New');
  expect(screen.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
});
it('does not wait for notification preferences before enabling nickname editing', async () => {
  jest.mocked(mentionService.enabled).mockImplementationOnce(() => new Promise(() => {}));
  await act(async () => { screen = renderer.create(<Settings />); });
  expect(input().props.editable).toBe(true);
  await act(async () => { input().props.onChangeText('First tap'); });
  await act(async () => { save().props.onPress(); });
  expect(saveNickname).toHaveBeenCalledWith('First tap');
});
it('does not replace a newer edit with a delayed focus-load snapshot', async () => {
  await act(async () => { screen = renderer.create(<Settings />); });
  let release!: (name: string) => void; let cleanup: void | (() => void);
  jest.mocked(ensureNickname).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  await act(async () => { cleanup = mockFocusCallbacks.at(-1)!(); });
  await act(async () => { input().props.onChangeText('Latest edit'); });
  await act(async () => { release('Old snapshot'); });
  expect(input().props.value).toBe('Latest edit');
  await act(async () => { save().props.onPress(); });
  expect(saveNickname).toHaveBeenCalledWith('Latest edit');
  if (cleanup!) cleanup();
});

it('saves independently of unrelated network settings activity and uses the keyboard submitted value', async () => {
  await act(async () => { screen = renderer.create(<Settings />); });
  await act(async () => { screen.root.findByType('NetworkSettings' as never).props.onBusyChange(true); input().props.onChangeText('Draft'); });
  expect(save().props.disabled).toBe(false);
  await act(async () => { input().props.onSubmitEditing({ nativeEvent: { text: 'Latest native edit' } }); });
  expect(saveNickname).toHaveBeenCalledWith('Latest native edit');
});

it('normalizes a pasted discriminator even when the saved base is unchanged', async () => {
  await act(async () => { screen = renderer.create(<Settings />); });
  await act(async () => { input().props.onChangeText('Old#12345678'); });
  jest.mocked(validateNickname).mockReturnValueOnce('Old');
  await act(async () => { save().props.onPress(); });
  expect(input().props.value).toBe('Old'); expect(saveNickname).not.toHaveBeenCalled();
});
