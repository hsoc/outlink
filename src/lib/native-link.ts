/** This app has static routes and no external query-parameter contract. */
export function safeNativePath(path: string): string {
  if (typeof path !== 'string' || path.length > 4096) return '/';
  // Discard queries before any dependency attempts tolerant percent decoding.
  const route = path.split(/[?#]/, 1)[0].replace(/^outlink(?:-dev)?:\/\//i, '').replace(/^\/+|\/+$/g, '');
  return route === 'settings' || route === 'licenses' ? `/${route}` : '/';
}
