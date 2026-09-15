// SKY-11787 — per-panel text-backing: a contrast floor behind panel body copy.
//
// ## The defect
//
// At the shipped Liquid Neon defaults a base panel is `rgba(13,16,28,.20)`
// glass (`glassA: 20`) over a `#04050b` 10% scrim over the wallpaper, so ~72%
// of the wallpaper's luminance survives to sit directly behind body text
// (`#c8d3e7`). SKY-11600 measured the bundled pack: median contrast across the
// 42 images is 7.66:1–12.98:1 (fine), but 34 of them drop body text below the
// 4.5:1 AA floor wherever a panel happens to land on a moon, a neon sign or an
// aurora curtain — worst in-scope case 1.52:1 (`aurora-4`).
//
// ## Why this shape of fix
//
// SKY-11782 ruled out raising the global `glassA` / `scrim` defaults: that is
// an owner-level aesthetic change applied to every user and every wallpaper to
// fix a highlight-only case. The precedent it points at is SKY-11491/11492 —
// when the slider-driven glass aesthetic conflicted with legibility on
// floating chrome, the overlay tier got its own fixed, higher-contrast
// treatment instead of a global default bump.
//
// So: `--glass-fill` / `glassA` / `scrim` stay exactly as they are, and this
// module adds a *second*, adaptive layer clipped to each base panel's content
// box (`--glass-panel-bg` in tokens.css). Its alpha is solved from the actual
// wallpaper, so:
//
//   - a wallpaper that already clears 4.5:1 gets alpha 0 → `transparent`, and
//     renders pixel-for-pixel as it does today,
//   - a wallpaper that does not gets exactly the alpha that brings its
//     brightest panel-sized cell to 4.5:1 and no more,
//   - raising the Glass opacity slider yourself lowers the backing the engine
//     adds, because the solve reads the live `glassA`/`scrim` values.
//
// The backing is the same colour family as the glass (`rgba(13,16,28,…)`), so
// it reads as "more glass here", not as a grey box.
//
// ## Known limits (deliberate, see the SKY-11787 PR notes)
//
//   - The alpha is uniform per wallpaper, not per screen region. A per-region
//     mask cannot work: `.ln-bg-wallpaper` runs a 70s `lnDrift` scale
//     animation (1.04 → 1.10), so any pre-baked mask would desync from the
//     pixels it is supposed to be darkening.
//   - "Text region" is the panel's CSS padding box — its interior, inside
//     the border and following its border-radius. Clipping to the *content*
//     box is literally where the glyphs are, but inside a 20px-radius panel it
//     rendered as a hard square seam (docs/screenshots/sky11787/), so the
//     padding box won: it has no edge of its own. Confining tighter than that
//     would mean tagging every text container in the app.
//   - Exposed wallpaper — the shell background, gaps between panels — is never
//     touched. Only panel interiors get the floor.
//   - The peak is measured on the sharp image, not on the `--wp-blur` copy the
//     shell actually paints. At the shipped `blur: 1` that is the same image;
//     at a high Backdrop blur it is conservative (blurring only ever lowers a
//     peak), so the backing is never *too light*.
import { wallpaperImageUrl } from './preBlurWallpaper';

