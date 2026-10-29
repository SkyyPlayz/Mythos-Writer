// #1774 Accent breathe — the token driver (accentBreathe.ts) and its wiring
// through applyLiquidNeonV2Tokens. Phase 0 must equal the static engine output
// byte for byte; the off/paused rules are checked against the real signals
// (matchMedia change events, BackgroundStack's ln-anim-paused class, the
// app's data-contrast attribute).
import { createElement } from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import BackgroundStack from './BackgroundStack';
import {
  ACCENT_BREATHE_KEYS,
  ACCENT_BREATHE_LOOP_MS,
  ACCENT_BREATHE_TICK_MS,
  accentBreatheTokens,
  type AccentBreatheInput,
} from './accentBreathe';
import {
  applyLiquidNeonV2Tokens,
  computeLiquidNeonV2Tokens,
  normalizeLiquidNeonV2,
  resetLiquidNeonV2Tokens,
  type LiquidNeonV2Settings,
} from './liquidNeonEngine';
import { LIQUID_NEON_PRESETS, type LiquidNeonPresetKey } from './presets';

const COSMIC = '/assets/cosmic-bg.webp';
const REDUCE = '(prefers-reduced-motion: reduce)';
const CONTRAST = '(prefers-contrast: more)';
const FORCED = '(forced-colors: active)';
const LOOP = ACCENT_BREATHE_LOOP_MS;
const TICK = ACCENT_BREATHE_TICK_MS;

type Mql = { matches: boolean; media: string; listeners: Set<() => void>; addEventListener: (t: string, l: () => void) => void; removeEventListener: (t: string, l: () => void) => void };

/** Per-query MediaQueryList stubs with real listener sets; `fire` flips one and dispatches `change`. */
function stubMatchMedia(state: Record<string, boolean> = {}) {
  const lists = new Map<string, Mql>();
  const get = (query: string): Mql => {
    let m = lists.get(query);
    if (!m) {
      const listeners = new Set<() => void>();
      m = {
        matches: state[query] === true,
        media: query,
        listeners,
        addEventListener: (_t, l) => { listeners.add(l); },
        removeEventListener: (_t, l) => { listeners.delete(l); },
      };
      lists.set(query, m);
    }
    return m;
  };
  vi.stubGlobal('matchMedia', vi.fn((q: string) => get(q)));
  return {
    fire(query: string, matches: boolean) {
      const m = get(query);
      m.matches = matches;
      for (const l of [...m.listeners]) l();
    },
  };
}

/** The driver input the engine derives from settings (liquidNeonEngine.ts). */
function inputFor(over: Partial<LiquidNeonV2Settings> | null = null): AccentBreatheInput {
  const S = normalizeLiquidNeonV2(over);
  const I = S.reduceGlow ? Math.min(S.intensity, 5) / 25 : S.intensity / 25;
  return {
    enabled: S.accentBreathe && !S.reduceMotion,
    slots: S.slots,
    aB: .3 + .4 * I, aG: .18 + .5 * I, aGs: .05 + .13 * I,
    glowRh: Math.round((S.glowR || 26) / 2),
  };
}

const pick = (t: Record<string, string>) => Object.fromEntries(ACCENT_BREATHE_KEYS.map((k) => [k, t[k]]));
const base = (over: Partial<LiquidNeonV2Settings> | null = null) => computeLiquidNeonV2Tokens(over, COSMIC);
const preset = (key: LiquidNeonPresetKey): Partial<LiquidNeonV2Settings> => ({ setKey: key, slots: [...LIQUID_NEON_PRESETS[key].c] });
const rgbOf = (v: string) => v.slice(5, -1).split(',').slice(0, 3).map(Number);
const alphaOf = (v: string) => v.slice(v.lastIndexOf(',') + 1);

const el = document.documentElement;
const b1 = () => el.style.getPropertyValue('--b1');
const breathe = () => el.getAttribute('data-ln-breathe');
const setVisibility = (value: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { value, configurable: true });
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetLiquidNeonV2Tokens(el);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as unknown as Record<string, unknown>).visibilityState;
  el.classList.remove('ln-anim-paused');
  el.removeAttribute('data-contrast');
});

