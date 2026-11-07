/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { ConversationErrorNotice } from '../ConversationErrorNotice';
import { bitchatSessionStore } from '@/services/bitchat/bitchat.service';
import { geohashStore } from '@/services/geohash/geohash.service';

jest.mock('@/services/bitchat/bitchat.service', () => ({
  bitchatSessionStore: jest.requireActual<typeof import('zustand/vanilla')>('zustand/vanilla').createStore(() => ({ error: false })),
}));
jest.mock('@/services/geohash/geohash.service', () => ({
  geohashStore: jest.requireActual<typeof import('zustand/vanilla')>('zustand/vanilla').createStore(() => ({ error: false })),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/theme', () => ({ spacing: { sm: 8 } }));
jest.mock('../common/AppButton', () => ({ AppButton: 'AppButton' }));
jest.mock('../common/AppText', () => ({ AppText: 'AppText' }));

beforeEach(() => {
  bitchatSessionStore.setState({ error: false });
  geohashStore.setState({ error: false });
});

it('isolates transport errors, dismisses only the visible error and shows subsequent failures', async () => {
  const dismiss = jest.fn();
  bitchatSessionStore.setState({ error: true });
  let screen!: renderer.ReactTestRenderer;
  await act(async () => { screen = renderer.create(<ConversationErrorNotice mode="geo" actionError={null} onDismissAction={dismiss} />); });
  expect(screen.toJSON()).toBeNull();
  await act(async () => { geohashStore.setState({ error: true }); });
  expect(screen.root.findByType('AppText' as never).props.children).toBe('mobile.operation_failed');
  await act(async () => { screen.root.findByType('AppButton' as never).props.onPress(); });
  expect(screen.toJSON()).toBeNull();
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(geohashStore.getState().error).toBe(false);
  expect(bitchatSessionStore.getState().error).toBe(true);
  await act(async () => { geohashStore.setState({ error: true }); });
  expect(screen.toJSON()).not.toBeNull();
  await act(async () => { screen.update(<ConversationErrorNotice mode="mesh" actionError={null} onDismissAction={dismiss} />); });
  await act(async () => { screen.root.findByType('AppButton' as never).props.onPress(); });
  expect(bitchatSessionStore.getState().error).toBe(false);
  expect(geohashStore.getState().error).toBe(true);
  expect(screen.toJSON()).toBeNull();
  await act(async () => { screen.unmount(); });
});

it('keeps action-specific guidance and lets the parent clear it', async () => {
  const dismiss = jest.fn();
  let screen!: renderer.ReactTestRenderer;
  await act(async () => { screen = renderer.create(<ConversationErrorNotice mode="geo" actionError="send" onDismissAction={dismiss} />); });
  expect(screen.root.findByType('AppText' as never).props.children).toBe('mobile.send_failed');
  await act(async () => { screen.root.findByType('AppButton' as never).props.onPress(); });
  expect(dismiss).toHaveBeenCalledTimes(1);
  await act(async () => { screen.update(<ConversationErrorNotice mode="geo" actionError={null} onDismissAction={dismiss} />); });
  expect(screen.toJSON()).toBeNull();
  await act(async () => { screen.unmount(); });
});
