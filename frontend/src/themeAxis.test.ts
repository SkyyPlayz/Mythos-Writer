/**
 * themeAxis.test.ts — MYT-726 §9.3 guard hardening
 *
 * Verifies that readContrastFloors() composites the glass fill over the canvas
 * at each preset's alpha, producing distinct contrast ratios for soft / default
 * / sharp rather than returning the same value for all three.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { contrastRatio, readContrastFloors, AXIS_PRESETS } from './themeAxis';

describe('contrastRatio', () => {
  it('returns ~21:1 for white on black', () => {
    const r = contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)');
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThanOrEqual(21);
  });

  it('returns 1 for identical colours', () => {
    expect(contrastRatio('rgb(128, 128, 128)', 'rgb(128, 128, 128)')).toBeCloseTo(1, 1);
  });

  it('returns 0 when a colour cannot be parsed', () => {
    expect(contrastRatio('not-a-colour', 'rgb(0,0,0)')).toBe(0);
  });
});

describe('AXIS_PRESETS glass values are strictly ordered', () => {
  it('soft < default < sharp', () => {
    expect(AXIS_PRESETS.soft.glass).toBeLessThan(AXIS_PRESETS.default.glass);
    expect(AXIS_PRESETS.default.glass).toBeLessThan(AXIS_PRESETS.sharp.glass);
  });
});

describe('readContrastFloors — §9.3 compositing guard (MYT-726)', () => {
  beforeEach(() => {
    // Use rgb() strings so parseRgb can parse them.
    // A white canvas maximises compositing difference between presets:
    // more glass opacity → darker panel → more contrast with light text.
    document.documentElement.style.setProperty('--text-header', 'rgb(237, 236, 246)');
    document.documentElement.style.setProperty('--text-body', 'rgb(191, 214, 232)');
    document.documentElement.style.setProperty('--bg-base', 'rgb(255, 255, 255)');
  });

  it('returns non-zero values for all three presets', () => {
    const floors = readContrastFloors();
    expect(floors.soft).toBeGreaterThan(0);
    expect(floors.default).toBeGreaterThan(0);
    expect(floors.sharp).toBeGreaterThan(0);
  });

  it('soft / default / sharp produce distinct contrast ratios', () => {
    const { soft, default: def, sharp } = readContrastFloors();
    // Each preset composites at a different alpha — values must differ
    expect(soft).not.toBeCloseTo(def, 2);
    expect(def).not.toBeCloseTo(sharp, 2);
    expect(soft).not.toBeCloseTo(sharp, 2);
  });

  it('soft < default < sharp against a light canvas', () => {
    // Higher glass alpha → darker composited panel → more contrast with light text
    const { soft, default: def, sharp } = readContrastFloors();
    expect(soft).toBeLessThan(def);
    expect(def).toBeLessThan(sharp);
  });
});
