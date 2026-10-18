import { platform } from '@/platform';
import { RelayDirectoryRefresh } from './relay-directory';
// Lazy construction avoids network/platform access during module loading.
let refresh: RelayDirectoryRefresh | undefined;
export function refreshAreaRelays() { return (refresh ??= new RelayDirectoryRefresh(platform.preferences)).refresh(); }
export function stopRelayRefresh() { refresh?.stop(); return refresh?.idle() ?? Promise.resolve(); }
