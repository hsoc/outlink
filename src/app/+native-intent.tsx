import { safeNativePath } from '@/lib/native-link';
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return safeNativePath(path);
}
