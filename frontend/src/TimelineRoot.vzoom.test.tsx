import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readStoredTlVZoom } from './TimelineRoot';
import { clampVZoom } from './timeline2/axis/stamps';

describe('F3#5 Timeline first-open vertical zoom', () => {
  const KEY = 'timeline:tlVZoom';

  beforeEach(() => {
    localStorage.removeItem(KEY);
  });
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('missing key → 100 (not Number(null)→0→40 floor)', () => {
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(Number(null)).toBe(0); // documents the bug this guards
    expect(clampVZoom(0)).toBe(40);
    expect(readStoredTlVZoom()).toBe(100);
  });

  it('empty / 0 stored values treated as unset → 100', () => {
    localStorage.setItem(KEY, '');
    expect(readStoredTlVZoom()).toBe(100);
    localStorage.setItem(KEY, '0');
    expect(readStoredTlVZoom()).toBe(100);
  });

  it('persisted 120 is restored', () => {
    localStorage.setItem(KEY, '120');
    expect(readStoredTlVZoom()).toBe(120);
  });
});
