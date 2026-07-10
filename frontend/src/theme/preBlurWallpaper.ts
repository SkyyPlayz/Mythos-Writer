// Beta 4 W0.5 — pre-blurred wallpaper (PERFORMANCE.md §2).
//
// Live `backdrop-filter` re-blurs everything behind a panel on every frame it
// (or anything under it) changes; the shell stacked 140+ of them. Instead we
// blur the wallpaper ONCE per (wallpaper, blur-radius) change on an offscreen
// canvas, publish the result as a blob URL through the `--wp-blur` custom
// property, and let panels render as plain semi-opaque `--glass` fills over
// that pre-blurred layer. The `Backdrop blur` slider now drives this pre-blur
// radius. Live backdrop-filter remains only on transient popovers/menus.
//
// Gradient wallpapers (aurora / slate / deep / none / non-classic match) skip
// the canvas pass entirely: blurring an already-smooth gradient is visually
// an identity, so `--wp-blur` is left unset and CSS falls back to var(--wp).

/** Extract the url(...) target from a wallpaper CSS value; null for gradients. */
export function wallpaperImageUrl(wpCss: string): string | null {
  const m = /^url\((['"]?)(.*?)\1\)$/.exec(wpCss.trim());
  return m && m[2] ? m[2] : null;
}

/**
 * Quality factor: the blur copy is rendered at most this wide/tall and then
 * cover-stretched back to the viewport. Blur radius scales down with the
 * canvas so the on-screen blur matches the user's radius (≈, at a nominal
 * 1080p wallpaper); a blurred image has no detail to lose from downscaling.
 */
export const PRE_BLUR_MAX_DIM = 1280;

interface PreBlurState {
  key: string;
  blobUrl: string | null;
  seq: number;
}

const state: PreBlurState = { key: '', blobUrl: null, seq: 0 };

function clearBlur(el: HTMLElement): void {
  el.style.removeProperty('--wp-blur');
  if (state.blobUrl) {
    URL.revokeObjectURL(state.blobUrl);
    state.blobUrl = null;
  }
}

/** Render `url` blurred by `blurPx` (screen px) to a blob URL, or null on failure. */
export async function generateBlurredWallpaper(url: string, blurPx: number): Promise<string | null> {
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('wallpaper load failed'));
      img.src = url;
    });
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (!iw || !ih) return null;
    const scale = Math.min(1, PRE_BLUR_MAX_DIM / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.drawImage !== 'function') return null;
    const radius = Math.max(0.5, blurPx * scale);
    // Overscan by the blur diameter so the edges don't bleed transparent black.
    const pad = Math.ceil(radius * 2);
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(img, -pad, -pad, w + 2 * pad, h + 2 * pad);
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.9);
      } catch {
        resolve(null);
      }
    });
    return blob ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/**
 * Idempotently (re)generate the pre-blurred wallpaper for the given applied
 * `--wp` value and blur radius, publishing it as `--wp-blur` on `el`.
 * No-ops when (wpCss, blurPx) is unchanged; failures (jsdom, decode errors)
 * fall back to the sharp wallpaper via the CSS var fallback chain.
 */
export function schedulePreBlurredWallpaper(
  wpCss: string,
  blurPx: number,
  el: HTMLElement = document.documentElement,
): void {
  const key = wpCss + '|' + blurPx;
  if (key === state.key) return;
  state.key = key;
  const seq = ++state.seq;
  const url = wallpaperImageUrl(wpCss);
  if (!url || !(blurPx > 0)) {
    clearBlur(el);
    return;
  }
  void generateBlurredWallpaper(url, blurPx).then((blobUrl) => {
    if (seq !== state.seq) {
      // A newer request superseded this one while it rendered.
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (!blobUrl) {
      clearBlur(el);
      return;
    }
    const old = state.blobUrl;
    state.blobUrl = blobUrl;
    el.style.setProperty('--wp-blur', `url("${blobUrl}")`);
    if (old) URL.revokeObjectURL(old);
  });
}

/** Test hook: forget cached state (does not revoke). */
export function resetPreBlurredWallpaperForTests(): void {
  state.key = '';
  state.blobUrl = null;
  state.seq++;
}
