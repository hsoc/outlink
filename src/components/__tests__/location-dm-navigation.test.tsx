/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import Chats from '@/app/index';
import { platform } from '@/platform';
import { clearRenameNotices, recordRename } from '@/services/history/rename-notices';
import { geohashService, geohashStore } from '@/services/geohash/geohash.service';
import { bitchatService, bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { blockedUsers, blockedUsersStore } from '@/services/moderation/blocked-users';
import { workspaceStore } from '@/services/history/workspace';
const peer = 'b'.repeat(64);
jest.mock('react-native', () => {
  const React = jest.requireActual('react');
  return Object.create(jest.requireActual('react-native'), Object.getOwnPropertyDescriptors({ View: 'View', ScrollView: 'ScrollView', Keyboard: { dismiss: jest.fn() },
    FlatList: React.forwardRef(function MockFlatList(props: any, _ref: unknown) { return React.createElement('FlatList', { onViewableItemsChanged: props.onViewableItemsChanged, keyExtractor: props.keyExtractor }, props.ListHeaderComponent,
      props.data.map((item: any, index: number) => React.createElement(React.Fragment, { key: index }, props.renderItem({ item, index }))), props.ListFooterComponent); }),
  }));
});
jest.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: 'KeyboardAvoidingView' }));
jest.mock('react-i18next', () => { const t = (key: string, values?: { name?: string; count?: number; before?: string; after?: string }) => key === 'mobile.nickname_changed' ? `${values?.before} is now ${values?.after}` : key === 'mobile.dm_shortcut' ? `DM · ${values?.name}` : key === 'mobile.unread_private_sender' ? `${values?.name} · ${values?.count} unread` : key; return { useTranslation: () => ({ t }) }; });
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
jest.mock('@/platform', () => ({ platform: { history: { retainSenderLabel: jest.fn(async () => {}) }, appState: { currentState: () => 'active', addChangeListener: () => () => {} } } }));
jest.mock('@/services/bitchat/mesh-attachments', () => ({ meshAttachments: { clear: jest.fn() }, meshAttachmentStore: jest.requireActual('zustand/vanilla').createStore(() => ({ epoch: 0 })) }));
jest.mock('@/services/bitchat/bitchat.service', () => ({ bitchatService: { stop: jest.fn(async () => {}), nicknameIdentities: () => [], restore: jest.fn(async () => {}), showThread: jest.fn(async () => {}) },
  bitchatSessionStore: jest.requireActual('zustand/vanilla').createStore(() => ({ peers: [], messages: [], threadMessages: [], active: false, busy: false, id: 'self' })) }));
