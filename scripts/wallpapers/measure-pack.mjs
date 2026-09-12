/**
 * SKY-11600 — measure the bundled wallpaper pack the way the app actually
 * shows it, so "which ones read soft" and "is winter-4 too bright" are
 * answered with numbers instead of impressions.
 *
 * Why a real browser: the only WebP decoder on this machine is Chromium's, and
 * it is also the one that ships in the app. Images are handed to the page as
 * data URLs so `getImageData` is not tainted (a `file://` image is an opaque
 * origin and taints the canvas).
 *
 * What it reproduces, from frontend/src/theme (do not drift from these):
 *   .ln-bg-wallpaper  background-image: var(--wp-blur, var(--wp))
 *                     background-size: cover
 *                     background-position: manifest `position` (default center)
 *                     animation: lnDrift  scale(1.04) -> scale(1.1)
 *   .ln-bg-scrim      #04050b at var(--ln-scrim)          [scrim default 10 -> 0.10]
 *   .ln-bg-vignette   radial-gradient(120% 90% at 50% 0%,
 *                       transparent 40%, rgba(4,5,10,.55) 100%)
 *   --glass           rgba(13,16,28, glassA/100)          [glassA default 20 -> 0.20]
 *   --txB / uiTextCol #c8d3e7   (app + manuscript body)
 *   --txH             #f0f3fc   (headings)
 *
 * Usage:
 *   node scripts/wallpapers/measure-pack.mjs            # table + verdicts
 *   node scripts/wallpapers/measure-pack.mjs --json     # raw rows
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PACK = path.join(REPO, 'frontend/src/assets/wallpapers/pack');
const MANIFEST = path.join(REPO, 'frontend/src/assets/wallpapers/manifest.json');

// Liquid Neon shipped defaults (LIQUID_NEON_V2_DEFAULTS).
const SCRIM_A = 0.10;
const GLASS = { r: 13, g: 16, b: 28, a: 0.20 };
const SCRIM = { r: 4, g: 5, b: 11 };        // #04050b
const VIGNETTE = { r: 4, g: 5, b: 10, a: 0.55 };
const TEXT_BODY = { r: 0xc8, g: 0xd3, b: 0xe7 };
const TEXT_HEAD = { r: 0xf0, g: 0xf3, b: 0xfc };

// The drift animation never shows the wallpaper at 1.0 — it runs 1.04 -> 1.1.
const DRIFT_MIN = 1.04;
const DRIFT_MAX = 1.10;

const VIEWPORTS = [
  { label: '1440x900', w: 1440, h: 900 },
  { label: '1920x1080', w: 1920, h: 1080 },
  { label: '2560x1440', w: 2560, h: 1440 },
];

/** WCAG relative luminance from 8-bit sRGB. */
function relLuminance(r, g, b) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(l1, l2) {
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** src-over composite of `over` (with alpha) onto opaque `under`. */
function over(under, o, alpha) {
  return {
    r: o.r * alpha + under.r * (1 - alpha),
    g: o.g * alpha + under.g * (1 - alpha),
    b: o.b * alpha + under.b * (1 - alpha),
  };
}

/**
 * CSS `background-position` for a cover-scaled image: the fraction of the
 * overflow that sits off the LEADING edge. `50% center` -> 0.5.
 */
function positionFraction(position) {
  if (!position) return 0.5;
  const m = /^(-?[\d.]+)%/.exec(String(position).trim());
  return m ? Number(m[1]) / 100 : 0.5;
}

/**
 * Vignette alpha at a screen point, reproducing
 * radial-gradient(120% 90% at 50% 0%, transparent 40%, rgba(4,5,10,.55) 100%).
 */
function vignetteAlpha(x, y, w, h) {
  const cx = w * 0.5, cy = 0;
  const rx = w * 1.2, ry = h * 0.9;
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
  if (d <= 0.4) return 0;
  const t = Math.min(1, (d - 0.4) / 0.6);
  return VIGNETTE.a * t;
}

const argJson = process.argv.includes('--json');

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const entries = [];
for (const [theme, list] of Object.entries(manifest.themes)) {
  for (const e of list) {
    entries.push({ theme, ...e, position: e.position ?? manifest.position ?? 'center' });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

const rows = [];
for (const entry of entries) {
  const bytes = await readFile(path.join(PACK, entry.file));
  const dataUrl = `data:image/webp;base64,${bytes.toString('base64')}`;

  const stats = await page.evaluate(async (url) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('decode failed'));
      img.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    const canvas = document.getElementById('c');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);

    // Rec.709 luma for the detail metric (perceptual edge energy), kept in
    // 0-255 so the threshold below is readable as "levels".
    const luma = new Float32Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    }

    // 4-neighbour Laplacian: how much fine structure exists at NATIVE
    // resolution. A painterly nebula has almost none and cannot look softer
    // when upscaled; foliage, city lights and snow texture have a lot and do.
    let lapSum = 0, lapCount = 0, edgePixels = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const lap = Math.abs(4 * luma[p] - luma[p - 1] - luma[p + 1] - luma[p - w] - luma[p + w]);
        lapSum += lap;
        lapCount++;
        if (lap > 8) edgePixels++;
      }
    }

    // Full-frame luminance distribution (WCAG linear), plus the raw RGB mean
    // so the caller can composite the scrim/glass stack over it.
    const lumHist = new Float64Array(256);
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0, n = 0; i < data.length; i += 4, n++) {
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2];
      const y = Math.min(255, Math.round(luma[n]));
      lumHist[y]++;
    }
    const total = w * h;

    // Grid of screen-space cells is computed on the Node side; here we just
    // hand back a coarse 64x36 luma mosaic it can map through `cover`.
    const MX = 64, MY = 36;
    const mosaic = new Float64Array(MX * MY);
    const mosaicN = new Float64Array(MX * MY);
    for (let y = 0; y < h; y++) {
      const my = Math.min(MY - 1, Math.floor((y / h) * MY));
      for (let x = 0; x < w; x++) {
        const mx = Math.min(MX - 1, Math.floor((x / w) * MX));
        const i = (y * w + x) * 4;
        mosaic[my * MX + mx] += relLum(data[i], data[i + 1], data[i + 2]);
        mosaicN[my * MX + mx]++;
      }
    }
    for (let i = 0; i < mosaic.length; i++) mosaic[i] /= mosaicN[i] || 1;

    function relLum(r, g, b) {
      const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }

    const pct = (q) => {
      let acc = 0;
      for (let y = 0; y < 256; y++) {
        acc += lumHist[y];
        if (acc / total >= q) return y;
      }
      return 255;
    };

    return {
      w, h,
      meanRgb: [sr / total, sg / total, sb / total],
      lumaP05: pct(0.05), lumaP50: pct(0.5), lumaP95: pct(0.95),
      brightFraction: (() => { let a = 0; for (let y = 160; y < 256; y++) a += lumHist[y]; return a / total; })(),
      lapMean: lapSum / lapCount,
      edgeFraction: edgePixels / lapCount,
      mosaic: Array.from(mosaic), MX, MY,
    };
  }, dataUrl);

  rows.push({ ...entry, ...stats });
}
await browser.close();

