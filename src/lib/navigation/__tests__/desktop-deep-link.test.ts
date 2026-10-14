import { normalizeDesktopDeepLink } from '../desktop-deep-link';

describe('normalizeDesktopDeepLink', () => {
  it('maps host-style and path-style links to routes', () => {
    expect(normalizeDesktopDeepLink('outlink://chat/abc?reply=1')).toBe('/chat/abc?reply=1');
    expect(normalizeDesktopDeepLink('outlink:///welcome')).toBe('/welcome');
    expect(normalizeDesktopDeepLink('outlink-dev://chat/abc?reply=1')).toBe('/chat/abc?reply=1');
  });

  it('rejects other schemes and unsafe route segments', () => {
    expect(normalizeDesktopDeepLink('https://example.com/chat/abc')).toBeNull();
    expect(normalizeDesktopDeepLink('outlink://chat/%2E%2E/settings')).toBeNull();
    expect(normalizeDesktopDeepLink('outlink://chat/a%2Fb')).toBeNull();
    expect(normalizeDesktopDeepLink('outlink://chat/a%5Cb')).toBeNull();
    expect(normalizeDesktopDeepLink('outlink-dev://chat/%2E%2E/settings')).toBeNull();
  });

  it('rejects fragments, credentials, and oversized payloads', () => {
    expect(normalizeDesktopDeepLink('outlink://chat/abc#fragment')).toBeNull();
    expect(normalizeDesktopDeepLink('outlink://user@example.com/chat')).toBeNull();
    expect(normalizeDesktopDeepLink(`outlink://chat/${'a'.repeat(9000)}`)).toBeNull();
  });
});