/** WCAG 2.1 relative luminance from 8-bit sRGB channels. */
export function relativeLuminance8(r: number, g: number, b: number): number {
  const f = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** Panel body copy (`--txB`, and the manuscript body) — the colour AA is owed to. */
const BODY_TEXT_LUM = relativeLuminance8(0xc8, 0xd3, 0xe7);
/** `--glass-fill` / this backing's own colour. */
const GLASS_RGB = { r: 13, g: 16, b: 28 } as const;
const GLASS_LUM = relativeLuminance8(GLASS_RGB.r, GLASS_RGB.g, GLASS_RGB.b);
/** `.ln-bg-scrim` fill (`#04050b`). */
const SCRIM_LUM = relativeLuminance8(4, 5, 11);

/** WCAG AA for body-size text. */
export const AA_BODY_RATIO = 4.5;

/**
 * Ceiling on the backing alpha, matching `--glass-fill-fallback`'s 0.92: past
 * this the panel is opaque for all practical purposes and the wallpaper itself
 * is the defect, not the glass (that is `winter-2` — SKY-11756, out of scope
 * here). Clamping keeps a pathological custom image from painting a flat black
 * slab.
 */
export const MAX_BACKING_ALPHA = 0.92;

export interface BackingSolveInput {
  /**
   * Relative luminance (0–1) of the wallpaper's brightest panel-sized cell,
   * before the scrim and the panel glass. 0 for gradient wallpapers.
   */
  peakLum: number;
  /** `LiquidNeonV2Settings.scrim`, 0–70 (%). */
  scrim: number;
  /** `LiquidNeonV2Settings.glassA`, 0–96 (%). */
  glassA: number;
  /** Contrast floor to solve for; defaults to AA body. */
  minRatio?: number;
}

/**
 * The smallest `rgba(13,16,28,α)` alpha that brings body text to `minRatio`
 * over the brightest cell, or 0 when the stack already clears it.
 *
 * The composite is solved in luminance space: every layer above the wallpaper
 * is a near-black flat fill, so `src-over` reduces to scaling toward that
 * layer's own (tiny) luminance. The vignette is excluded on purpose — it is
 * transparent for the middle 40% of the frame, which is exactly where the
 * panels that carry body copy sit, so counting it would understate the need.
 *
 * Quantized *up* to 1/1000 so rounding can never land under the floor.
 */
export function solveBackingAlpha({ peakLum, scrim, glassA, minRatio = AA_BODY_RATIO }: BackingSolveInput): number {
  const scrimA = clamp01(scrim / 100);
  const glass = clamp01(glassA / 100);
  const wp = clamp01(peakLum);

  const preGlass = wp * (1 - scrimA) + SCRIM_LUM * scrimA;
  const behindText = preGlass * (1 - glass) + GLASS_LUM * glass;

  // Luminance the backdrop must not exceed for `minRatio` against body text.
  const ceiling = (BODY_TEXT_LUM + 0.05) / minRatio - 0.05;
  if (behindText <= ceiling) return 0;

  // behindText > ceiling > GLASS_LUM here (a 4.5:1 ceiling is ~0.105 and
  // GLASS_LUM is ~0.005), so the denominator is safely positive.
  const denom = behindText - GLASS_LUM;
  if (denom <= 0) return 0;
  const alpha = (behindText - ceiling) / denom;
  return Math.min(MAX_BACKING_ALPHA, Math.ceil(alpha * 1000) / 1000);
}

/** The CSS value for `--ln-text-backing` at a solved alpha. */
export function backingFill(alpha: number): string {
  if (!(alpha > 0)) return 'transparent';
  return `rgba(${GLASS_RGB.r},${GLASS_RGB.g},${GLASS_RGB.b},${alpha.toFixed(3)})`;
}

// ── peak-cell measurement ───────────────────────────────────────────────────

/**
 * Cell grid the peak is taken over. 64x36 is the same mosaic granularity
 * SKY-11600's `scripts/wallpapers/measure-pack.mjs` samples its verdicts from,
 * and it is the right unit for a *text* legibility metric: on a 1916x821 pack
 * image one cell is ~30x23 source px, which at the shipped `cover` fit plus
 * the `lnDrift` zoom is ~42x32 screen px at 1920x1080 — about one word of
 * 16px/1.6 body copy. Coarser cells average a blown-out highlight away with
 * the dark frame around it and under-report; a per-pixel peak would chase
 * single specular dots that no glyph ever sits on.
 */
export const PEAK_CELLS_X = 64;
export const PEAK_CELLS_Y = 36;

/**
 * Longest edge the image is decoded to before measuring. Cell values are
 * averages of a fixed *fraction* of the image, so downscaling does not change
 * what a cell covers — it just bounds the cost of a huge custom wallpaper.
 * Chosen not to *upscale* the bundled pack (≤1920 wide).
 */
export const PEAK_MEASURE_MAX_DIM = 1280;

/**
 * Brightest `PEAK_CELLS_X x PEAK_CELLS_Y` cell of RGBA pixel data, as mean
 * relative luminance.
 *
 * The whole image is measured, not the `cover` crop: the crop moves with the
 * window aspect ratio and with the `lnDrift` zoom, so a bright corner that is
 * off-screen right now can be on-screen a resize later. Measuring everything
 * is the conservative choice.
 */
export function peakCellLuminance(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): number {
  if (width <= 0 || height <= 0) return 0;
  const sums = new Float64Array(PEAK_CELLS_X * PEAK_CELLS_Y);
  const counts = new Float64Array(PEAK_CELLS_X * PEAK_CELLS_Y);
  for (let y = 0; y < height; y++) {
    const cy = Math.min(PEAK_CELLS_Y - 1, Math.floor((y / height) * PEAK_CELLS_Y));
    for (let x = 0; x < width; x++) {
      const cx = Math.min(PEAK_CELLS_X - 1, Math.floor((x / width) * PEAK_CELLS_X));
      const i = (y * width + x) * 4;
      const cell = cy * PEAK_CELLS_X + cx;
      sums[cell] += relativeLuminance8(data[i], data[i + 1], data[i + 2]);
      counts[cell]++;
    }
  }
  let peak = 0;
  for (let i = 0; i < sums.length; i++) {
    if (counts[i] > 0) peak = Math.max(peak, sums[i] / counts[i]);
  }
  return peak;
}

/** Decode `url` and return its brightest cell's luminance, or null on failure. */
export async function measureWallpaperPeak(url: string): Promise<number | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('wallpaper load failed'));
      img.src = url;
    });
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return null;
    const scale = Math.min(1, PEAK_MEASURE_MAX_DIM / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.drawImage !== 'function' || typeof ctx.getImageData !== 'function') return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return peakCellLuminance(data, w, h);
  } catch {
    return null;
  }
}

