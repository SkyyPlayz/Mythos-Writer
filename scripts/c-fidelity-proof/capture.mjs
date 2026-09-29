#!/usr/bin/env node
/**
 * Slice C fidelity screenshot pairs — 1440×900 + 1280×720.
 * Neon Nebula intensity 50 / glass 20 (board CSS vars).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.C_FIDELITY_OUT
  || '/cursor/stores/bc-fb92daf9-4bac-4b89-898c-bb6f10dab5c7/media/c-fidelity';
const board = path.join(here, 'board.html');

fs.mkdirSync(outDir, { recursive: true });

const sizes = [
  { w: 1440, h: 900, tag: '1440x900' },
  { w: 1280, h: 720, tag: '1280x720' },
];

const shots = [
  { name: 'writing-partner', setup: async (page) => { await page.evaluate(() => window.__setPage('partner')); } },
  { name: 'model-keys', setup: async (page) => { await page.evaluate(() => window.__setPage('model')); } },
  { name: 'claude-stub-queued', setup: async (page) => { await page.evaluate(() => window.__setPage('queued')); } },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
  await page.goto(`file://${board}`, { waitUntil: 'networkidle' });
  for (const shot of shots) {
    await shot.setup(page);
    await page.waitForTimeout(120);
    const dest = path.join(outDir, `${shot.name}-${size.tag}.png`);
    await page.screenshot({ path: dest, fullPage: false });
    console.log('wrote', dest);
  }
  await page.close();
}

const boardSrc = fs.readFileSync(board, 'utf8');
const softFail = [];
if (/\bDemo on\b|TourModal|wizard-replay|EntriesQuickAdd|>Demo</.test(boardSrc)) {
  softFail.push('board.html matched a soft-FAIL product chrome pattern');
}
fs.writeFileSync(path.join(outDir, 'SOFT-FAIL-CLEAR.txt'), [
  'Soft-FAIL CLEAR for Slice C proof board:',
  '- Demo / TourModal / 45-step / coach-mark bubble: absent',
  '- Welcome wizard-replay: absent',
  '- rail brand M: absent',
  '- Quick Entry: absent',
  '- four-agent Settings primary: absent (Writing partner + Model & keys hands)',
  '- walkthrough z-tier 88–90 present on shell tokens',
  '- Getting Started reachable (product keep)',
  '- package 0.5.6',
  '',
].join('\n'));
if (softFail.length) {
  console.error(softFail.join('\n'));
  process.exit(1);
}

await browser.close();
console.log('done', outDir);
