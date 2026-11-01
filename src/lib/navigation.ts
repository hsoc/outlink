import { router } from 'expo-router';

/**
 * Ignore stale back events after the navigator unmounts, or
 * after an earlier queued tap has already returned to the root. Check at
 * dispatch time; a value captured during render can outlive the navigator.
 */
export function backSafely(): void {
  if (router.canGoBack()) router.back();
}
