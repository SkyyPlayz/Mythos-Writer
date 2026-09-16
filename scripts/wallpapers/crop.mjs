/**
 * SKY-11600 helper: crop a region out of a pack wallpaper to a PNG so it can
 * be inspected at 1:1 (or magnified) without an image editor on the box.
 * Chromium is the only WebP decoder available here and is also the decoder
 * that ships in the app.
 *
 * Usage: node scripts/wallpapers/crop.mjs <file.webp> <x> <y> <w> <h> [zoom] [out.png]
 * Fractional x/y/w/h (0-1) are treated as fractions of the image.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const [file, xs, ys, ws, hs, zs, outArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: crop.mjs <file.webp> <x> <y> <w> <h> [zoom] [out.png]');
  process.exit(1);
}
const src = path.isAbsolute(file) ? file : path.join(REPO, 'frontend/src/assets/wallpapers/pack', file);
const zoom = Number(zs || 1);
const out = outArg || path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || '/tmp', `crop-${path.basename(file, '.webp')}.png`);

const bytes = await readFile(src);
const dataUrl = `data:image/webp;base64,${bytes.toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
const b64 = await page.evaluate(async ({ url, xs, ys, ws, hs, zoom }) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const abs = (v, span) => {
    const n = Number(v);
    return n > 0 && n <= 1 && String(v).includes('.') ? Math.round(n * span) : Math.round(n);
  };
  const x = abs(xs, iw), y = abs(ys, ih), w = abs(ws, iw), h = abs(hs, ih);
  const canvas = document.getElementById('c');
  canvas.width = Math.round(w * zoom);
  canvas.height = Math.round(h * zoom);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/png').split(',')[1], iw, ih, x, y, w, h };
}, { url: dataUrl, xs, ys, ws, hs, zoom });
await browser.close();

await writeFile(out, Buffer.from(b64.data, 'base64'));
console.log(`${path.basename(src)} ${b64.iw}x${b64.ih} -> crop ${b64.x},${b64.y} ${b64.w}x${b64.h} @${zoom}x -> ${out}`);
