/**
 * SKY-11787 — the adaptive per-panel text-backing.
 *
 * The acceptance numbers live in `scripts/wallpapers/measure-pack.mjs` (it has
 * the real WebP decoder and the real pack); these tests pin the parts that can
 * silently drift without any image: the solver's contract, the guarantee that
 * a wallpaper which already passes gets no backing at all, and the CSS the
 * engine emits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AA_BODY_RATIO,
  MAX_BACKING_ALPHA,
  PEAK_CELLS_X,
  PEAK_CELLS_Y,
  backingFill,
  knownWallpaperPeak,
  peakCellLuminance,
  relativeLuminance8,
  resetTextBackingForTests,
  scheduleTextBacking,
  solveBackingAlpha,
  textBackingToken,
} from './textBacking';
import { applyLiquidNeonV2Tokens, LIQUID_NEON_V2_DEFAULTS, resetLiquidNeonV2Tokens } from './liquidNeonEngine';

const BODY_LUM = relativeLuminance8(0xc8, 0xd3, 0xe7);
const GLASS_LUM = relativeLuminance8(13, 16, 28);
const SCRIM_LUM = relativeLuminance8(4, 5, 11);

/** The luminance body text ends up on, with `alpha` of backing over the stack. */
function backdropLuminance(peakLum: number, scrim: number, glassA: number, alpha: number): number {
  const pre = peakLum * (1 - scrim / 100) + SCRIM_LUM * (scrim / 100);
  const panel = pre * (1 - glassA / 100) + GLASS_LUM * (glassA / 100);
  return panel * (1 - alpha) + GLASS_LUM * alpha;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('solveBackingAlpha', () => {
  const DEFAULTS = { scrim: 10, glassA: 20 };

  it('adds nothing when the wallpaper already clears AA behind body text', () => {
    // noir-1's measured peak cell (scripts/wallpapers/measure-pack.mjs).
    expect(solveBackingAlpha({ peakLum: 0.127, ...DEFAULTS })).toBe(0);
    expect(solveBackingAlpha({ peakLum: 0, ...DEFAULTS })).toBe(0);
  });

  it('reaches at least 4.5:1 for every peak from pitch black to pure white', () => {
    for (let peak = 0; peak <= 1.0001; peak += 0.01) {
      const alpha = solveBackingAlpha({ peakLum: peak, ...DEFAULTS });
      const ratio = contrast(BODY_LUM, backdropLuminance(peak, DEFAULTS.scrim, DEFAULTS.glassA, alpha));
      // MAX_BACKING_ALPHA is not reached below peak 1.0, so nothing is capped
      // short here; the assertion is unconditional on purpose.
      expect(ratio).toBeGreaterThanOrEqual(AA_BODY_RATIO);
    }
  });

  it('never overshoots — one hundredth less alpha would miss AA', () => {
    for (const peak of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
      const alpha = solveBackingAlpha({ peakLum: peak, ...DEFAULTS });
      expect(alpha).toBeGreaterThan(0);
      const under = contrast(BODY_LUM, backdropLuminance(peak, DEFAULTS.scrim, DEFAULTS.glassA, alpha - 0.01));
      expect(under).toBeLessThan(AA_BODY_RATIO);
    }
  });

  it('shrinks as the user raises Glass opacity or the scrim themselves', () => {
    const peak = 0.6;
    const base = solveBackingAlpha({ peakLum: peak, scrim: 10, glassA: 20 });
    expect(solveBackingAlpha({ peakLum: peak, scrim: 10, glassA: 60 })).toBeLessThan(base);
    expect(solveBackingAlpha({ peakLum: peak, scrim: 60, glassA: 20 })).toBeLessThan(base);
    // Fully opaque glass needs no backing at all.
    expect(solveBackingAlpha({ peakLum: 1, scrim: 10, glassA: 96 })).toBe(0);
  });

  it('is monotonic in the wallpaper peak', () => {
    let prev = -1;
    for (let peak = 0; peak <= 1.0001; peak += 0.02) {
      const alpha = solveBackingAlpha({ peakLum: peak, ...DEFAULTS });
      expect(alpha).toBeGreaterThanOrEqual(prev);
      prev = alpha;
    }
  });

  it('caps at MAX_BACKING_ALPHA and tolerates junk input', () => {
    expect(solveBackingAlpha({ peakLum: 99, ...DEFAULTS })).toBeLessThanOrEqual(MAX_BACKING_ALPHA);
    expect(solveBackingAlpha({ peakLum: Number.NaN, ...DEFAULTS })).toBe(0);
    expect(solveBackingAlpha({ peakLum: -5, ...DEFAULTS })).toBe(0);
    expect(solveBackingAlpha({ peakLum: 0.6, scrim: Number.NaN, glassA: Number.NaN })).toBeGreaterThan(0);
  });

  it('solves a stricter ratio when asked', () => {
    const peak = 0.4;
    const aa = solveBackingAlpha({ peakLum: peak, ...DEFAULTS });
    const aaa = solveBackingAlpha({ peakLum: peak, ...DEFAULTS, minRatio: 7 });
    expect(aaa).toBeGreaterThan(aa);
    expect(contrast(BODY_LUM, backdropLuminance(peak, 10, 20, aaa))).toBeGreaterThanOrEqual(7);
  });
});

describe('backingFill', () => {
  it('is `transparent` at zero so the panel background layer paints nothing', () => {
    expect(backingFill(0)).toBe('transparent');
    expect(backingFill(Number.NaN)).toBe('transparent');
  });

  it('uses the glass colour family, not a neutral grey', () => {
    expect(backingFill(0.5)).toBe('rgba(13,16,28,0.500)');
  });
});

describe('peakCellLuminance', () => {
  const W = PEAK_CELLS_X * 4, H = PEAK_CELLS_Y * 4;

  function frame(fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const [r, g, b] = fill(x, y);
        const i = (y * W + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
      }
    }
    return data;
  }

  it('returns 0 for black and 1 for white', () => {
    expect(peakCellLuminance(frame(() => [0, 0, 0]), W, H)).toBe(0);
    expect(peakCellLuminance(frame(() => [255, 255, 255]), W, H)).toBeCloseTo(1, 6);
  });

  it('finds a single bright cell in an otherwise dark frame', () => {
    // One 4x4 block — exactly one cell — is white; everything else is black.
    const data = frame((x, y) => (x < 4 && y < 4 ? [255, 255, 255] : [0, 0, 0]));
    expect(peakCellLuminance(data, W, H)).toBeCloseTo(1, 6);
  });

  it('averages within a cell rather than taking the brightest pixel', () => {
    // A one-pixel specular dot must not drag a whole cell to 1.0.
    const data = frame((x, y) => (x === 0 && y === 0 ? [255, 255, 255] : [0, 0, 0]));
    const peak = peakCellLuminance(data, W, H);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeCloseTo(1 / 16, 4);
  });

  it('is 0 for degenerate dimensions', () => {
    expect(peakCellLuminance(new Uint8ClampedArray(0), 0, 0)).toBe(0);
  });
});

