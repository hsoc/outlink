/** @jest-environment node */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { MessageActions } from '../common/MessageActions';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/theme', () => ({ spacing: { lg: 16, xs: 4 }, radius: { xl: 24 }, useThemeColors: () => ({}) }));
jest.mock('../common/AppButton', () => ({ AppButton: 'AppButton' }));
jest.mock('../common/AppText', () => ({ AppText: 'AppText' }));
it('offers exactly five sender actions, dispatches the selected action, and gates unavailable routes', async () => {
  const action = jest.fn(); let screen!: renderer.ReactTestRenderer;
  await act(async () => { screen = renderer.create(<MessageActions name="Alice" own={false} canMessage={false} canPost={false} onAction={action} onClose={() => {}} />); });
  const buttons = screen.root.findAllByType('AppButton' as never);
  expect(buttons.map(b => b.props.label)).toEqual(['mobile.message_action_copy', 'mobile.message_action_message', 'mobile.message_action_hug', 'mobile.message_action_slap', 'mobile.message_action_block', 'common.cancel']);
  expect(buttons[1].props.disabled).toBe(true); expect(buttons[2].props.disabled).toBe(true);
  await act(async () => { buttons[0].props.onPress(); }); expect(action).toHaveBeenCalledWith('copy');
  await act(async () => { screen.update(<MessageActions name="Me" own canMessage canPost onAction={action} onClose={() => {}} />); });
  expect(screen.root.findAllByType('AppButton' as never).map(b => b.props.label)).toEqual(['mobile.message_action_copy', 'common.cancel']);
  await act(async () => { screen.unmount(); });
});
