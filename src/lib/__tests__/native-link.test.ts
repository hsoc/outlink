/** @jest-environment node */
import { safeNativePath } from '../native-link';
it.each([
  ['/settings', '/settings'], ['outlink://settings', '/settings'], ['outlink:///licenses', '/licenses'],
  ['outlink-dev://licenses?view=all', '/licenses'], ['/licenses#section', '/licenses'],
  ['/settings?value=%FF%FF%FF', '/settings'], ['/unknown?value=%FF', '/'],
  ['https://example.com/settings?x=%FF', '/'], ['outlink://%73ettings', '/'],
])('maps %s to a static route before query parsing', (input, expected) => {
  expect(safeNativePath(input)).toBe(expected);
});
it('rejects oversized external links without decoding their input', () => {
  expect(safeNativePath('outlink://settings?x=' + '%FF'.repeat(20000))).toBe('/');
});