// ── derive, per image ────────────────────────────────────────────────────────
const posFrac = (r) => positionFraction(r.position);

for (const r of rows) {
  r.views = {};
  for (const v of VIEWPORTS) {
    const cover = Math.max(v.w / r.w, v.h / r.h);
    // Source pixels per screen pixel, including the drift zoom that is always
    // running. <1 means we are inventing pixels.
    const effMin = cover * DRIFT_MIN;
    const effMax = cover * DRIFT_MAX;
    // Detail that survives: edge energy measured at native resolution is
    // spread over `eff^2` screen pixels, so per-screen-pixel detail falls as
    // 1/eff^2. Reported as a share of the same image shown 1:1.
    r.views[v.label] = {
      cover: +cover.toFixed(3),
      effMin: +effMin.toFixed(3),
      effMax: +effMax.toFixed(3),
      detailRetained: +(1 / (effMax * effMax)).toFixed(3),
    };
  }

  // Worst-case legibility: sample the mosaic through `cover` at 1920x1080,
  // composite scrim + vignette + glass, and contrast the result with body and
  // heading text. The brightest cell is the one that decides the verdict.
  const v = { w: 1920, h: 1080 };
  const cover = Math.max(v.w / r.w, v.h / r.h) * ((DRIFT_MIN + DRIFT_MAX) / 2);
  const dispW = r.w * cover, dispH = r.h * cover;
  const offX = (dispW - v.w) * posFrac(r);
  const offY = (dispH - v.h) * 0.5;
  let worst = null;
  const cells = [];
  const CELLS_X = 12, CELLS_Y = 8;
  for (let cy = 0; cy < CELLS_Y; cy++) {
    for (let cx = 0; cx < CELLS_X; cx++) {
      const sxScreen = (cx + 0.5) * (v.w / CELLS_X);
      const syScreen = (cy + 0.5) * (v.h / CELLS_Y);
      // screen -> displayed image -> source -> mosaic cell
      const u = (sxScreen + offX) / dispW;
      const t = (syScreen + offY) / dispH;
      if (u < 0 || u > 1 || t < 0 || t > 1) continue;
      const mx = Math.min(r.MX - 1, Math.floor(u * r.MX));
      const my = Math.min(r.MY - 1, Math.floor(t * r.MY));
      const wallpaperLum = r.mosaic[my * r.MX + mx];

      // The composite is done in luminance space: every layer above the
      // wallpaper is a near-black flat fill, so its own luminance is ~0 and
      // src-over reduces to scaling. Alphas multiply through the stack.
      const vig = vignetteAlpha(sxScreen, syScreen, v.w, v.h);
      const scrimLum = relLuminance(SCRIM.r, SCRIM.g, SCRIM.b);
      const vigLum = relLuminance(VIGNETTE.r, VIGNETTE.g, VIGNETTE.b);
      const glassLum = relLuminance(GLASS.r, GLASS.g, GLASS.b);
      let lum = wallpaperLum * (1 - SCRIM_A) + scrimLum * SCRIM_A;
      lum = lum * (1 - vig) + vigLum * vig;
      const bare = lum;                                   // exposed wallpaper
      const panel = lum * (1 - GLASS.a) + glassLum * GLASS.a; // behind --glass

      const cand = {
        cell: `${cx},${cy}`,
        bare: +bare.toFixed(4),
        panel: +panel.toFixed(4),
        bodyOnPanel: +contrast(relLuminance(TEXT_BODY.r, TEXT_BODY.g, TEXT_BODY.b), panel).toFixed(2),
        headOnPanel: +contrast(relLuminance(TEXT_HEAD.r, TEXT_HEAD.g, TEXT_HEAD.b), panel).toFixed(2),
        bodyOnBare: +contrast(relLuminance(TEXT_BODY.r, TEXT_BODY.g, TEXT_BODY.b), bare).toFixed(2),
      };
      if (!worst || cand.bodyOnPanel < worst.bodyOnPanel) worst = cand;
      cells.push(cand.bodyOnPanel);
    }
  }
  r.worst = worst;
  // Median cell separates "one bright highlight under one panel" from "the
  // whole frame is bright" — the two cases have different fixes.
  cells.sort((a, b) => a - b);
  r.medianBodyOnPanel = +cells[Math.floor(cells.length / 2)].toFixed(2);
  delete r.mosaic;
}