describe('accentBreatheTokens (pure blend)', () => {
  it('phase 0 equals the static engine tokens', () => {
    for (const key of ['classic', 'cyber', 'ember'] as const) {
      for (const intensity of [0, 50, 100]) {
        for (const reduceGlow of [true, false]) {
          const over = { ...preset(key), intensity, reduceGlow };
          expect(accentBreatheTokens(inputFor(over), 0)).toEqual(pick(base(over)));
        }
      }
    }
  });

  it('blends through all six theme colors per loop', () => {
    const input = inputFor();
    const b = base();
    const t0 = accentBreatheTokens(input, 0);
    // One hop = LOOP/6 = tick 32: every slot has moved one theme color along.
    const hop = accentBreatheTokens(input, LOOP / 6);
    expect(LOOP / 6 / TICK).toBe(32);
    expect(hop['--b1']).toBe(b['--b2']);
    expect(hop['--g3']).toBe(b['--g4']);
    expect(accentBreatheTokens(input, (5 * LOOP) / 6)['--b1']).toBe(b['--b6']);
    // Half a hop: each channel is the rounded midpoint of slot 1 → slot 2.
    const mid = accentBreatheTokens(input, LOOP / 12);
    const [c1, c2] = [rgbOf(b['--b1']), rgbOf(b['--b2'])];
    expect(rgbOf(mid['--b1'])).toEqual(c1.map((v, i) => Math.round((v + c2[i]) / 2)));
    // A full loop is phase 0 again.
    expect(accentBreatheTokens(input, LOOP)).toEqual(t0);
    // Alpha never changes (intensity / reduceGlow keep their effect).
    for (const ms of [TICK, LOOP / 12, LOOP / 3, LOOP / 2, LOOP - TICK]) {
      const t = accentBreatheTokens(input, ms);
      for (const k of ACCENT_BREATHE_KEYS) expect(alphaOf(t[k])).toBe(alphaOf(t0[k]));
    }
  });

  it('loop is 30–60 s and only glow/border tokens move', () => {
    expect(LOOP).toBeGreaterThanOrEqual(30_000);
    expect(LOOP).toBeLessThanOrEqual(60_000);
    expect([...ACCENT_BREATHE_KEYS]).toEqual([
      '--b1', '--b2', '--b3', '--b4', '--b5', '--b6',
      '--g1', '--g2', '--g3', '--g4', '--g5', '--g6',
      '--gs1', '--gs2', '--gs3', '--gs4', '--gs5', '--gs6',
      '--bh', '--glowH',
    ]);
    for (const k of ACCENT_BREATHE_KEYS) expect(k).not.toMatch(/^--n\d$|^--grad$/);
  });
});

