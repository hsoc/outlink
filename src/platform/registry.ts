import { createExpoAdapters } from './expo';
import type { PlatformAdapters } from './ports';

let adapters: PlatformAdapters | null = null;

/** Lazily resolve mobile adapters after module initialization. */
export function getPlatform(): PlatformAdapters {
  if (!adapters) adapters = createExpoAdapters();
  return adapters;
}
