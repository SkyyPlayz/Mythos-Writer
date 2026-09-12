/**
 * SKY-11600 helper: build a labelled contact sheet of the bundled pack so 42
 * images can be reviewed in one pass.
 *
 *   node scripts/wallpapers/contact-sheet.mjs corners [out.png]
 *     Bottom-left corner of every image at 1:1 — this is where generator
 *     caption artifacts land (winter-2 ships one).
 *
 *   node scripts/wallpapers/contact-sheet.mjs thumbs [out.png]
 *     Whole-image thumbnails for an overall look at the set.
 *
 *   node scripts/wallpapers/contact-sheet.mjs detail <file.webp> [out.png]
 *     One image's centre at 1:1 next to the same region cover-upscaled to
 *     1920x1080 and to 2560x1440 — the softness comparison, stacked.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const PACK = path.join(REPO, 'frontend/src/assets/wallpapers/pack');
const SCRATCH = process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp';

const mode = process.argv[2] || 'corners';
const arg = process.argv[3];

const files = (await readdir(PACK)).filter((f) => f.endsWith('.webp')).sort();
const wanted = mode === 'detail' ? [arg] : files;
const images = [];
for (const f of wanted) {
  const bytes = await readFile(path.join(PACK, f));
  images.push({ file: f, url: `data:image/webp;base64,${bytes.toString('base64')}` });
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

const b64 = await page.evaluate(async ({ images, mode }) => {
  const loaded = [];
  for (const it of images) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = it.url; });
    loaded.push({ ...it, img });
  }
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');

  const label = (text, x, y) => {
    ctx.font = '600 13px monospace';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };

  if (mode === 'corners') {
    // Bottom-left 460x104 of each image at 1:1, two per row.
    const CW = 460, CH = 104, GAP = 22, COLS = 2, LBL = 18;
    const rows = Math.ceil(loaded.length / COLS);
    canvas.width = COLS * CW + (COLS + 1) * GAP;
    canvas.height = rows * (CH + LBL + GAP) + GAP;
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    loaded.forEach((it, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = GAP + col * (CW + GAP);
      const y = GAP + row * (CH + LBL + GAP);
      label(it.file, x, y + 13);
      ctx.drawImage(it.img, 0, it.img.naturalHeight - CH, CW, CH, x, y + LBL, CW, CH);
    });
  } else if (mode === 'thumbs') {
    const TW = 300, TH = 140, GAP = 10, COLS = 5, LBL = 16;
    const rows = Math.ceil(loaded.length / COLS);
    canvas.width = COLS * TW + (COLS + 1) * GAP;
    canvas.height = rows * (TH + LBL + GAP) + GAP;
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    loaded.forEach((it, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = GAP + col * (TW + GAP);
      const y = GAP + row * (TH + LBL + GAP);
      label(it.file, x, y + 12);
      ctx.drawImage(it.img, 0, 0, it.img.naturalWidth, it.img.naturalHeight, x, y + LBL, TW, TH);
    });
  } else {
    // One image: a 480x270 centre region at native 1:1, then the same region
    // resampled the way `cover` + the drift zoom presents it at two viewports.
    const it = loaded[0];
    const iw = it.img.naturalWidth, ih = it.img.naturalHeight;
    const RW = 480, RH = 270;
    const targets = [
      { label: `${it.file} — native 1:1 (${iw}x${ih})`, eff: 1 },
      { label: '1920x1080 shown size (cover 1.33 x drift 1.10 = 1.47)', eff: Math.max(1920 / iw, 1080 / ih) * 1.10 },
      { label: '2560x1440 shown size (cover 1.78 x drift 1.10 = 1.95)', eff: Math.max(2560 / iw, 1440 / ih) * 1.10 },
    ];
    const GAP = 14, LBL = 18;
    canvas.width = RW + 2 * GAP;
    canvas.height = targets.length * (RH + LBL + GAP) + GAP;
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = Math.round((iw - RW) / 2), sy = Math.round((ih - RH) / 2);
    targets.forEach((t, i) => {
      const y = GAP + i * (RH + LBL + GAP);
      // Downsample the source region by 1/eff then draw it back at RWxRH:
      // that is exactly the information loss `eff` upscaling causes.
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(RW / t.eff));
      tmp.height = Math.max(1, Math.round(RH / t.eff));
      const tctx = tmp.getContext('2d');
      tctx.imageSmoothingQuality = 'high';
      tctx.drawImage(it.img, sx, sy, RW, RH, 0, 0, tmp.width, tmp.height);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, GAP, y + LBL, RW, RH);
      label(t.label, GAP, y + 13);
    });
  }
  return canvas.toDataURL('image/png').split(',')[1];
}, { images, mode });

await browser.close();
const out = (mode === 'detail' ? process.argv[4] : process.argv[3])
  || path.join(SCRATCH, `sheet-${mode}.png`);
await writeFile(out, Buffer.from(b64, 'base64'));
console.log(`${mode}: ${wanted.length} image(s) -> ${out}`);
