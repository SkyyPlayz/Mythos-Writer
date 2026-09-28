// A1 app shell pairs at 1440×900 + 1280×720 (Neon Nebula int 50 / glass 20).
// Mirrors capture-app2 launch/seed shape; shell-only shots.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('a1-pairs');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 720 },
];
const now = new Date().toISOString();
const storyId = 'a1-story-001';

function seed() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a1-'));
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
      id: storyId, title: 'A1 Shell Proof', path: `stories/${storyId}`,
      createdAt: now, updatedAt: now,
      chapters: [{
        id: 'a1-ch-001', title: 'Chapter 1', path: `stories/${storyId}/chapters/a1-ch-001`,
        order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: 'a1-sc-001', title: 'Opening', order: 0, chapterId: 'a1-ch-001', storyId,
          path: `stories/${storyId}/chapters/a1-ch-001/scenes/a1-sc-001.md`,
          draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: 'a1-sc-001-b1', type: 'prose', content: 'Neon rain.', order: 0, updatedAt: now }],
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', 'a1-ch-001', 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'a1-sc-001.md'), [
    '---', 'id: a1-sc-001', 'title: "Opening"', 'draftState: in-progress',
    `updatedAt: ${now}`, '---', '', 'Neon rain.', '',
  ].join('\n'));
  fs.mkdirSync(notesVaultDir, { recursive: true });
  return { userData, vaultDir, notesVaultDir };
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
  await page.waitForTimeout(2500);
  for (const label of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
      await b.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  await page.waitForTimeout(600);
  const tag = `${w}x${h}`;
  await page.screenshot({ path: path.join(OUT, `app-shell-${tag}.png`) });
  console.log(`  shot app-shell-${tag}`);

  const demo = page.locator('[data-testid="wc-demo-btn"]').first();
  if (await demo.isVisible({ timeout: 1500 }).catch(() => false)) {
    await demo.click().catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `app-demo-on-${tag}.png`) });
    console.log(`  shot app-demo-on-${tag}`);
  } else {
    console.log(`  MISS demo btn @ ${tag}`);
  }

  await app.close();
  for (const p of [fixture.userData, fixture.vaultDir, fixture.notesVaultDir]) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

console.log('A1 app pairs DONE →', OUT);
