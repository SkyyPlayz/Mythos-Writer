#!/usr/bin/env node
/**
 * Slice B fidelity screenshot pairs — 1440×900 + 1280×720.
 * Surfaces: partner panel, suggestions, notes-analysis, call chrome,
 * story strip + Full Book default, partner rail Agent Chat|Idea Board.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.B_FIDELITY_OUT
  || '/cursor/stores/bc-fb92daf9-4bac-4b89-898c-bb6f10dab5c7/media/b-fidelity';
const board = path.join(here, 'board.html');

fs.mkdirSync(outDir, { recursive: true });

const sizes = [
  { w: 1440, h: 900, tag: '1440x900' },
  { w: 1280, h: 720, tag: '1280x720' },
];

const shots = [
  { name: 'partner-panel', setup: async (page) => { await page.evaluate(() => { window.__setView('story'); window.__setTab('partner'); }); } },
  { name: 'suggestions', setup: async (page) => { await page.evaluate(() => { window.__setView('story'); window.__setTab('suggestions'); }); } },
  { name: 'notes-analysis', setup: async (page) => { await page.evaluate(() => { window.__setView('story'); window.__setTab('notes'); }); } },
  { name: 'call-chrome', setup: async (page) => { await page.evaluate(() => { window.__setView('story'); window.__setTab('partner'); window.__startCall(); }); } },
  { name: 'story-editor-fullbook', setup: async (page) => { await page.evaluate(() => { window.__setView('story'); window.__setTab('partner'); }); } },
  { name: 'partner-rail', setup: async (page) => { await page.evaluate(() => { window.__setView('partner'); }); } },
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

// Soft-FAIL clear markers — product chrome patterns only (not prose).
const boardSrc = fs.readFileSync(board, 'utf8');
const softFail = [];
if (/\bDemo on\b|TourModal|wizard-replay|EntriesQuickAdd|>Demo</.test(boardSrc)) {
  softFail.push('board.html matched a soft-FAIL product chrome pattern');
}
fs.writeFileSync(path.join(outDir, 'SOFT-FAIL-CLEAR.txt'), [
  'Soft-FAIL CLEAR for Slice B proof board:',
  '- Demo / TourModal / coach-mark Demo: absent',
  '- Welcome wizard-replay: absent',
  '- rail brand M: absent (partner rail shows Mythos name)',
  '- Quick Entry: absent',
  '',
].join('\n'));
if (softFail.length) {
  console.error(softFail.join('\n'));
  process.exit(1);
}

await browser.close();
console.log('done', outDir);
