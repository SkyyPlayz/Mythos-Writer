// Render the Liquid Neon prototype and capture every surface.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import { chromium } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions } from './lib.mjs';

const proto = process.env.BASE ? null : await serveProto();
const BASE = process.env.BASE || proto.url;
const OUT = outDir('render');

const browser = await chromium.launch(chromiumLaunchOptions(['--force-device-scale-factor=1']));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e).slice(0, 200)));

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);

// Did it actually mount? Count rendered elements inside <x-dc>.
const mounted = await page.evaluate(() => {
  const root = document.querySelector('x-dc');
  return { nodes: root ? root.querySelectorAll('*').length : -1, text: (document.body.innerText || '').slice(0, 300) };
});
console.log('MOUNTED nodes=' + mounted.nodes);
console.log('TEXT: ' + JSON.stringify(mounted.text));
if (errs.length) console.log('ERRORS:\n' + errs.slice(0, 8).join('\n'));

await page.screenshot({ path: `${OUT}/00-default.png` });

// Map the left rail: every clickable element with short label text.
const rail = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('x-dc *').forEach(el => {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 24 || t.includes('\n')) return;
    const cs = getComputedStyle(el);
    if (cs.cursor !== 'pointer') return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    if (r.left > 240) return;               // left rail region only
    out.push({ t, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) });
  });
  // de-dupe by label, keep outermost (largest) hit target
  const best = new Map();
  for (const o of out) if (!best.has(o.t) || best.get(o.t).w < o.w) best.set(o.t, o);
  return [...best.values()];
});
console.log('RAIL: ' + JSON.stringify(rail));

await browser.close();
if (proto) await proto.close();
