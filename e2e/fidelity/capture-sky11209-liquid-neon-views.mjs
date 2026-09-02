// SKY-11209 fidelity capture — Vault Graph (.vgv-canvas / .vgv-root) and
// Manuscript Structure (.msv) were painting a flat opaque --bg-base fill,
// occluding the Liquid Neon shell wallpaper (--wp / BackgroundStack). This
// proves the fix in *pixels*, not computed CSS values: with a bright, busy
// wallpaper set, the view's own canvas region now visibly renders it, and a
// mean-luminance sample confirms it numerically. With wp:'none' the view
// looks as dark/flat as before the fix (no regression).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11209-liquid-neon-views');
const VIEWPORT = { width: 1600, height: 1000 };
const now = '2026-06-17T00:00:00.000Z';

// A deliberately bright, high-contrast, busy pattern (not a dark cosmic
// image) — AC #3 explicitly calls for legibility proof against a bright
// wallpaper, not just a dark one.
const BRIGHT_WALLPAPER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>
  <rect width='400' height='400' fill='#fff04d'/>
  <rect x='0' y='0' width='200' height='200' fill='#ff2fd8'/>
  <rect x='200' y='200' width='200' height='200' fill='#2fe6ff'/>
  <circle cx='100' cy='300' r='70' fill='#39ff8c'/>
  <circle cx='300' cy='100' r='70' fill='#ff6a2f'/>
</svg>`;
const BRIGHT_WALLPAPER_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(BRIGHT_WALLPAPER_SVG).toString('base64')}`;

function seedProject(userData, storyVaultDir, notesVaultDir, wp) {
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Locations'), { recursive: true });

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    // SKY-11209: liquidNeonV2 drives BackgroundStack's --wp (the live
    // wallpaper layer painted at z-index:0 inside .desktop-shell).
    liquidNeonV2: wp === 'custom'
      ? { wp: 'custom', customWp: BRIGHT_WALLPAPER_DATA_URL }
      : { wp: 'none' },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const scene = {
    id: 'scene-1', title: 'Opening Scene', path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
    order: 1, blocks: [{ id: 'block-1', type: 'prose', content: 'Meet Elara.', order: 1, updatedAt: now }],
    createdAt: now, updatedAt: now,
  };
  const chapter = {
    id: 'chapter-1', title: 'Chapter One', path: 'Test Story/Manuscript/Chapter One',
    order: 1, scenes: [scene], createdAt: now, updatedAt: now,
  };
  const story = {
    id: 'story-1', title: 'Test Story', path: 'Test Story',
    chapters: [chapter], createdAt: now, updatedAt: now,
  };
  fs.writeFileSync(path.join(storyVaultDir, 'manifest.json'), JSON.stringify({
    version: '1.0.0', vaultRoot: storyVaultDir, stories: [story], chapters: [chapter],
    scenes: [scene], entities: [], suggestions: [],
  }, null, 2));
  fs.writeFileSync(path.join(storyVaultDir, scene.path), 'Meet Elara.');

  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Elara.md'), '# Elara\n\nSibling of [[Kest]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Kest.md'), '# Kest\n\nSibling of [[Elara]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Locations', 'The Hollow.md'), '# The Hollow\n\nHome of [[Elara]].');
}

async function launchApp(userData) {
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 30_000,
  });
  const proc = app.process();
  proc.stderr?.on('data', (d) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

// Mean luminance (Rec. 601) over a screenshot buffer, cropped to `box`
// (element-relative viewport coords from Playwright's boundingBox()).
function meanLuma(pngBuffer, box) {
  const png = PNG.sync.read(pngBuffer);
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(png.width, Math.round(box.x + box.width));
  const y1 = Math.min(png.height, Math.round(box.y + box.height));
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

async function run(wp, label) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11209-${wp}-`));
  const storyVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11209-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11209-notes-'));
  seedProject(userData, storyVaultDir, notesVaultDir, wp);

  const app = await launchApp(userData);
  const page = await app.firstWindow();
  await page.setViewportSize(VIEWPORT);
  await page.waitForLoadState('domcontentloaded');
  await expect_(page.locator('nav[aria-label="Main navigation"]'), 'nav rail');
  await page.waitForTimeout(1500);

  const results = {};

  // ── Vault Graph ──────────────────────────────────────────────────────────
  const graphRail = page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]');
  await graphRail.click();
  await page.waitForSelector('#app-tabpanel-vault-graph', { timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${label}-01-vault-graph.png`) });
  const graphCanvas = page.locator('.vgv-canvas');
  if (await graphCanvas.count()) {
    const box = await graphCanvas.boundingBox();
    if (box) {
      const buf = await page.screenshot();
      results.vaultGraph = { style: await panelStyle(page, '.vgv-canvas'), meanLuma: meanLuma(buf, box) };
    }
  }

  // ── Manuscript Structure ────────────────────────────────────────────────
  const storyRail = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
  await storyRail.click();
  await page.waitForSelector('#app-tabpanel-story', { timeout: 8000 });
  await page.waitForTimeout(800);
  const structureTab = page.locator('[data-testid="story-subview-structure"]');
  if (await structureTab.count()) {
    await structureTab.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, `${label}-02-manuscript-structure.png`) });
    const msv = page.locator('.msv');
    if (await msv.count()) {
      const box = await msv.boundingBox();
      if (box) {
        const buf = await page.screenshot();
        results.manuscriptStructure = { style: await panelStyle(page, '.msv'), meanLuma: meanLuma(buf, box) };
      }
    }
  } else {
    console.log('!! Structure sub-tab not found');
  }

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(storyVaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
  return results;
}

async function panelStyle(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const cs = el ? getComputedStyle(el) : null;
    return { background: cs ? cs.backgroundImage + ' / ' + cs.backgroundColor : null };
  }, selector);
}

async function expect_(locator, name) {
  await locator.waitFor({ state: 'visible', timeout: 12000 }).catch((e) => {
    console.error(`!! ${name} never became visible:`, e.message);
    throw e;
  });
}

const bright = await run('custom', 'bright-wallpaper');
console.log('bright-wallpaper results:', JSON.stringify(bright, null, 2));

const none = await run('none', 'no-wallpaper');
console.log('no-wallpaper results:', JSON.stringify(none, null, 2));

console.log('\n=== SUMMARY ===');
console.log('Vault Graph  — bright wallpaper mean luma:', bright.vaultGraph?.meanLuma?.toFixed(1), '  none mean luma:', none.vaultGraph?.meanLuma?.toFixed(1));
console.log('Manuscript   — bright wallpaper mean luma:', bright.manuscriptStructure?.meanLuma?.toFixed(1), '  none mean luma:', none.manuscriptStructure?.meanLuma?.toFixed(1));
console.log('DONE', OUT);
