import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
export const noticesAdapter = {
  async readText(id: string): Promise<string> {
    const { noticeAssets } = await import('@/generated/licenses/assets');
    if (!Object.hasOwn(noticeAssets, id)) throw new Error('Unknown notice');
    const asset = Asset.fromModule(noticeAssets[id]());
    await asset.downloadAsync();
    if (!asset.localUri) throw new Error('Notice is unavailable');
    return new File(asset.localUri).text();
  },
};
