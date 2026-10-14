/** Canonicalize relay addresses using Jumble's URL rules. Invalid addresses
 * throw so callers can reject user input or skip untrusted metadata. */
export function normalizeRelayUrl(url: string): string {
  url = url.trim();
  if (!url) throw new Error('A relay URL is required.');
  if (!url.includes('://')) {
    const local = url.startsWith('localhost:') || url.startsWith('localhost/') ||
      url.startsWith('127.') || url.startsWith('192.168.');
    url = `${local ? 'ws' : 'wss'}://${url}`;
  }
  const u = new URL(url);
  // The JavaScriptCore URL bridge does not lowercase these automatically.
  u.protocol = u.protocol.toLowerCase();
  u.host = u.host.toLowerCase();
  u.pathname = u.pathname.replace(/\/+/g, '/');
  if (u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    throw new Error(`Unsupported relay protocol: ${u.protocol}`);
  }
  if ((u.port === '80' && u.protocol === 'ws:') ||
    (u.port === '443' && u.protocol === 'wss:')) u.port = '';
  u.searchParams.sort();
  u.hash = '';
  return u.toString();
}

/** Normalize and deduplicate untrusted relay hints, ignoring malformed entries. */
export function normalizeRelayUrls(urls: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const url of urls) {
    try { normalized.add(normalizeRelayUrl(url)); } catch { /* Ignore invalid relay hints. */ }
  }
  return [...normalized];
}

/** Inbox defaults used when an account has no locally persisted DM relays. */
export const DEFAULT_DM_RELAYS = [
  'wss://nos.lol/',
  'wss://nip17.com/',
  'wss://relay.ditto.pub/',
];

/**
 * Relays we always consult when looking up someone else's metadata
 * (kind 0 profile, kind 10050 DM relay list). The user's own DM relays
 * may not have what we need — these are widely-replicated indexes.
 */
export const DISCOVERY_RELAYS = [
  'wss://nos.lol/',
  'wss://relay.primal.net/',
  'wss://relay.ditto.pub/',
  'wss://offchain.pub/',
];