if (argJson) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

// ── report ───────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log('\n=== 1. SOFTNESS — source pixels per screen pixel (cover x drift 1.04-1.10) ===');
console.log('detail% = share of native edge detail surviving per screen pixel at worst drift\n');
console.log(pad('file', 15) + pad('native', 11) + num('1440x900', 10) + num('detail%', 9)
  + num('1920x1080', 11) + num('detail%', 9) + num('2560x1440', 11) + num('detail%', 9)
  + num('edge%', 8));
for (const r of [...rows].sort((a, b) => b.edgeFraction - a.edgeFraction)) {
  const a = r.views['1440x900'], b = r.views['1920x1080'], c = r.views['2560x1440'];
  console.log(
    pad(r.file, 15) + pad(`${r.w}x${r.h}`, 11)
    + num(`${a.effMin}-${a.effMax}`, 10) + num((a.detailRetained * 100).toFixed(0) + '%', 9)
    + num(`${b.effMin}-${b.effMax}`, 11) + num((b.detailRetained * 100).toFixed(0) + '%', 9)
    + num(`${c.effMin}-${c.effMax}`, 11) + num((c.detailRetained * 100).toFixed(0) + '%', 9)
    + num((r.edgeFraction * 100).toFixed(1), 8),
  );
}

console.log('\n=== 2. BRIGHTNESS / LEGIBILITY at 1920x1080, shipped defaults ===');
console.log('scrim 10%, glass 20%, body #c8d3e7, head #f0f3fc; worst (brightest) cell of a 12x8 grid');
console.log('WCAG AA needs 4.5:1 body / 3.0:1 large-heading\n');
console.log(pad('file', 15) + num('meanY', 8) + num('p95', 6) + num('bright%', 9)
  + num('panelY', 9) + num('body:1', 8) + num('med:1', 8) + num('head:1', 8)
  + num('bare:1', 8) + '  verdict');
