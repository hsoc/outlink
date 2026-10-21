/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { HeaderIdentity } from '../common/HeaderIdentity';
import { router } from 'expo-router';
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/services/preferences/nickname', () => ({ ensureNickname: jest.fn(async () => 'Alice'), nicknameStore: jest.requireActual('zustand/vanilla').createStore(() => ({ name: 'Alice#12345678' })) }));
jest.mock('@/theme', () => ({ spacing: { xs: 4 }, uiDensity: { headerActionIconSize: 24 } }));
jest.mock('../common/AppButton', () => ({ AppButton: 'AppButton' }));
it('shows the own nickname without a discriminator and opens Settings on one activation', async () => {
  let screen!: renderer.ReactTestRenderer;
  await act(async () => { screen = renderer.create(<HeaderIdentity />); });
  const button = screen.root.findByType('AppButton' as never);
  expect(button.props.label).toBe('@Alice'); expect(button.props.labelNumberOfLines).toBe(1);
  await act(async () => { button.props.onPress(); });
  expect(router.push).toHaveBeenCalledWith('/settings');
  await act(async () => { screen.unmount(); });
});