describe('textBackingToken / knownWallpaperPeak', () => {
  beforeEach(() => resetTextBackingForTests());

  it('treats gradient wallpapers as dark without measuring anything', () => {
    const gradient = 'linear-gradient(165deg,#0d1017,#121826 55%,#0b0e17)';
    expect(knownWallpaperPeak(gradient)).toBe(0);
    expect(textBackingToken(gradient, 10, 20)).toBe('transparent');
  });

  it('is `transparent` for an image it has not measured yet', () => {
    const img = "url('/assets/pack/aurora-4-abc123.webp')";
    expect(knownWallpaperPeak(img)).toBeNull();
    expect(textBackingToken(img, 10, 20)).toBe('transparent');
  });
});

describe('scheduleTextBacking', () => {
  beforeEach(() => resetTextBackingForTests());

  it('publishes the solved backing once the image has been measured', async () => {
    const el = document.createElement('div');
    // jsdom has neither an image decoder nor a canvas backend; stand in for a
    // solid-white wallpaper, which is the most backing the solver can ask for.
    const nativeCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockImplementation(((tag: string, options?: unknown) => {
      if (tag !== 'canvas') return nativeCreateElement(tag as 'div', options as undefined);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(1, w * h * 4)).fill(255),
          }),
        }),
      };
    }) as never);
    const nativeImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 640;
      naturalHeight = 360;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    Object.defineProperty(globalThis, 'Image', { value: FakeImage, configurable: true, writable: true });
    try {
      scheduleTextBacking("url('/wp/bright.webp')", 10, 20, el);
      // Let the decode microtask and the measure promise's `.then` both land.
      for (let i = 0; i < 4; i++) await Promise.resolve();
      const value = el.style.getPropertyValue('--ln-text-backing');
      expect(value).toMatch(/^rgba\(13,16,28,0\.\d{3}\)$/);
      // And it is now cached, so the synchronous token path agrees.
      expect(textBackingToken("url('/wp/bright.webp')", 10, 20)).toBe(value);
    } finally {
      createElement.mockRestore();
      if (nativeImage) Object.defineProperty(globalThis, 'Image', nativeImage);
    }
  });

  it('no-ops for a gradient wallpaper', () => {
    const el = document.createElement('div');
    scheduleTextBacking('linear-gradient(#07080d,#07080d)', 10, 20, el);
    expect(el.style.getPropertyValue('--ln-text-backing')).toBe('');
  });
});

describe('engine integration', () => {
  let el: HTMLElement;

  beforeEach(() => {
    resetTextBackingForTests();
    el = document.createElement('div');
  });
  afterEach(() => resetLiquidNeonV2Tokens(el));

  it('emits --ln-text-backing alongside the panel glass bridge', () => {
    applyLiquidNeonV2Tokens(LIQUID_NEON_V2_DEFAULTS, 'assets/cosmic-bg.webp', el);
    // Unmeasured in jsdom → today's rendering, and the token is present so the
    // `--glass-panel-bg` layer in tokens.css always resolves.
    expect(el.style.getPropertyValue('--ln-text-backing')).toBe('transparent');
  });

  it('leaves the slider-driven glass tokens untouched (SKY-11782)', () => {
    applyLiquidNeonV2Tokens(LIQUID_NEON_V2_DEFAULTS, 'assets/cosmic-bg.webp', el);
    expect(el.style.getPropertyValue('--glass-fill')).toBe('rgba(13,16,28,0.200)');
    expect(el.style.getPropertyValue('--blur-panel')).toBe('1px');
  });

  it('clears the token on reset', () => {
    applyLiquidNeonV2Tokens(LIQUID_NEON_V2_DEFAULTS, 'assets/cosmic-bg.webp', el);
    resetLiquidNeonV2Tokens(el);
    expect(el.style.getPropertyValue('--ln-text-backing')).toBe('');
  });
});
