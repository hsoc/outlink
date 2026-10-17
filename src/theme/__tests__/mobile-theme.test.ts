import { resolveEffectiveColorScheme } from '../effective-color-scheme';
import { mobileFontWeight, mobileTypography } from '../typography';
it('keeps explicit light/dark selections and system appearance deterministic', () => {
  expect(resolveEffectiveColorScheme('light','dark')).toBe('light');
  expect(resolveEffectiveColorScheme('dark','light')).toBe('dark');
  expect(resolveEffectiveColorScheme('system','dark')).toBe('dark');
  expect(resolveEffectiveColorScheme('system','light')).toBe('light');
});
it('retains the existing mobile text scale and weight', () => {
  expect(mobileTypography.subtitle).toMatchObject({fontSize:17,lineHeight:24});
  expect(mobileTypography.body).toMatchObject({fontSize:15,lineHeight:22});
  expect(mobileFontWeight.semibold).toBe('600');
});
