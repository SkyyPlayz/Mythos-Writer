// SKY-9823 (M9b): side-by-side captures for the fidelity gate — prototype
// right-panel Notes tab vs the app's Notes tab (SCENE NOTES pinned list).
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions, mainJs as MAIN_JS, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky9823-scene-notes');
fs.mkdirSync(OUT, { recursive: true });

// The two demo notes the prototype seeds in its Notes tab (quickNotes).
const DEMO_NOTES = [
  'Check: how does drownlight behave near iron?',
  'Foreshadow the Lamplighter in the Ch. 2 crowd scene',
];

// ── 1. Prototype side ────────────────────────────────────────────────────────
{
  const proto = await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div,span,button,a,li')];
    const hit = els.filter((e) => (e.innerText || '').trim() === 'Notes' && getComputedStyle(e).cursor === 'pointer');
    if (!hit.length) return false;
    hit.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    hit[0].click();
    return true;
  });
  console.log('proto Notes tab clicked = ' + clicked);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${OUT}/1-prototype-notes-tab.png` });
  await page.screenshot({ path: `${OUT}/1b-prototype-notes-tab-right.png`, clip: { x: 1920 - 420, y: 0, width: 420, height: 1080 } });
  await browser.close();
  await proto.close();
}

// ── 2. App side ──────────────────────────────────────────────────────────────
{
  const now = new Date().toISOString();
  const SID = 'fid-story', CID = 'fid-c1', SC = 'fid-s1';
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9823-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-9823-'));
  const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-9823-'));
  const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, rightSidebarVisible: true, notesTabUpgradeToastShown: true,
    agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, createdAt: now, updatedAt: now,
      chapters: [{ id: CID, title: 'Fractures', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: now, updatedAt: now,
        scenes: [{ id: SC, title: 'Into the Undercity', order: 0, chapterId: CID, storyId: SID,
          path: `stories/${SID}/chapters/${CID}/scenes/${SC}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: SC + '-b', type: 'prose', content: 'The stairwell yawned like a throat.', order: 0, updatedAt: now }] }] }] }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const d = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, SC + '.md'), ['---', `id: ${SC}`, 'title: "Into the Undercity"', 'draftState: in-progress', '---', '', 'The stairwell yawned like a throat.', ''].join('\n'));

  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(3000);
  for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.locator('.nav-scene-row').first().click({ force: true, timeout: 10000 });
  await page.locator('.ahp-tab', { hasText: 'Notes' }).click({ timeout: 10000 });
  const input = page.locator('input[aria-label="New scene note"]');
  await input.waitFor({ state: 'visible', timeout: 10000 });
  for (const note of DEMO_NOTES) {
    await input.fill(note);
    await page.locator('.snp-add-btn').click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/2-app-notes-tab.png` });
  await page.screenshot({ path: `${OUT}/2b-app-notes-tab-right.png`, clip: { x: 1920 - 420, y: 0, width: 420, height: 1080 } });
  await app.close();
  for (const dir of [userData, vaultDir, notesDir]) fs.rmSync(dir, { recursive: true, force: true });
}

console.log('DONE → ' + OUT);