describe('driver via applyLiquidNeonV2Tokens', () => {
  it('runs by default and drifts only the accent tokens', async () => {
    stubMatchMedia();
    const b = base();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    expect(breathe()).toBe('running');
    expect(b1()).toBe(b['--b1']);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(b1()).not.toBe(b['--b1']);
    expect(el.style.getPropertyValue('--n1')).toBe(b['--n1']);
    expect(el.style.getPropertyValue('--grad')).toBe(b['--grad']);
    await vi.advanceTimersByTimeAsync(LOOP - TICK); // 192 ticks in all
    expect(b1()).toBe(b['--b1']);
  });

  it('hidden window freezes the blend (real BackgroundStack)', async () => {
    stubMatchMedia();
    const input = inputFor();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    render(createElement(BackgroundStack, { settings: null }));
    await vi.advanceTimersByTimeAsync(1000);
    const frozen = b1();
    expect(frozen).toBe(accentBreatheTokens(input, 1000)['--b1']);
    const timersBefore = vi.getTimerCount();

    setVisibility('hidden');
    fireEvent(document, new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(el.classList.contains('ln-anim-paused')).toBe(true);
    expect(breathe()).toBe('paused');
    expect(vi.getTimerCount()).toBe(timersBefore - 1); // the breathe interval is gone
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b1()).toBe(frozen);

    setVisibility('visible');
    fireEvent(document, new Event('visibilitychange'));
    // 10 s hidden also tripped the idle timer; activity clears it like a real user.
    fireEvent.pointerMove(window);
    await vi.advanceTimersByTimeAsync(0);
    expect(breathe()).toBe('running');
    expect(b1()).toBe(frozen); // no snap on resume
    await vi.advanceTimersByTimeAsync(TICK);
    expect(b1()).toBe(accentBreatheTokens(input, 1000 + TICK)['--b1']);
  });

  it('idle path also freezes', async () => {
    stubMatchMedia();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    render(createElement(BackgroundStack, { settings: null }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(breathe()).toBe('paused');
    const frozen = b1();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b1()).toBe(frozen);
    fireEvent.pointerMove(window);
    await vi.advanceTimersByTimeAsync(0);
    expect(breathe()).toBe('running');
    await vi.advanceTimersByTimeAsync(TICK);
    expect(b1()).not.toBe(frozen);
  });

  it('prefers-reduced-motion turns it off, live', async () => {
    const mm = stubMatchMedia({ [REDUCE]: true });
    const spy = vi.spyOn(globalThis, 'setInterval');
    const b = base();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    expect(breathe()).toBe('off');
    await vi.advanceTimersByTimeAsync(5000);
    expect(b1()).toBe(b['--b1']);
    expect(spy.mock.calls.some((c) => c[1] === TICK)).toBe(false);

    mm.fire(REDUCE, false);
    expect(breathe()).toBe('running');
    await vi.advanceTimersByTimeAsync(1000);
    expect(b1()).not.toBe(b['--b1']);

    mm.fire(REDUCE, true);
    expect(breathe()).toBe('off');
    expect(b1()).toBe(b['--b1']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b1()).toBe(b['--b1']);
  });

  it('in-app Reduce motion turns it off', async () => {
    stubMatchMedia();
    const b = base();
    applyLiquidNeonV2Tokens({ reduceMotion: true }, COSMIC, el);
    expect(breathe()).toBe('off');
    await vi.advanceTimersByTimeAsync(5000);
    expect(b1()).toBe(b['--b1']);
  });

  it('toggle off restores the theme colours', async () => {
    stubMatchMedia();
    const b = base();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    await vi.advanceTimersByTimeAsync(3000);
    expect(b1()).not.toBe(b['--b1']);
    applyLiquidNeonV2Tokens({ accentBreathe: false }, COSMIC, el);
    expect(breathe()).toBe('off');
    expect(b1()).toBe(b['--b1']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b1()).toBe(b['--b1']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('high contrast, prefers-contrast:more and forced-colors turn it off', async () => {
    const mm = stubMatchMedia();
    const b = base();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    expect(breathe()).toBe('running');
    await vi.advanceTimersByTimeAsync(1000);

    el.setAttribute('data-contrast', 'high');
    await vi.advanceTimersByTimeAsync(0);
    expect(breathe()).toBe('off');
    expect(b1()).toBe(b['--b1']);
    el.removeAttribute('data-contrast');
    await vi.advanceTimersByTimeAsync(0);
    expect(breathe()).toBe('running');

    for (const q of [CONTRAST, FORCED]) {
      await vi.advanceTimersByTimeAsync(1000);
      mm.fire(q, true);
      expect(breathe()).toBe('off');
      expect(b1()).toBe(b['--b1']);
      expect(vi.getTimerCount()).toBe(0);
      mm.fire(q, false);
      expect(breathe()).toBe('running');
    }
  });

  it('no matchMedia → off, no timers', async () => {
    vi.stubGlobal('matchMedia', undefined);
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    expect(breathe()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(b1()).toBe(base()['--b1']);
  });

  it('re-apply mid-loop keeps the phase', async () => {
    stubMatchMedia();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    await vi.advanceTimersByTimeAsync(5000);
    const snap = () => Object.fromEntries(ACCENT_BREATHE_KEYS.map((k) => [k, el.style.getPropertyValue(k)]));
    const before = snap();
    expect(before).toEqual(accentBreatheTokens(inputFor(), 5000));
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    expect(snap()).toEqual(before);
    applyLiquidNeonV2Tokens(preset('cyber'), COSMIC, el);
    expect(snap()).toEqual(accentBreatheTokens(inputFor(preset('cyber')), 5000));
  });

  it('reset stops the driver', async () => {
    stubMatchMedia();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    await vi.advanceTimersByTimeAsync(1000);
    resetLiquidNeonV2Tokens(el);
    expect(el.hasAttribute('data-ln-breathe')).toBe(false);
    expect(b1()).toBe('');
    const spy = vi.spyOn(el.style, 'setProperty');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(spy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a tick cancels only the transitions its own write started', async () => {
    stubMatchMedia();
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    const target = document.createElement('div');
    const anim = (transitionProperty?: string) => ({
      ...(transitionProperty ? { transitionProperty } : {}),
      effect: { target, pseudoElement: null },
      cancel: vi.fn(),
    }) as unknown as Animation;
    const userOpacity = anim('opacity'); // running (or just flushed) before the tick
    const userBorder = anim('border-top-color'); // running before; the tick retargets it…
    const retargeted = anim('border-top-color'); // …so this replacement keeps running
    const own = anim('box-shadow'); // started by the tick's own color step
    const keyframes = anim(); // a CSS animation that appeared meanwhile
    let written = false;
    const real = el.style.setProperty.bind(el.style);
    vi.spyOn(el.style, 'setProperty').mockImplementation((k: string, v: string | null, p?: string) => {
      written = true;
      real(k, v, p);
    });
    const flushes: boolean[] = [];
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => {
        flushes.push(written);
        return written ? [userOpacity, retargeted, own, keyframes] : [userOpacity, userBorder];
      },
    });
    try {
      await vi.advanceTimersByTimeAsync(TICK);
      // One flush before the write (pending user changes start with transitions on), one after.
      expect(flushes).toEqual([false, true]);
      expect(own.cancel).toHaveBeenCalledTimes(1);
      for (const a of [userOpacity, userBorder, retargeted, keyframes]) expect(a.cancel).not.toHaveBeenCalled();
      // A re-apply (user edit) keeps its normal transitions: no flush, no cancel.
      flushes.length = 0;
      applyLiquidNeonV2Tokens(preset('cyber'), COSMIC, el);
      expect(flushes).toEqual([]);
    } finally {
      delete (document as unknown as Record<string, unknown>).getAnimations;
    }
  });

  it('perf structure', async () => {
    const mm = stubMatchMedia();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    const spy = vi.spyOn(el.style, 'setProperty');
    await vi.advanceTimersByTimeAsync(1000);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBeLessThanOrEqual((1000 / TICK) * ACCENT_BREATHE_KEYS.length);
    for (const [k] of spy.mock.calls) expect(ACCENT_BREATHE_KEYS as readonly string[]).toContain(k);
    expect(raf).not.toHaveBeenCalled();

    // Six identical slots: every phase is the same color → changed-only writes make none.
    const flat = { slots: Array(6).fill('#00f0ff') as LiquidNeonV2Settings['slots'] };
    applyLiquidNeonV2Tokens(flat, COSMIC, el);
    expect(breathe()).toBe('running');
    spy.mockClear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(spy).not.toHaveBeenCalled();

    // Paused and off leave no breathe timer behind.
    applyLiquidNeonV2Tokens(undefined, COSMIC, el);
    el.classList.add('ln-anim-paused');
    await vi.advanceTimersByTimeAsync(0);
    expect(breathe()).toBe('paused');
    expect(vi.getTimerCount()).toBe(0);
    el.classList.remove('ln-anim-paused');
    await vi.advanceTimersByTimeAsync(0);
    expect(breathe()).toBe('running');
    mm.fire(REDUCE, true);
    expect(breathe()).toBe('off');
    expect(vi.getTimerCount()).toBe(0);
  });
});
