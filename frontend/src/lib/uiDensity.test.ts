import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampUiDens,
  commitUiDensity,
  densFromWheelDelta,
  densLabel,
  previewUiDensity,
  registerDensityBridge,
  resetDensityControlForTests,
  UI_DENS_MAX,
  UI_DENS_MIN,
} from './uiDensity';
import { LIQUID_NEON_V2_DEFAULTS, type LiquidNeonV2Settings } from '../theme/liquidNeonEngine';

describe('uiDensity (F2#9 / F2#17)', () => {
  afterEach(() => {
    resetDensityControlForTests();
  });

  it('clamps and labels density', () => {
    expect(clampUiDens(0.5)).toBe(UI_DENS_MIN);
    expect(clampUiDens(2)).toBe(UI_DENS_MAX);
    expect(densLabel(0.85)).toBe('compact');
    expect(densLabel(0.93)).toBe('cozy');
    expect(densLabel(1)).toBe('comfortable');
  });

  it('wheel delta steps density', () => {
    expect(densFromWheelDelta(1, 100)).toBeCloseTo(0.98);
    expect(densFromWheelDelta(1, -100)).toBeCloseTo(1.02);
  });

  it('commit goes through the registered bridge once', () => {
    const commit = vi.fn();
    let current: LiquidNeonV2Settings = { ...LIQUID_NEON_V2_DEFAULTS, slots: [...LIQUID_NEON_V2_DEFAULTS.slots] as LiquidNeonV2Settings['slots'] };
    registerDensityBridge({
      getSettings: () => current,
      cosmicBgUrl: '/cosmic.webp',
      commit: (next) => {
        current = next;
        commit(next);
      },
    });
    commitUiDensity(0.85);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].uiDens).toBeCloseTo(0.85);
    expect(commit.mock.calls[0][0].density).toBe('compact');
  });

  it('preview does not commit React state', () => {
    const commit = vi.fn();
    registerDensityBridge({
      getSettings: () => LIQUID_NEON_V2_DEFAULTS,
      cosmicBgUrl: '/cosmic.webp',
      commit,
    });
    previewUiDensity(0.9);
    expect(commit).not.toHaveBeenCalled();
  });
});
