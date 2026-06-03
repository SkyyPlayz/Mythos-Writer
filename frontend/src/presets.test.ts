import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  BUNDLED_PRESETS,
  REFINEMENT_CHIPS,
  DEFAULT_PRESET_ID,
  TONE_VALUES,
  LENGTH_VALUES,
  getPresetById,
  getEffectiveAxes,
  buildPresetContext,
  loadSessionPreset,
  saveSessionPreset,
} from './presets';

describe('BUNDLED_PRESETS', () => {
  it('has at least 5 presets', () => {
    expect(BUNDLED_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('each preset has required axes', () => {
    for (const preset of BUNDLED_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.axes.genre).toBeTruthy();
      expect(TONE_VALUES).toContain(preset.axes.tone);
      expect(LENGTH_VALUES).toContain(preset.axes.length);
    }
  });

  it('DEFAULT_PRESET_ID resolves to a valid preset', () => {
    const preset = getPresetById(DEFAULT_PRESET_ID);
    expect(preset).toBeDefined();
    expect(preset.id).toBe(DEFAULT_PRESET_ID);
  });

  it('getPresetById falls back to first preset for unknown id', () => {
    const fallback = getPresetById('nonexistent-id');
    expect(fallback).toBe(BUNDLED_PRESETS[0]);
  });
});

describe('getEffectiveAxes', () => {
  it('returns base axes when no overrides', () => {
    const axes = getEffectiveAxes('preset-epic-fantasy', {});
    expect(axes.genre).toBe('Fantasy');
    expect(axes.tone).toBe('serious');
  });

  it('applies overrides on top of base axes', () => {
    const axes = getEffectiveAxes('preset-epic-fantasy', { tone: 'warm', length: 'brief' });
    expect(axes.tone).toBe('warm');
    expect(axes.length).toBe('brief');
    expect(axes.genre).toBe('Fantasy'); // unchanged
  });
});

describe('buildPresetContext', () => {
  it('includes genre and tone in output string', () => {
    const axes = getEffectiveAxes('preset-epic-fantasy', {});
    const context = buildPresetContext(axes);
    expect(context).toContain('Fantasy');
    expect(context).toContain('Serious');
  });

  it('includes content constraints when set', () => {
    const axes = getEffectiveAxes('preset-ya-adventure', {});
    const context = buildPresetContext(axes);
    expect(context).toContain('Avoid');
  });

  it('excludes Avoid section when no constraints', () => {
    const axes = getEffectiveAxes('preset-cozy-mystery', {});
    const context = buildPresetContext(axes);
    expect(context).not.toContain('Avoid');
  });
});

describe('REFINEMENT_CHIPS', () => {
  it('warmer chip increases tone index toward joyful', () => {
    const axes = getEffectiveAxes('preset-epic-fantasy', {}); // tone: serious
    const warmer = REFINEMENT_CHIPS.find((c) => c.id === 'warmer')!;
    const result = { ...axes, ...warmer.adjustAxes(axes) };
    expect(TONE_VALUES.indexOf(result.tone)).toBeGreaterThan(TONE_VALUES.indexOf(axes.tone));
  });

  it('darker chip does not go below grim', () => {
    const axes = getEffectiveAxes('preset-literary-fiction', {}); // tone: grim (floor)
    const darker = REFINEMENT_CHIPS.find((c) => c.id === 'darker')!;
    const result = { ...axes, ...darker.adjustAxes(axes) };
    expect(result.tone).toBe('grim');
  });

  it('shorter chip reduces length index', () => {
    const axes = getEffectiveAxes('preset-epic-fantasy', {}); // length: moderate
    const shorter = REFINEMENT_CHIPS.find((c) => c.id === 'shorter')!;
    const result = { ...axes, ...shorter.adjustAxes(axes) };
    expect(LENGTH_VALUES.indexOf(result.length)).toBeLessThan(LENGTH_VALUES.indexOf(axes.length));
  });

  it('longer chip does not exceed expansive', () => {
    const axes = getEffectiveAxes('preset-literary-fiction', {}); // length: expansive (ceiling)
    const longer = REFINEMENT_CHIPS.find((c) => c.id === 'longer')!;
    const result = { ...axes, ...longer.adjustAxes(axes) };
    expect(result.length).toBe('expansive');
  });
});

describe('sessionStorage helpers', () => {
  const storage: Record<string, string> = {};
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: (k: string) => storage[k] ?? null,
        setItem: (k: string, v: string) => { storage[k] = v; },
        removeItem: (k: string) => { delete storage[k]; },
      },
      writable: true,
      configurable: true,
    });
  });
  afterEach(() => {
    for (const k of Object.keys(storage)) delete storage[k];
  });

  it('loadSessionPreset returns defaults when storage is empty', () => {
    const { presetId, overrides } = loadSessionPreset();
    expect(presetId).toBe(DEFAULT_PRESET_ID);
    expect(overrides).toEqual({});
  });

  it('round-trips preset id and overrides through storage', () => {
    saveSessionPreset('preset-cozy-mystery', { tone: 'warm' });
    const { presetId, overrides } = loadSessionPreset();
    expect(presetId).toBe('preset-cozy-mystery');
    expect(overrides.tone).toBe('warm');
  });

  it('ignores unknown preset id in storage', () => {
    storage['mythos:session-preset-id'] = 'not-a-real-preset';
    const { presetId } = loadSessionPreset();
    expect(presetId).toBe(DEFAULT_PRESET_ID);
  });
});
