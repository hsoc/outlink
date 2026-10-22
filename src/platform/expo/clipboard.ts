import { requireOptionalNativeModule } from 'expo-modules-core';
export const clipboardAdapter = {
  async writeText(text: string): Promise<void> {
    const native = requireOptionalNativeModule<{ copyTextAsync(text: string): Promise<void> }>('ExpoProximity');
    if (!native?.copyTextAsync) throw new Error('Clipboard requires an updated native build');
    await native.copyTextAsync(text);
  },
};
