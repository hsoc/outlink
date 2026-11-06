import { Directory, File, Paths } from 'expo-file-system';

const directory = () => new Directory(Paths.cache, 'outlink-mesh-media');
export function cacheMeshMedia(id: number, extension: string, data: Uint8Array): string {
  if (!Number.isSafeInteger(id) || !/^(jpg|png|webp|m4a)$/.test(extension)) throw new Error('Invalid attachment path');
  const folder = directory();
  folder.create({ idempotent: true });
  const file = new File(folder, `${id}.${extension}`);
  try { file.write(data); return file.uri; }
  catch (error) { if (file.exists) file.delete(); throw error; }
}
export function clearMeshMediaCache() {
  const folder = directory();
  if (folder.exists) folder.delete();
  for (const name of ['Audio', 'ExpoAudio']) {
    const recordings = new Directory(Paths.cache, name);
    if (!recordings.exists) continue;
    for (const file of recordings.list())
      if (file instanceof File && /^recording-[0-9a-f-]{36}\.m4a$/i.test(file.name)) file.delete();
  }
}

export const meshMediaCache = { save: cacheMeshMedia, clear: clearMeshMediaCache };
