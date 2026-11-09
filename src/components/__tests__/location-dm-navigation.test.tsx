/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import Chats from '@/app/index';
import { geohashService, geohashStore } from '@/services/geohash/geohash.service';
import { workspaceStore } from '@/services/history/workspace';
const peer = 'b'.repeat(64);
jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  return Object.create(jest.requireActual('react-native'), Object.getOwnPropertyDescriptors({ View: 'View', ScrollView: 'ScrollView', Keyboard: { dismiss: jest.fn() },
    FlatList: React.forwardRef(function MockFlatList(props: any, _ref: unknown) { return React.createElement('FlatList', null, props.ListHeaderComponent,
      props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, props.renderItem({ item, index }))), props.ListFooterComponent); }),
  }));
});
jest.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView' }));
jest.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: (callback: any) => jest.requireActual('react').useEffect(callback, [callback]) }));
jest.mock('@solar-icons/react-native/category/map/Linear/Radar', () => ({ Radar: 'Radar' }), { virtual: true });
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'AppScreen' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'AppButton' }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'AppText' }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: 'AppInput' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader', useScreenHeaderClearance: () => 0 }));
jest.mock('@/components/common/MessageActions', () => ({ MessageActions: 'MessageActions' }));
jest.mock('@/components/common/LocationInfo', () => ({ LocationInfo: 'LocationInfo' }));
jest.mock('@/components/bitchat/QuickEraseButton', () => ({ QuickEraseButton: 'QuickEraseButton' }));
jest.mock('@/components/MeshAttachments', () => ({ MeshAttachments: 'MeshAttachments' }));
jest.mock('@/components/ConversationErrorNotice', () => ({ ConversationErrorNotice: 'ConversationErrorNotice' }));
jest.mock('@/theme', () => ({ spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, radius: { xl: 24 }, uiDensity: { messageBubbleMaxWidth: '90%' }, useThemeColors: () => ({}) }));
jest.mock('@/platform', () => ({ platform: { appState: { currentState: () => 'active', addChangeListener: () => () => {} } } }));
jest.mock('@/services/bitchat/mesh-attachments', () => ({ meshAttachments: {}, meshAttachmentStore: jest.requireActual('zustand/vanilla').createStore(() => ({ epoch: 0 })) }));
jest.mock('@/services/bitchat/bitchat.service', () => ({ bitchatService: { restore: jest.fn(async () => {}), showThread: jest.fn(async () => {}) },
  bitchatSessionStore: jest.requireActual('zustand/vanilla').createStore(() => ({ peers: [], messages: [], threadMessages: [], active: false, busy: false, id: 'self' })) }));
jest.mock('@/services/bitchat/mobile-identity', () => ({ mobileIdentity: jest.fn() }));
jest.mock('@/services/bitchat/panic', () => ({ panicWipe: jest.fn() }));
jest.mock('@/services/bitchat/compatibility/contacts', () => ({ contactsStore: jest.requireActual('zustand/vanilla').createStore(() => ({ contacts: [] })), contactsService: { restore: jest.fn(async () => {}) } }));
jest.mock('@/services/moderation/blocked-users', () => ({ blockedUsersStore: jest.requireActual('zustand/vanilla').createStore(() => ({ users: [] })), blockedUsers: { restore: jest.fn(async () => {}) } }));
jest.mock('@/services/preferences/internet-private', () => ({ configurePrivateInternet: jest.fn() }));
jest.mock('@/services/preferences/nickname', () => ({ nicknameStore: jest.requireActual('zustand/vanilla').createStore(() => ({ name: 'Alice' })), ensureNickname: jest.fn(async () => 'Alice') }));
jest.mock('@/services/history/workspace', () => ({ workspaceStore: jest.requireActual('zustand/vanilla').createStore(() => ({ mode: 'geo', hash: 'u4pruy', precision: 6, relays: '', drafts: {}, ready: true })), restoreWorkspace: jest.fn(async () => {}) }));
jest.mock('@/services/mentions/conversation-activity', () => ({ conversationActivityStore: jest.requireActual('zustand/vanilla').createStore(() => ({ unread: {} })), conversationActivity: { focus: jest.fn() }, conversationScope: (...args: unknown[]) => JSON.stringify(args) }));
jest.mock('@/services/geohash/geohash.service', () => ({ geohashStore: jest.requireActual('zustand/vanilla').createStore(() => ({})), geohashService: { restore: jest.fn(async () => {}), stop: jest.fn(), join: jest.fn(), privatePeer: (key: string) => key, sendPrivate: jest.fn(async () => {}) } }));
let screen: renderer.ReactTestRenderer;
const buttons = () => screen.root.findAllByType('AppButton' as never);
const button = (label: string) => buttons().find(item => item.props.label === label)!;
async function openDM() {
  const text = screen.root.findAllByType('AppText' as never).find(item => item.props.children === 'hello')!;
  await act(async () => { text.props.onLongPress(); });
  await act(async () => { screen.root.findByType('MessageActions' as never).props.onAction('message'); });
}
beforeEach(async () => {
  jest.clearAllMocks(); global.requestAnimationFrame = jest.fn(() => 1);
  workspaceStore.setState({ mode: 'geo', hash: 'u4pruy', drafts: { 'geo:u4pruy': 'public draft' }, ready: true });
  geohashStore.setState({ active: true, hash: 'u4pruy', connected: 1, present: 2, participants: [], busy: false, publicIdentity: 'a'.repeat(64), privateActive: true, privateConnected: 1, privatePeers: [], privateThreads: [], privateMessages: [], messages: [{ id: 'public', pubkey: peer, name: 'Bob', content: 'hello', timestamp: Date.now(), outgoing: false, delivery: 'sent' }] });
  await act(async () => { screen = renderer.create(<Chats />); });
});
afterEach(async () => { await act(async () => { screen.unmount(); }); });
it('opens, sends and returns from a Location DM without leaving or rejoining its public area', async () => {
  await openDM();
  expect(button('bitchat.leave')).toBeUndefined(); expect(button('mobile.join')).toBeUndefined();
  await act(async () => { workspaceStore.setState({ drafts: { ...workspaceStore.getState().drafts, ['geo:u4pruy:private:' + peer]: 'private draft' } }); });
  await act(async () => { button('bitchat.send').props.onPress(); });
  expect(geohashService.sendPrivate).toHaveBeenCalledWith(peer, 'private draft');
  await act(async () => { button('common.back').props.onPress(); });
  expect(geohashStore.getState().active).toBe(true); expect(button('bitchat.leave')).toBeDefined();
  expect(workspaceStore.getState().drafts['geo:u4pruy']).toBe('public draft');
  expect(geohashService.stop).not.toHaveBeenCalled(); expect(geohashService.join).not.toHaveBeenCalled();
});
it('uses the area button to return from a DM, opens editing only from public chat, and leaves only explicitly', async () => {
  await openDM();
  await act(async () => { button('#u4pruy').props.onPress(); });
  expect(button('mobile.join')).toBeUndefined(); expect(button('bitchat.leave')).toBeDefined();
  expect(geohashService.stop).not.toHaveBeenCalled();
  await act(async () => { button('#u4pruy').props.onPress(); });
  expect(button('mobile.join')).toBeDefined();
  await act(async () => { button('common.cancel').props.onPress(); });
  await act(async () => { button('bitchat.leave').props.onPress(); });
  expect(geohashService.stop).toHaveBeenCalledTimes(1);
});
