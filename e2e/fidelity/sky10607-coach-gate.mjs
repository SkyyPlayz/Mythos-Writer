// SKY-10607: verify the Coach editor sub-tab is gated by the master AI toggle.
// Pass A (ai.enabled=false): sub-tab bar must show Editor | Structure | Book,
//   [data-testid="story-subview-coach"] must not exist, coach-page unreachable.
// Pass B (ai.enabled=true): all four tabs present, Coach clickable.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via testids, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky10607-coach-gate');
const now = new Date().toISOString();
const SID = 'cg-story';
const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };

function seed(aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cg-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-cg-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    ai: { enabled: aiEnabled },
    agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
  const scene = { id: 'cg-s1', t: "The Watcher's Call", b: 'Mira Veynn had counted the bells of the upper city for nineteen years, and never once had they rung at dusk.' };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, genre: 'Epic Fantasy', createdAt: now, updatedAt: now,
      chapters: [{ id: 'cg-c1', title: 'Chapter 1: The Quiet Before', path: `stories/${SID}/chapters/cg-c1`, order: 0, createdAt: now, updatedAt: now,
        scenes: [{ id: scene.id, title: scene.t, order: 0, chapterId: 'cg-c1', storyId: SID,
          path: `stories/${SID}/chapters/cg-c1/scenes/${scene.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: scene.id + '-b', type: 'prose', content: scene.b, order: 0, updatedAt: now }] }] }] }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const d = path.join(vaultDir, 'stories', SID, 'chapters', 'cg-c1', 'scenes');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, scene.id + '.md'),
    ['---', `id: ${scene.id}`, `title: "${scene.t}"`, 'draftState: in-progress', `updatedAt: ${now}`, '---', '', scene.b, ''].join('\n'));
  return { userData, vaultDir };
}

async function run(label, aiEnabled) {
  const { userData, vaultDir } = seed(aiEnabled);
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', d => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
  await page.waitForTimeout(3000);
  for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  await page.keyboard.press('Escape').catch(() => {});

  // expand + open the scene so the sub-tab bar reflects a real editing session
  for (let i = 0; i < 3; i++) {
    const btns = page.locator('.nav-expand-btn');
    const n = await btns.count().catch(() => 0);
    for (let j = 0; j < n; j++) await btns.nth(j).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const rows = page.locator('.nav-scene-row');
  if (await rows.count().catch(() => 0) > 0) { await rows.nth(0).click({ force: true, timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2200); }

  const tabs = await page.locator('[data-testid="story-subview-bar"] [role="tab"]').allInnerTexts().catch(() => []);
  const coachCount = await page.locator('[data-testid="story-subview-coach"]').count().catch(() => -1);
  const coachPage = await page.locator('[data-testid="coach-page"]').count().catch(() => -1);
  console.log(`${label}: tabs=[${tabs.join(' | ')}] coachTab=${coachCount} coachPage=${coachPage}`);
  await page.screenshot({ path: `${OUT}/${label}-editor-scene-open.png` });

  if (aiEnabled && coachCount > 0) {
    await page.locator('[data-testid="story-subview-coach"]').click();
    await page.waitForTimeout(2000);
    const cp = await page.locator('[data-testid="coach-page"]').count().catch(() => -1);
    console.log(`${label}: coach clicked, coachPage=${cp}`);
    await page.screenshot({ path: `${OUT}/${label}-coach-tab-clicked.png` });
  }
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  return { tabs, coachCount, coachPage };
}

const off = await run('ai-off', false);
const on = await run('ai-on', true);

const pass = off.coachCount === 0 && off.coachPage === 0 && off.tabs.length === 3
  && on.coachCount === 1 && on.tabs.length === 4;
console.log(pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
