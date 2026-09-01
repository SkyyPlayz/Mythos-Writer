// SKY-11072 fidelity capture — Setup (closed) view, vault-reference columns
// (CHARACTERS / LOCATIONS / ITEMS & SYSTEMS) replacing the BEATS/CAST/PLACES
// kanban. Seeds the prototype's own crafterVaultCols sample notes so the app
// crop sits directly beside the prototype crop.
// Set MW_MAIN_JS to a sibling build's out/main/main.js to capture a "before"
// from pre-SKY-11072 main. Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';
import { mainJs, outDir, requireBuild, serveProto, chromiumLaunchOptions } from './lib.mjs';

const MAIN_JS = process.env.MW_MAIN_JS || mainJs;
const TAG = process.env.MW_MAIN_JS ? 'before' : 'after';
if (!process.env.MW_MAIN_JS) requireBuild();
const OUT = outDir('capture-sky11072-vault-ref-columns');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };

// The prototype's crafterVaultCols sample data (dc.html line 4374).
const NOTES = [
  ['Characters/Mira Veynn.md', 'Reluctant heir — resourceful, haunted.'],
  ['Characters/Kael Thorne.md', 'Smuggler — witty, guarded, survivor.'],
  ['Characters/The Broker.md', 'Antagonist — elusive, always watching.'],
  ['Locations/The Undercity.md', 'Drowned streets, stacked walkways.'],
  ['Locations/The Sunken Gate.md', 'Ancient floodgate. Opens at low tide.'],
  ['Items & Systems/Map Fragment.md', 'Redraws itself at low tide.'],
  ['Items & Systems/Drownlight.md', 'Burns underwater. Misbehaves near flame.'],
  ['Items & Systems/Tide Mechanics.md', 'The rules by which the deep breathes.'],
];

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11072-cap-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11072-cap-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11072-cap-notes-'));
  const agentCfg = (extra = {}) => ({
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  });
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: true },
    agents: { writingAssistant: agentCfg(), brainstorm: agentCfg({ enabled: true }), archive: agentCfg() },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
  for (const [rel, body] of NOTES) {
    const p = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { userData, vaultDir, notesVaultDir };
}

function cleanup(fixture) {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

/** Union bounding box of the three column headers → clip covering the columns. */
async function columnsClip(page, headers, pad = 16, height = 700) {
  const boxes = [];
  for (const text of headers) {
    const el = page.locator(`text="${text}"`).last();
    const box = await el.boundingBox().catch(() => null);
    if (box) boxes.push(box);
  }
  if (!boxes.length) return null;
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad + 120;
  return { x, y, width: Math.min(right - x, VIEWPORT.width - x), height };
}

async function captureApp() {
  const fixture = seedFixture();
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Instant-create (SKY-9021/9896): File → New story, no prompt.
  const before = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(before).waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.nav-story-title').nth(before).click();
  await page.waitForTimeout(500);

  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(700);

  await page.screenshot({ path: `${OUT}/app-setup-view-${TAG}.png` });
  console.log(`  shot app-setup-view-${TAG}`);

  const headers = TAG === 'after' ? ['CHARACTERS', 'LOCATIONS', 'ITEMS & SYSTEMS'] : ['BEATS', 'CAST', 'PLACES'];
  const clip = await columnsClip(page, headers);
  if (clip) {
    await page.screenshot({ path: `${OUT}/app-vault-columns-crop-${TAG}.png`, clip });
    console.log(`  shot app-vault-columns-crop-${TAG}`);
  } else {
    console.log('  MISS column headers for crop');
  }

  if (TAG === 'after') {
    // The + picker (same card family as the suggested rail).
    await page.getByRole('button', { name: 'Add a note to CHARACTERS' }).click();
    await page.locator('.sc-ref-picker').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);
    const pickerClip = await columnsClip(page, ['CHARACTERS', 'LOCATIONS', 'ITEMS & SYSTEMS']);
    await page.screenshot({ path: `${OUT}/app-ref-picker-open-after.png`, clip: pickerClip ?? undefined });
    console.log('  shot app-ref-picker-open-after');
  }

  await app.close().catch(() => {});
  cleanup(fixture);
}

async function captureProto() {
  const proto = await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions(['--force-device-scale-factor=1']));
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);

  const clicked = await page.evaluate(() => {
    for (const lbl of ['Scene Crafter', 'Crafter']) {
      const els = [...document.querySelectorAll('div,span,button,a')].filter((e) => {
        const t = (e.innerText || '').trim();
        if (t !== lbl) return false;
        const r = e.getBoundingClientRect();
        return r.left < 110 && r.width > 8 && r.height > 8;
      });
      if (els.length) {
        els.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
        els[0].click();
        return lbl;
      }
    }
    return null;
  });
  console.log('  proto rail click: ' + clicked);
  await page.waitForTimeout(1800);

  await page.screenshot({ path: `${OUT}/proto-crafter-view.png` });
  console.log('  shot proto-crafter-view');
  const clip = await columnsClip(page, ['CHARACTERS', 'LOCATIONS', 'ITEMS & SYSTEMS']);
  if (clip) {
    await page.screenshot({ path: `${OUT}/proto-vault-columns-crop.png`, clip });
    console.log('  shot proto-vault-columns-crop');
  } else {
    console.log('  MISS proto column headers for crop');
  }
  await browser.close();
  proto.close();
}

if (process.env.MW_MAIN_JS) {
  await captureApp(); // before-shot only
} else {
  await captureApp();
  await captureProto();
}
console.log('DONE');
