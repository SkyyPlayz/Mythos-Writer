// Part H design-system polish — shared reduced-motion guard for JS call sites
// (programmatic smooth scrolling must fall back to instant under reduced motion).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from './reducedMotion';

function stubMatchMedia(matches: boolean): ReturnType<typeof vi.fn> {
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  return matchMedia;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefersReducedMotion', () => {
  it('returns true when the reduce media query matches', () => {
    const matchMedia = stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('returns false when the reduce media query does not match', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('returns false when matchMedia is unavailable (jsdom default / SSR guard)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe('scrollBehavior', () => {
  it("returns 'auto' under reduced motion so programmatic scrolls are instant", () => {
    stubMatchMedia(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it("returns 'smooth' when motion is allowed", () => {
    stubMatchMedia(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it("returns 'smooth' when matchMedia is unavailable", () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(scrollBehavior()).toBe('smooth');
  });
});
