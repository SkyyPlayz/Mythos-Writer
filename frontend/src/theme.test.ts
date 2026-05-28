import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyTheme, normalizeTheme, THEME_MODES, relativeLuminance, contrastRatio, enforceContrastFloor, applyLiquidGlassTokens, resetLiquidGlassTokens, LIQUID_GLASS_DEFAULTS } from './theme';

const tokensCss = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

describe('token contrast floor (MYT-517 UX gate)', () => {
  // The sub-muted text colour failed the 4.5:1 floor on lighter surfaces, so
  // the faint/placeholder aliases must resolve to muted (the lowest legible
  // tier), never to a darker literal. Guards against reintroducing a failing tier.
  it('faint and placeholder text aliases collapse to --text-muted', () => {
    expect(tokensCss).toMatch(/--text-faint:\s*var\(--text-muted\)/);
    expect(tokensCss).toMatch(/--text-placeholder:\s*var\(--text-muted\)/);
  });
});

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

// ── MYT-716 contrast guard tests ─────────────────────────────────────────────

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('handles 3-char shorthand (#fff)', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
  });

  it('returns 0 for unparseable input', () => {
    expect(relativeLuminance('not-a-color')).toBe(0);
  });
});

describe('contrastRatio', () => {
  it('white on black = 21:1', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
  });

  it('black on black = 1:1', () => {
    expect(contrastRatio('#000000', '#000000')).toBeCloseTo(1, 5);
  });

  it('default body text (#bfd6e8) on bg (#0e1116) passes 4.5:1', () => {
    expect(contrastRatio('#bfd6e8', '#0e1116')).toBeGreaterThanOrEqual(4.5);
  });

  it('default header text (#edecf6) on bg (#0e1116) passes 4.5:1', () => {
    expect(contrastRatio('#edecf6', '#0e1116')).toBeGreaterThanOrEqual(4.5);
  });

  it('default muted text (#8a9bb0) on bg (#0e1116) passes 4.5:1', () => {
    expect(contrastRatio('#8a9bb0', '#0e1116')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('enforceContrastFloor', () => {
  const bg = '#0e1116';

  it('passes through a colour that already meets 4.5:1', () => {
    const result = enforceContrastFloor('#ffffff', bg, 4.5);
    expect(result).toBe('#ffffff');
    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens a near-black colour until it passes 4.5:1', () => {
    const result = enforceContrastFloor('#111111', bg, 4.5);
    expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('never returns a colour below 4.5:1 floor', () => {
    const darkColors = ['#222222', '#333333', '#444444', '#555555', '#1a2030'];
    for (const color of darkColors) {
      const result = enforceContrastFloor(color, bg, 4.5);
      expect(contrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('applyLiquidGlassTokens contrast guard (MYT-716)', () => {
  beforeEach(() => {
    document.documentElement.style.cssText = '';
  });

  afterEach(() => {
    resetLiquidGlassTokens();
  });

  it('applies default tokens without dropping below 4.5:1', () => {
    applyLiquidGlassTokens(LIQUID_GLASS_DEFAULTS);
    const root = document.documentElement;
    const header = root.style.getPropertyValue('--text-header');
    const body   = root.style.getPropertyValue('--text-body');
    const muted  = root.style.getPropertyValue('--text-muted');
    const bg = LIQUID_GLASS_DEFAULTS.bgBaseColor ?? '#0e1116';
    expect(contrastRatio(header, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(body,   bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(muted,  bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('clamps a below-floor body text colour to the floor', () => {
    applyLiquidGlassTokens({ ...LIQUID_GLASS_DEFAULTS, textBody: '#111111' });
    const root = document.documentElement;
    const body = root.style.getPropertyValue('--text-body');
    const bg = LIQUID_GLASS_DEFAULTS.bgBaseColor ?? '#0e1116';
    expect(contrastRatio(body, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('sets bg-image-size/repeat/position for image mode', () => {
    applyLiquidGlassTokens({
      ...LIQUID_GLASS_DEFAULTS,
      bgMode: 'image',
      bgFit: 'contain',
      bgPosition: 'top',
    }, 'data:image/png;base64,abc');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-image-size')).toBe('contain');
    expect(root.style.getPropertyValue('--bg-image-repeat')).toBe('no-repeat');
    expect(root.style.getPropertyValue('--bg-image-position')).toBe('top');
  });

  it('resets all new tokens on resetLiquidGlassTokens', () => {
    applyLiquidGlassTokens(LIQUID_GLASS_DEFAULTS);
    resetLiquidGlassTokens();
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bg-image-size')).toBe('');
    expect(root.style.getPropertyValue('--bg-scrim-alpha')).toBe('');
    expect(root.style.getPropertyValue('--text-header')).toBe('');
  });
});