jest.mock('@/services/bitchat/mobile-identity', () => ({ mobileIdentity: jest.fn() }));
jest.mock('@/services/bitchat/panic', () => ({ panicWipe: jest.fn() }));
jest.mock('@/services/bitchat/compatibility/contacts', () => ({ contactsStore: jest.requireActual('zustand/vanilla').createStore(() => ({ contacts: [] })), contactsService: { get: jest.fn(), restore: jest.fn(async () => {}) } }));
jest.mock('@/services/moderation/blocked-users', () => ({ blockedUsersStore: jest.requireActual('zustand/vanilla').createStore(() => ({ users: [] })), blockedUsers: { restore: jest.fn(async () => {}), set: jest.fn(async () => {}) } }));
jest.mock('@/services/preferences/internet-private', () => ({ configurePrivateInternet: jest.fn() }));
jest.mock('@/services/preferences/nickname', () => ({ nicknameStore: jest.requireActual('zustand/vanilla').createStore(() => ({ name: 'Alice' })), ensureNickname: jest.fn(async () => 'Alice') }));
jest.mock('@/services/history/workspace', () => ({ workspaceStore: jest.requireActual('zustand/vanilla').createStore(() => ({ mode: 'geo', hash: 'u4pruy', precision: 6, relays: '', drafts: {}, ready: true })), restoreWorkspace: jest.fn(async () => {}) }));
jest.mock('@/services/mentions/conversation-activity', () => ({ conversationActivityStore: jest.requireActual('zustand/vanilla').createStore(() => ({ unread: {} })), conversationActivity: { focus: jest.fn() }, conversationScope: (...args: unknown[]) => JSON.stringify(args) }));
jest.mock('@/services/geohash/geohash.service', () => {
  const store = jest.requireActual('zustand/vanilla').createStore(() => ({}));
  return { geohashStore: store, geohashService: { restore: jest.fn(async () => {}), stop: jest.fn(), join: jest.fn(),
    privatePeer: (key: string) => (store.getState().privateThreads ?? []).find((thread: any) => thread.peer === key || thread.head === key || thread.keys.includes(key))?.peer ?? key,
    sendPrivate: jest.fn(async () => {}), readPrivate: jest.fn(async () => {}),
  } };
});
let screen: renderer.ReactTestRenderer;
const buttons = () => screen.root.findAllByType('AppButton' as never);
const button = (label: string) => buttons().find(item => item.props.label === label)!;
async function openDM() {
  const text = screen.root.findAllByType('AppText' as never).find(item => item.props.children === 'hello')!;
  await act(async () => { text.props.onLongPress(); });
  await act(async () => { screen.root.findByType('MessageActions' as never).props.onAction('message'); });
}
beforeEach(async () => {
  jest.clearAllMocks(); clearRenameNotices(); global.requestAnimationFrame = jest.fn(() => 1);
  blockedUsersStore.setState({ users: [] });
  bitchatSessionStore.setState({ active: false, peers: [], messages: [], threadMessages: [], threadPeer: undefined });
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

it('returns from a Nearby DM without stopping Bluetooth, while explicit Public Mesh Leave still disconnects', async () => {
  const meshPeer = peer.slice(0, 16);
  await act(async () => {
    bitchatSessionStore.setState({ active: true, peers: [], messages: [], threadMessages: [] });
    workspaceStore.setState({ mode: 'mesh', recipient: meshPeer });
  });
  expect(button('bitchat.leave')).toBeUndefined();
  await act(async () => { button('common.back').props.onPress(); });
  expect(workspaceStore.getState().recipient).toBeUndefined();
  expect(bitchatSessionStore.getState().active).toBe(true);
  expect(bitchatService.stop).not.toHaveBeenCalled(); expect(geohashService.stop).not.toHaveBeenCalled();
  await act(async () => { workspaceStore.setState({ recipient: meshPeer }); });
  await act(async () => { button('bitchat.public').props.onPress(); });
  expect(workspaceStore.getState().recipient).toBeUndefined();
  expect(bitchatService.stop).not.toHaveBeenCalled();
  await act(async () => { button('bitchat.leave').props.onPress(); });
  expect(bitchatService.stop).toHaveBeenCalledTimes(1);
  expect(geohashService.stop).not.toHaveBeenCalled();
});

it.each(['mesh', 'geo'] as const)('places new %s DM alerts beside the public button, keeps the selected thread after read, and preserves the other transport dot', async mode => {
  const id = mode === 'mesh' ? peer.slice(0, 16) : peer;
  await act(async () => {
    workspaceStore.setState({ mode, recipient: undefined });
    bitchatSessionStore.setState({ active: true, unread: new Map([[peer.slice(0, 16), { name: 'Bob', count: 2 }]]) });
    geohashStore.setState({ privatePeers: [peer], privateMessages: [{ id: 'dm', peer, recipient: 'a'.repeat(64), name: 'bbbbbbbb', content: 'private', timestamp: Date.now(), outgoing: false, delivery: 'delivered' }] });
  });
  expect(button('mobile.mesh').props.unread).toBe(true); expect(button('mobile.geo').props.unread).toBe(true);
  const tab = buttons().find(item => item.props.label.startsWith('DM · Bob') && item.props.unread)!;
  expect(tab).toBeDefined();
  expect(tab.props.label).toBe('DM · Bob');
  expect(tab.props.iconRight.props.children).toBe(mode === 'mesh' ? 2 : 1);
  expect(tab.props.accessibilityLabel).toBe(mode === 'mesh' ? 'DM · Bob · 2 unread' : 'DM · Bob · 1 unread');
  if (mode === 'mesh') expect(button('mobile.contacts').props.unread).toBe(true);
  await act(async () => { tab.props.onPress(); });
  if (mode === 'mesh') expect(workspaceStore.getState().recipient).toBe(id);
  expect(geohashService.stop).not.toHaveBeenCalled(); expect(bitchatService.stop).not.toHaveBeenCalled();
  await act(async () => {
    if (mode === 'mesh') bitchatSessionStore.setState({ unread: new Map(), threadPeer: id, threadMessages: [{ id: 'read-dm', peer: id, recipient: 'self', name: 'Bob', content: 'private', timestamp: Date.now(), outgoing: false, delivery: 'read' }] });
    else geohashStore.setState({ privateMessages: geohashStore.getState().privateMessages.map(message => ({ ...message, delivery: 'read' as const })) });
  });
  const selected = buttons().find(item => item.props.label === 'DM · Bob' && item.props.selected)!;
  expect(selected).toBeDefined(); expect(selected.props.unread).toBe(false);
  expect(button(mode === 'mesh' ? 'mobile.geo' : 'mobile.mesh').props.unread).toBe(true);
});

it('does not show a Location DM badge for a blocked proven root after old aliases are pruned', async () => {
  const root = 'c'.repeat(64);
  await act(async () => {
    blockedUsersStore.setState({ users: [{ key: 'nostr:' + root, name: 'Bob' }] });
    geohashStore.setState({ privatePeers: [root], privateThreads: [{ peer: root, head: peer, keys: [peer], local: '', blocked: false, migrating: false }],
      privateMessages: [{ id: 'dm', peer, channelThread: root, recipient: 'a'.repeat(64), name: 'Bob', content: 'blocked', timestamp: Date.now(), outgoing: false, delivery: 'delivered' }] });
  });
  expect(button('mobile.geo').props.unread).toBe(false);
  expect(buttons().some(item => item.props.label.startsWith('DM ·'))).toBe(false);
});

it('blocks a Location DM author in the Nostr namespace together with its proven root', async () => {
  const root = 'c'.repeat(64);
  await act(async () => { geohashStore.setState({ privatePeers: [root], privateThreads: [{ peer: root, head: peer, keys: [peer], local: '', blocked: false, migrating: false }],
    privateMessages: [{ id: 'dm', peer, channelThread: root, recipient: 'a'.repeat(64), name: 'Bob', content: 'private', timestamp: Date.now(), outgoing: false, delivery: 'delivered' }] }); });
  await openDM();
  expect(buttons().filter(item => item.props.label.startsWith('DM ·')).length).toBe(1);
  await act(async () => { screen.root.findAllByType('AppText' as never).find(item => item.props.children === 'private')!.props.onLongPress(); });
  await act(async () => { screen.root.findByType('MessageActions' as never).props.onAction('block'); });
  const keys = jest.mocked(blockedUsers.set).mock.calls[0][0];
  expect(new Set(keys)).toEqual(new Set(['nostr:' + peer, 'nostr:' + root]));
  expect(keys.every(key => key.startsWith('nostr:'))).toBe(true);
});

it('keeps discriminators on both older Location bubbles after a rename and gives later unambiguous messages bare labels', async () => {
  const self = 'a'.repeat(64);
  const message = geohashStore.getState().messages[0];
  const ownMessage = { ...message, id: 'own', pubkey: self, name: 'Alice', outgoing: true };
  const remoteMessage = { ...message, name: 'Alice' };
  const offscreen = { ...remoteMessage, id: 'offscreen' };
  const labels = () => screen.root.findAllByType('AppText' as never)
    .map(item => item.props.children).filter(value => Array.isArray(value) && /^\[\d\d:\d\d:\d\d\]$/.test(value[2]))
    .map(value => value[0]);
  await act(async () => { geohashStore.setState({ messages: [ownMessage, remoteMessage, offscreen] }); });
  expect(labels()).toEqual(['Alice', 'Alice', 'Alice']);
  await act(async () => {
    const list = screen.root.findAllByType('FlatList' as never).find(node => node.props.onViewableItemsChanged)!.props;
    list.onViewableItemsChanged({ viewableItems: [ownMessage, remoteMessage].map(item => ({ key: list.keyExtractor(item) })) });
    geohashStore.setState({ participants: [{ name: 'Alice', identity: peer }] });
  });
  expect(labels().slice(0, 2)).toEqual(['Alice#aaaa', 'Alice#bbbb']);
  expect(platform.history.retainSenderLabel).toHaveBeenCalledTimes(2);
  expect(platform.history.retainSenderLabel).toHaveBeenCalledWith('geo:u4pruy', remoteMessage.id, 'Alice#bbbb');
  await act(async () => {
    geohashStore.setState({ participants: [{ name: 'Bob', identity: peer }],
      messages: [ownMessage, remoteMessage, offscreen, { ...remoteMessage, id: 'renamed', name: 'Bob' }, { ...ownMessage, id: 'later' }] });
  });
  expect(labels()).toEqual(['Alice#aaaa', 'Alice#bbbb', 'Alice', 'Bob', 'Alice']);
});

it('shows a dismissible rename in its public area only', async () => {
  const alex = { identity: peer, name: 'Alex' };
  const scope = (area: string) => JSON.stringify(['geo', area, undefined]);
  const notice = (label: string) => screen.root.findAllByType('AppText' as never).some(item => item.props.children === label);
  await act(async () => {
    recordRename(scope('elsewhere'), alex, 'Other', []);
    recordRename(scope('u4pruy'), alex, 'Sam', [alex, { name: 'Alex', identity: 'a'.repeat(64) }]);
  });
  expect(notice('Alex#bbbb is now Sam')).toBe(true);
  expect(notice('Alex is now Other')).toBe(false);
  await act(async () => { button('common.dismiss').props.onPress(); });
  expect(notice('Alex#bbbb is now Sam')).toBe(false);
});
