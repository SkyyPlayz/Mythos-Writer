import { applyTheme, normalizeTheme, THEME_MODES } from './theme';

describe('theme (dark-only, MYT-517)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-contrast');
  });

  it('only supports dark and high-contrast', () => {
    expect([...THEME_MODES]).toEqual(['dark', 'high-contrast']);
  });

  it('normalizes legacy light/system values to dark', () => {
    expect(normalizeTheme('light')).toBe('dark');
    expect(normalizeTheme('system')).toBe('dark');
    expect(normalizeTheme(undefined)).toBe('dark');
    expect(normalizeTheme('high-contrast')).toBe('high-contrast');
  });

  it('applies dark theme without a contrast overlay', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });

  it('applies the high-contrast overlay and clears it again', () => {
    applyTheme('high-contrast');
    expect(document.documentElement.getAttribute('data-contrast')).toBe('high');
    applyTheme('dark');
    expect(document.documentElement.hasAttribute('data-contrast')).toBe(false);
  });

  it('coerces a legacy stored value when applying', () => {
    expect(applyTheme('light')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
