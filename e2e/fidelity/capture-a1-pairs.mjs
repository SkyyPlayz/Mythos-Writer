// A1 proof pairs: prototype shell at 1440×900 + 1280×720, Neon Nebula int 50 / glass 20.
// Outputs under e2e/fidelity/output/a1-pairs/ (gitignored).
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions } from './lib.mjs';

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 720 },
];

const proto = await serveProto();
const OUT = outDir('a1-pairs');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(chromiumLaunchOptions());

for (const { w, h } of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const url = `${proto.url}${proto.url.includes('?') ? '&' : '?'}reset`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);

  // Force Neon Nebula + intensity 50 + glass 20 when the prototype exposes setters.
  await page.evaluate(() => {
    const root = document.documentElement;
    // Best-effort: click Appearance/Settings only if already on a surface that exposes them.
    // Defaults in the 2026-09-28 prototype are already Neon Nebula / 50 / 20.
    root.setAttribute('data-a1-proof', '1');
  });

  await page.waitForTimeout(600);
  const tag = `${w}x${h}`;
  await page.screenshot({ path: path.join(OUT, `proto-shell-${tag}.png`), fullPage: false });
  console.log(`  shot proto-shell-${tag}`);

  // Demo button visible in title bar
  const demo = await page.locator('[data-tour="demo-btn"]').first();
  if (await demo.count()) {
    await demo.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `proto-demo-on-${tag}.png`), fullPage: false });
    console.log(`  shot proto-demo-on-${tag}`);
    await demo.click();
    await page.waitForTimeout(400);
  }

  await page.close();
}

await browser.close();
proto.close?.();
console.log('A1 pairs DONE →', OUT);
