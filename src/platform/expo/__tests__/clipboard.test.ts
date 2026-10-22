/** @jest-environment node */
import { requireOptionalNativeModule } from 'expo-modules-core';
import { clipboardAdapter } from '../clipboard';
jest.mock('expo-modules-core', () => ({ ...jest.requireActual('expo-modules-core'), requireOptionalNativeModule: jest.fn() }));
it('copies exact message text and reports an unavailable old native build', async () => {
  const copy = jest.fn(async () => {});
  jest.mocked(requireOptionalNativeModule).mockReturnValueOnce({ copyTextAsync: copy });
  await clipboardAdapter.writeText('hello\n🫂'); expect(copy).toHaveBeenCalledWith('hello\n🫂');
  jest.mocked(requireOptionalNativeModule).mockReturnValueOnce(null);
  await expect(clipboardAdapter.writeText('hello')).rejects.toThrow('updated native build');
});
