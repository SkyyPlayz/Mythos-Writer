// A2 VERIFY pairs @ 1440×900 + 1280×720 (Neon Nebula 50 / glass 20).
// Shots: rail order · writing chrome · Appearance · Shortcuts · Timeline.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();

const OUT_ARG = process.argv.find((a) => a.startsWith('--out='));
const OUT = OUT_ARG
  ? OUT_ARG.slice('--out='.length)
  : outDir('a2-fidelity-pairs');
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 720 },
];
const now = new Date().toISOString();
const storyId = 'a2-story-001';

function seed() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a2-'));
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
      id: storyId, title: 'A2 Fidelity Proof', path: `stories/${storyId}`,
      createdAt: now, updatedAt: now,
      chapters: [{
        id: 'a2-ch-001', title: 'Chapter 1', path: `stories/${storyId}/chapters/a2-ch-001`,
        order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: 'a2-sc-001', title: 'Opening', order: 0, chapterId: 'a2-ch-001', storyId,
          path: `stories/${storyId}/chapters/a2-ch-001/scenes/a2-sc-001.md`,
          draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: 'a2-sc-001-b1', type: 'prose', content: 'Neon rain on glass.', order: 0, updatedAt: now }],
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', 'a2-ch-001', 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'a2-sc-001.md'), [
    '---', 'id: a2-sc-001', 'title: "Opening"', 'draftState: in-progress',
    `updatedAt: ${now}`, '---', '', 'Neon rain on glass.', '',
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

async function openSettings(page, cat) {
  const gear = page.locator('[data-testid="wc-settings-btn"], [aria-label="Settings"]').first();
  if (await gear.isVisible({ timeout: 2000 }).catch(() => false)) {
    await gear.click().catch(() => {});
  } else {
    await page.keyboard.press('Control+,');
  }
  await page.waitForTimeout(600);
  if (cat) {
    const tab = page.locator(`[data-settings-cat="${cat}"], button:has-text("${cat}")`).first();
    if (await tab.isVisible({ timeout: 1500 }).catch(() => false)) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(400);
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
  try { await page.locator('.app-menu-bar, .wc-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch { /* boot */ }
  await page.waitForTimeout(2200);
  await dismissToasts(page);
  await page.waitForTimeout(400);

  const tag = `${w}x${h}`;

  // Quick Entry absent
  const qe = await page.getByText('Quick Entry').count();
  console.log(`  Quick Entry count @ ${tag}: ${qe}`);
  if (qe !== 0) throw new Error(`Quick Entry still present: ${qe}`);

  // A1 residual keep
  if (await page.locator('.nav-rail__brand').count() !== 0) throw new Error('Rail brand M returned');
  if (await page.locator('[data-testid="wc-demo-btn"]').count() !== 0) throw new Error('Demo btn returned');

  // 1) Rail order
  await page.screenshot({ path: path.join(OUT, `rail-order-${tag}.png`) });
  console.log(`  shot rail-order-${tag}`);
  const railText = await page.locator('.nav-rail, [data-testid="app-nav-rail"]').first().innerText().catch(() => '');
  console.log(`  rail text sample: ${railText.replace(/\s+/g, ' ').slice(0, 160)}`);

  // 2) Writing chrome (tabs in center)
  await page.screenshot({ path: path.join(OUT, `writing-chrome-${tag}.png`) });
  console.log(`  shot writing-chrome-${tag}`);

  // 3) Appearance
  await openSettings(page, 'appearance');
  const appearance = page.locator('[data-settings-cat="appearance"], .lnas-root').first();
  await appearance.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await page.screenshot({ path: path.join(OUT, `settings-appearance-${tag}.png`) });
  console.log(`  shot settings-appearance-${tag}`);

  // 4) Shortcuts
  const shortcutsNav = page.locator('button:has-text("Shortcuts"), [data-settings-cat-btn="shortcuts"]').first();
  if (await shortcutsNav.isVisible({ timeout: 1500 }).catch(() => false)) {
    await shortcutsNav.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(OUT, `settings-shortcuts-${tag}.png`) });
  console.log(`  shot settings-shortcuts-${tag}`);

  // Close settings
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 5) Timeline (Demo string gone)
  const tl = page.locator('[data-testid="nav-rail-item-timeline"], .rail-item', { hasText: /Timeline/i }).first();
  if (await tl.isVisible({ timeout: 2000 }).catch(() => false)) {
    await tl.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: path.join(OUT, `timeline-${tag}.png`) });
  console.log(`  shot timeline-${tag}`);
  const demoOnTl = await page.getByText('Demo', { exact: true }).count();
  console.log(`  Timeline Demo string count @ ${tag}: ${demoOnTl}`);
  if (demoOnTl !== 0) throw new Error(`Timeline Demo placeholder still present: ${demoOnTl}`);

  // Rounded chrome chase evidence
  const radius = await page.evaluate(() => {
    const el = document.querySelector('.desktop-shell');
    return el ? getComputedStyle(el).borderRadius : 'missing';
  });
  console.log(`  .desktop-shell border-radius @ ${tag}: ${radius}`);
  await page.screenshot({ path: path.join(OUT, `rounded-chrome-chase-${tag}.png`) });
  console.log(`  shot rounded-chrome-chase-${tag}`);

  await app.close();
  for (const p of [fixture.userData, fixture.vaultDir, fixture.notesVaultDir]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

console.log('A2 VERIFY pairs DONE →', OUT);
