/**
 * PLAN-IDLE-CATCH-UP — renderer `AppSettings.idleCatchUp` clamp matrix.
 *
 * Purpose: owns the renderer normalizer / clamp unit rows; never renders UI.
 * Expected values are written out on purpose — do not derive them from the
 * constants under test. Main mirrors these rows in
 * electron-main/src/idleCatchUpSettings.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  IDLE_CATCH_UP_DEFAULTS,
  IDLE_CATCH_UP_DEFAULT_MINUTES,
  IDLE_CATCH_UP_MAX_MINUTES,
  IDLE_CATCH_UP_MIN_MINUTES,
  clampIdleCatchUpMinutes,
  normalizeIdleCatchUp,
} from './settings.aug';

describe('idle catch-up defaults', () => {
  it('pins the product defaults and bounds', () => {
    expect(IDLE_CATCH_UP_DEFAULTS).toEqual({ enabled: true, minutes: 2 });
    expect(IDLE_CATCH_UP_DEFAULT_MINUTES).toBe(2);
    expect(IDLE_CATCH_UP_MIN_MINUTES).toBe(1);
    expect(IDLE_CATCH_UP_MAX_MINUTES).toBe(30);
  });

  it('defaults object is frozen so a caller cannot mutate it', () => {
    expect(Object.isFrozen(IDLE_CATCH_UP_DEFAULTS)).toBe(true);
  });
});

describe('clampIdleCatchUpMinutes', () => {
  it.each([
    [0, 1],
    [-4, 1],
    [1, 1],
    [2, 2],
    [30, 30],
    [99, 30],
    [2.6, 3],
    [2.4, 2],
    ['5', 5],
    [' 7 ', 7],
    ['40', 30],
  ])('%j clamps to %j', (raw, expected) => {
    expect(clampIdleCatchUpMinutes(raw)).toBe(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ["'abc'", 'abc'],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ["''", ''],
    ["'   '", '   '],
    ['null', null],
    ['undefined', undefined],
    ['an object', { n: 5 }],
    ['a boolean', true],
  ])('junk (%s) → 2', (_label, raw) => {
    expect(clampIdleCatchUpMinutes(raw)).toBe(2);
  });
});

describe('normalizeIdleCatchUp', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'on'],
    ['a number', 5],
    ['an array', [true, 5]],
    ['an empty object', {}],
  ])('missing / malformed (%s) → { enabled: true, minutes: 2 }', (_label, raw) => {
    expect(normalizeIdleCatchUp(raw)).toEqual({ enabled: true, minutes: 2 });
  });

  it('returns a fresh object, not the frozen defaults', () => {
    const out = normalizeIdleCatchUp(undefined);
    expect(out).not.toBe(IDLE_CATCH_UP_DEFAULTS);
    expect(Object.isFrozen(out)).toBe(false);
  });

  it('enabled is false only when it is explicitly false', () => {
    expect(normalizeIdleCatchUp({ enabled: false, minutes: 2 }).enabled).toBe(false);
    for (const enabled of [true, undefined, null, 0, '', 'false', 'no']) {
      expect(normalizeIdleCatchUp({ enabled, minutes: 2 }).enabled, String(enabled)).toBe(true);
    }
  });

  it('clamps minutes through the same rules', () => {
    expect(normalizeIdleCatchUp({ enabled: true, minutes: 0 })).toEqual({ enabled: true, minutes: 1 });
    expect(normalizeIdleCatchUp({ enabled: true, minutes: 99 })).toEqual({ enabled: true, minutes: 30 });
    expect(normalizeIdleCatchUp({ enabled: false, minutes: 2.6 })).toEqual({ enabled: false, minutes: 3 });
    expect(normalizeIdleCatchUp({ enabled: true, minutes: 'abc' })).toEqual({ enabled: true, minutes: 2 });
    expect(normalizeIdleCatchUp({ enabled: true, minutes: Number.NaN })).toEqual({ enabled: true, minutes: 2 });
    expect(normalizeIdleCatchUp({ enabled: true, minutes: Infinity })).toEqual({ enabled: true, minutes: 2 });
    expect(normalizeIdleCatchUp({ enabled: true, minutes: '5' })).toEqual({ enabled: true, minutes: 5 });
    expect(normalizeIdleCatchUp({ enabled: false })).toEqual({ enabled: false, minutes: 2 });
  });

  it('drops unknown keys', () => {
    expect(normalizeIdleCatchUp({ enabled: false, minutes: 4, extra: 'x' })).toEqual({ enabled: false, minutes: 4 });
  });
});
