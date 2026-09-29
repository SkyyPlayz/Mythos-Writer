#!/usr/bin/env node
/** F1 beta 1440×900 surface screenshots → Agent Store media/beta-f1 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.F1_PROOF_OUT
  || '/cursor/stores/bc-fb92daf9-4bac-4b89-898c-bb6f10dab5c7/media/beta-f1';
const board = path.join(here, 'board.html');
fs.mkdirSync(outDir, { recursive: true });

const shots = ['structure', 'fullbook', 'boards', 'crafter', 'toolbar'];
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`file://${board}`, { waitUntil: 'networkidle' });
for (const name of shots) {
  await page.evaluate((id) => window.__setStage(id), name);
  await page.waitForTimeout(80);
  const dest = path.join(outDir, `f1-${name}-1440x900.png`);
  await page.screenshot({ path: dest, fullPage: false });
  console.log('wrote', dest);
}
await browser.close();
console.log('done', outDir);