for (const r of [...rows].sort((a, b) => a.worst.bodyOnPanel - b.worst.bodyOnPanel)) {
  const meanY = relLuminance(...r.meanRgb);
  const w = r.worst;
  const verdict = w.bodyOnPanel < 4.5
    ? (w.bodyOnPanel < 3 ? 'FAIL body+head' : 'FAIL body')
    : 'pass';
  console.log(
    pad(r.file, 15) + num(meanY.toFixed(3), 8) + num(r.lumaP95, 6)
    + num((r.brightFraction * 100).toFixed(1), 9)
    + num(w.panel.toFixed(3), 9) + num(w.bodyOnPanel, 8) + num(r.medianBodyOnPanel, 8)
    + num(w.headOnPanel, 8) + num(w.bodyOnBare, 8) + '  ' + verdict,
  );
}

const failures = rows.filter((r) => r.worst.bodyOnPanel < 4.5);
console.log(`\n${failures.length} of ${rows.length} fail 4.5:1 body text in their BRIGHTEST cell: `
  + (failures.map((r) => r.file).join(', ') || 'none'));

// Failing at the median means the whole frame is too bright, which is a
// different problem from one highlight under one panel and has a different
// fix. Only those images are a per-image defect rather than SKY-11488's
// 20%-glass floor showing through.
const medianFail = rows.filter((r) => r.medianBodyOnPanel < 4.5);
console.log(`${medianFail.length} of ${rows.length} fail 4.5:1 at the MEDIAN cell (whole frame too bright): `
  + (medianFail.map((r) => `${r.file} (${r.medianBodyOnPanel}:1)`).join(', ') || 'none'));

// For those, solve the scrim that would rescue them, so "raise the scrim" can
// be compared against "drop the image" with a number instead of a guess.
// scrim is user-facing 0-70 (%), default 10.
if (medianFail.length) {
  const bodyLum = relLuminance(TEXT_BODY.r, TEXT_BODY.g, TEXT_BODY.b);
  const scrimLum = relLuminance(SCRIM.r, SCRIM.g, SCRIM.b);
  const glassLum = relLuminance(GLASS.r, GLASS.g, GLASS.b);
  console.log('\nScrim needed to bring the median cell to 4.5:1 (slider range 0-70, default 10):');
  for (const r of medianFail) {
    // Undo the shipped stack to recover the median cell's raw wallpaper
    // luminance, then re-solve for the scrim alpha.
    const panelNow = (bodyLum + 0.05) / r.medianBodyOnPanel - 0.05;
    const preNow = (panelNow - glassLum * GLASS.a) / (1 - GLASS.a);
    const wp = (preNow - scrimLum * SCRIM_A) / (1 - SCRIM_A);
    const panelTarget = (bodyLum + 0.05) / 4.5 - 0.05;
    const preTarget = (panelTarget - glassLum * GLASS.a) / (1 - GLASS.a);
    const s = (wp - preTarget) / (wp - scrimLum);
    const pct = s * 100;
    const verdict = pct > 70 ? 'IMPOSSIBLE — above the slider maximum' : `${pct.toFixed(0)}% (default is 10%)`;
    console.log(`  ${pad(r.file, 16)} ${verdict}`);
  }
}
