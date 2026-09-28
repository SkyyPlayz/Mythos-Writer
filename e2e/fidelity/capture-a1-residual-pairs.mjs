// A1 residual Q1–Q3 proof pairs @ 1440×900 + 1280×720 (Neon Nebula 50 / glass 20).
// Shots: Welcome overlay · Demo-on walkthrough · rail without brand.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();

const OUT_ARG = process.argv.find((a) => a.startsWith('--out='));
const OUT = OUT_ARG
  ? OUT_ARG.slice('--out='.length)
  : outDir('a1-residual-pairs');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 720 },
];
const now = new Date().toISOString();
const storyId = 'a1r-story-001';

function seed() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a1r-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: false },
    theme: 'dark',
    liquidNeonV2: {
      setKey: 'classic', intensity: 50, glassA: 20, blur: 1,
      uiDens: 1, uiScale: 1, density: 'comfortable',
    },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{
      id: storyId, title: 'A1 Residual Proof', path: `stories/${storyId}`,
      createdAt: now, updatedAt: now,
      chapters: [{
        id: 'a1r-ch-001', title: 'Chapter 1', path: `stories/${storyId}/chapters/a1r-ch-001`,
        order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: 'a1r-sc-001', title: 'Opening', order: 0, chapterId: 'a1r-ch-001', storyId,
          path: `stories/${storyId}/chapters/a1r-ch-001/scenes/a1r-sc-001.md`,
          draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: 'a1r-sc-001-b1', type: 'prose', content: 'Neon rain.', order: 0, updatedAt: now }],
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', 'a1r-ch-001', 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'a1r-sc-001.md'), [
    '---', 'id: a1r-sc-001', 'title: "Opening"', 'draftState: in-progress',
    `updatedAt: ${now}`, '---', '', 'Neon rain.', '',
  ].join('\n'));
  fs.mkdirSync(notesVaultDir, { recursive: true });
  return { userData, vaultDir, notesVaultDir };
}

async function dismissToasts(page) {
  for (const label of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
      await b.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

for (const { w, h } of VIEWPORTS) {
  const fixture = seed();
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'],
    timeout: 90000,
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: w, height: h });
  try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch { /* boot */ }
  await page.waitForTimeout(2200);
  await dismissToasts(page);
  await page.waitForTimeout(400);

  const tag = `${w}x${h}`;

  // 1) Welcome overlay (title-bar Welcome — no onboardingReplay)
  const welcomeBtn = page.locator('[data-testid="wc-project-trigger"]').first();
  if (await welcomeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await welcomeBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    await page.locator('[data-testid="welcome-overlay"]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, `welcome-overlay-${tag}.png`) });
    console.log(`  shot welcome-overlay-${tag}`);
    const skip = page.locator('[data-testid="welcome-skip"]').first();
    if (await skip.isVisible({ timeout: 1000 }).catch(() => false)) {
      await skip.click().catch(() => {});
      await page.waitForTimeout(500);
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
  } else {
    console.log(`  MISS welcome trigger @ ${tag}`);
  }

  // 2) Demo-on walkthrough bubble + ring
  const demo = page.locator('[data-testid="wc-demo-btn"]').first();
  if (await demo.isVisible({ timeout: 1500 }).catch(() => false)) {
    await demo.click().catch(() => {});
    await page.waitForTimeout(800);
    await page.locator('[data-testid="walkthrough-bubble"]').waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.screenshot({ path: path.join(OUT, `demo-walkthrough-${tag}.png`) });
    console.log(`  shot demo-walkthrough-${tag}`);
    // turn off for rail shot
    await demo.click().catch(() => {});
    await page.waitForTimeout(400);
  } else {
    console.log(`  MISS demo btn @ ${tag}`);
  }

  // 3) Rail without brand M
  await page.screenshot({ path: path.join(OUT, `rail-no-brand-${tag}.png`) });
  console.log(`  shot rail-no-brand-${tag}`);
  const brandCount = await page.locator('.nav-rail__brand').count();
  console.log(`  rail brand count @ ${tag}: ${brandCount}`);

  await app.close();
  for (const p of [fixture.userData, fixture.vaultDir, fixture.notesVaultDir]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

console.log('A1 residual pairs DONE →', OUT);