// ── engine wiring ───────────────────────────────────────────────────────────

/**
 * Peak luminance per wallpaper URL. Bundled wallpapers never change under a
 * given URL (Vite content-hashes them) and a custom wallpaper's ref changes
 * when its bytes do, so this never goes stale.
 */
const PEAK_CACHE = new Map<string, number>();
/** Guards against a slow decode landing after the user picked another wallpaper. */
const state = { seq: 0 };

/**
 * Peak luminance for an applied `--wp` value, when it is already known.
 *
 * Gradient wallpapers return 0 without measuring: `aurora`/`slate`/`deep` and
 * the starfield paint slot colours at ≤24% alpha over a `#0a0d16`-family base,
 * which tops out around 7.3:1 behind body text even with a pure-white slot.
 * The starfield's specks are 1.1–1.8px — far too small to move a panel-sized
 * cell.
 *
 * Returns null for an image whose peak has not been measured yet.
 */
export function knownWallpaperPeak(wpCss: string): number | null {
  const url = wallpaperImageUrl(wpCss);
  if (!url) return 0;
  const cached = PEAK_CACHE.get(url);
  return cached === undefined ? null : cached;
}

/**
 * `--ln-text-backing` for the applied `--wp` at the live scrim/glass settings.
 *
 * Synchronous, so the engine can emit it with the rest of its tokens. An
 * image wallpaper that has not been measured yet returns `transparent` — i.e.
 * today's rendering — and `scheduleTextBacking` raises it one microtask later.
 * Re-applying the same wallpaper (every other settings tweak) hits the cache
 * and is exact on the spot.
 */
export function textBackingToken(wpCss: string, scrim: number, glassA: number): string {
  const peak = knownWallpaperPeak(wpCss);
  if (peak === null) return 'transparent';
  return backingFill(solveBackingAlpha({ peakLum: peak, scrim, glassA }));
}

/**
 * Measure the applied wallpaper if needed, then publish `--ln-text-backing`
 * on `el`. No-ops for gradients and for anything already cached — those are
 * fully handled by `textBackingToken`.
 */
export function scheduleTextBacking(
  wpCss: string,
  scrim: number,
  glassA: number,
  el: HTMLElement = document.documentElement,
): void {
  const url = wallpaperImageUrl(wpCss);
  const seq = ++state.seq;
  if (!url || PEAK_CACHE.has(url)) return;
  void measureWallpaperPeak(url).then((peak) => {
    // A newer wallpaper won the race, or the decode failed (jsdom, bad image)
    // — in the failure case leave the token alone, which is today's rendering.
    if (seq !== state.seq || peak === null) return;
    PEAK_CACHE.set(url, peak);
    el.style.setProperty('--ln-text-backing', backingFill(solveBackingAlpha({ peakLum: peak, scrim, glassA })));
  });
}

/** Test hook: forget every measured wallpaper. */
export function resetTextBackingForTests(): void {
  PEAK_CACHE.clear();
  state.seq++;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
