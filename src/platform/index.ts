import type { PlatformAdapters } from './ports';
import { getPlatform } from './registry';
export type * from './ports';
export const platform = new Proxy({} as PlatformAdapters, {
  get(_target, prop: keyof PlatformAdapters) { return getPlatform()[prop]; },
});
