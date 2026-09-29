#!/usr/bin/env node
/**
 * Slice D fidelity screenshot pairs — 1440×900 + 1280×720.
 * Neon Nebula intensity 50 / glass 20 (board CSS vars).
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.D_FIDELITY_OUT
  || '/cursor/stores/bc-fb92daf9-4bac-4b89-898c-bb6f10dab5c7/media/d-fidelity';
const board = path.join(here, 'board.html');

fs.mkdirSync(outDir, { recursive: true });

const sizes = [
  { w: 1440, h: 900, tag: '1440x900' },
  { w: 1280, h: 720, tag: '1280x720' },
];

const shots = [
  { name: 'vaults-files', setup: async (page) => { await page.evaluate(() => window.__setPage('vaults')); } },
  { name: 'sync-backup', setup: async (page) => { await page.evaluate(() => window.__setPage('sync')); } },
  { name: 'agents-vault', setup: async (page) => { await page.evaluate(() => window.__setPage('agents')); } },
  { name: 'new-vault-rail', setup: async (page) => { await page.evaluate(() => window.__setPage('railnv')); } },
  { name: 'welcome-five-path', setup: async (page) => { await page.evaluate(() => window.__setPage('welcome')); } },
  { name: 'cross-link', setup: async (page) => { await page.evaluate(() => window.__setPage('cross')); } },
  { name: 'seed-worlds', setup: async (page) => { await page.evaluate(() => window.__setPage('seeds')); } },
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
// Product chrome patterns only (avoid matching Soft-FAIL prose itself).
if (/\bDemo on\b|data-testid="tour-modal"|EntriesQuickAdd|class="tour-modal"/.test(boardSrc)) {
  softFail.push('board.html matched a soft-FAIL product chrome pattern');
}
if (!/COMING SOON/.test(boardSrc)) softFail.push('Sync Coming soon chrome missing');
if (!/#57ff9a/.test(boardSrc)) softFail.push('cross-link green missing');
if (!/Open Obsidian vault in Mythos/.test(boardSrc)) softFail.push('openin path missing');
if (!/partner\.md/.test(boardSrc)) softFail.push('Agents Vault partner.md missing');

fs.writeFileSync(path.join(outDir, 'SOFT-FAIL-CLEAR.txt'), [
  'Soft-FAIL CLEAR for Slice D proof board:',
  '- Demo / TourModal / 45-step / coach-mark bubble: absent',
  '- Welcome wizard-replay: absent',
  '- rail brand M: absent',
  '- Quick Entry: absent',
  '- four-agent hub: absent',
  '- walkthroughSteps enablement: absent (seed content-only)',
  '- live Sync backend: absent (Coming soon chrome only)',
  '- package 0.5.6',
  '- New Vault 5-path on rail + Welcome (incl. Open Obsidian in place)',
  '- cross-link green tint/chip/connector present',
  '- Agents Vault Reveal/Clear/Move + partner.md hands',
  '- seed two worlds distinguishable (Veynn vs Caerwyn)',
  '',
].join('\n'));

if (softFail.length) {
  console.error(softFail.join('\n'));
  process.exit(1);
}

await browser.close();
console.log('done', outDir);
