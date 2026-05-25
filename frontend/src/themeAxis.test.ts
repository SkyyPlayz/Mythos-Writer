import {
  applyThemeAxis,
  clampAxis,
  computeAxisTokens,
  contrastRatio,
  normalizeAxis,
  relativeLuminance,
  CONTRAST_FLOOR,
  CONTRAST_GUARD_TARGET,
  THEME_AXIS_DEFAULT,
  THEME_AXIS_OS_HC_MIN,
} from './themeAxis';

describe('themeAxis — interpolation (MYT-520 §4.2)', () => {
  it('hits the soft endpoints at s=0', () => {
    const { vars } = computeAxisTokens(0);
    expect(vars['--axis-bg-base']).toBe('#141b26');
    expect(vars['--axis-glass-fallback']).toBe('#222a36');
    expect(vars['--axis-text-body']).toBe('#c9dcec');
    expect(vars['--axis-glass-alpha']).toBe('0.13');
    expect(vars['--axis-neon-intensity']).toBe('0.5');
    expect(vars['--axis-blur-panel']).toBe('40px');
    expect(vars['--axis-glow-md-blur']).toBe('34px');
    expect(vars['--axis-glass-rim-alpha']).toBe('0.1');
  });

  it('hits the sharp endpoints at s=1', () => {
    const { vars } = computeAxisTokens(1);
    expect(vars['--axis-bg-base']).toBe('#0b0e13');
    expect(vars['--axis-glass-fallback']).toBe('#15191f');
    expect(vars['--axis-text-body']).toBe('#bfd6e8');
    expect(vars['--axis-text-header']).toBe('#ffffff');
    expect(vars['--axis-glass-alpha']).toBe('0.06');
    expect(vars['--axis-neon-intensity']).toBe('1');
    expect(vars['--axis-blur-panel']).toBe('18px');
  });

  it('interpolates monotonically between the ends', () => {
    const mid = computeAxisTokens(0.5).vars['--axis-neon-intensity'];
    expect(Number(mid)).toBeCloseTo(0.75, 5);
  });
});

describe('themeAxis — contrast floor is a hard invariant (MYT-520 §4.4)', () => {
  // Body text must never drop below 4.5:1 against the opaque fallback at ANY
  // slider position. Sweep the whole axis, not just the endpoints.
  it('keeps body text ≥ floor across the full axis', () => {
    for (let s = 0; s <= 1.0001; s += 0.02) {
      const { bodyContrast } = computeAxisTokens(s);
      expect(bodyContrast).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
      expect(bodyContrast).toBeGreaterThanOrEqual(CONTRAST_GUARD_TARGET);
    }
  });

  it('reports the three §9 acceptance ratios (soft / default / sharp)', () => {
    const soft = computeAxisTokens(0).bodyContrast;
    const def = computeAxisTokens(THEME_AXIS_DEFAULT).bodyContrast;
    const sharp = computeAxisTokens(1).bodyContrast;
    // Pre-verified well above the floor (softest panel ≈ 8.5:1 per spec).
    expect(soft).toBeGreaterThan(8);
    expect(def).toBeGreaterThan(8);
    expect(sharp).toBeGreaterThan(8);
  });

  it('contrastRatio + relativeLuminance match WCAG anchors', () => {
    // white on black = 21:1; identical colours = 1:1.
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 0);
    expect(contrastRatio([18, 18, 18], [18, 18, 18])).toBeCloseTo(1, 5);
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 5);
  });
});

describe('themeAxis — clamp / normalize / OS interaction (MYT-520 §4.5)', () => {
  it('clamps to [0,1]', () => {
    expect(clampAxis(-0.5)).toBe(0);
    expect(clampAxis(1.5)).toBe(1);
    expect(clampAxis(0.4)).toBe(0.4);
  });

  it('floors at 0.6 under OS increased-contrast (cannot go softer)', () => {
    expect(clampAxis(0.2, { osHighContrast: true })).toBe(THEME_AXIS_OS_HC_MIN);
    expect(clampAxis(0.9, { osHighContrast: true })).toBe(0.9); // sharper still allowed
  });

  it('normalizes garbage / out-of-range to a valid position', () => {
    expect(normalizeAxis(undefined)).toBe(THEME_AXIS_DEFAULT);
    expect(normalizeAxis('not-a-number')).toBe(THEME_AXIS_DEFAULT);
    expect(normalizeAxis(2)).toBe(1);
    expect(normalizeAxis(-1)).toBe(0);
    expect(normalizeAxis(0.33)).toBe(0.33);
  });
});

describe('themeAxis — DOM application', () => {
  afterEach(() => {
    document.getElementById('mythos-theme-axis')?.remove();
  });

  it('injects a single <style> with the axis source vars and updates in place', () => {
    applyThemeAxis(0.4);
    const el = document.getElementById('mythos-theme-axis');
    expect(el).toBeTruthy();
    expect(el?.tagName).toBe('STYLE');
    expect(el?.textContent).toContain('--axis-glass-alpha');
    expect(el?.textContent).toContain(':root');

    // Re-apply: same element reused (no duplicates), content swapped.
    applyThemeAxis(1);
    expect(document.querySelectorAll('#mythos-theme-axis').length).toBe(1);
    expect(document.getElementById('mythos-theme-axis')?.textContent).toContain('#15191f');
  });

  it('never sets a PUBLIC token directly (so high-contrast/media queries win)', () => {
    applyThemeAxis(0.4);
    const css = document.getElementById('mythos-theme-axis')?.textContent ?? '';
    // Only --axis-* source vars; never the bare public tokens.
    expect(css).not.toMatch(/^\s*--glass-fill:/m);
    expect(css).not.toMatch(/^\s*--text-body:/m);
    expect(css).not.toMatch(/^\s*--neon-intensity:/m);
  });
});
