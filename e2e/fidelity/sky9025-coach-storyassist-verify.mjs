// QA re-verification for SKY-9025 close-out (SKY-10618, SKY-10620).
// Not a permanent fixture — ad hoc live-app probe, run once and discard.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { outDir, mainJs as MAIN_JS, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky9025-coach-storyassist-verify');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const NOW = new Date().toISOString();
const SID = 'sa-story', CID = 'sa-c1', SCN = 'sa-s1';
const PROSE = 'The lighthouse keeper counted the ships that never came, and wondered if the sea itself had forgotten how to send them home.';

function seedVault() {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-9025-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-9025-'));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: SID, title: 'The Lighthouse', path: `stories/${SID}`, genre: 'Literary', createdAt: NOW, updatedAt: NOW,
      chapters: [{ id: CID, title: 'Tides', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: NOW, updatedAt: NOW,
        scenes: [{
          id: SCN, title: 'The Watch', order: 0, chapterId: CID, storyId: SID,
          path: `stories/${SID}/chapters/${CID}/scenes/${SCN}.md`, draftState: 'in-progress',
          createdAt: NOW, updatedAt: NOW,
          blocks: [{ id: `${SCN}-b`, type: 'prose', content: PROSE, order: 0, updatedAt: NOW }],
        }] }] }],
    entities: [], suggestions: [], scenes: [], chapters: [], provenance: {}, boardReferences: [], smartFolders: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${SCN}.md`),
    ['---', `id: ${SCN}`, 'title: "The Watch"', 'draftState: in-progress', `updatedAt: ${NOW}`, '---', '', PROSE, ''].join('\n'));
  return { vaultDir, notesVaultDir };
}

function seedUserData(vault, aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-9025-ud-${aiEnabled ? 'on' : 'off'}-`));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    onboardingComplete: true,
    ai: { enabled: aiEnabled },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vault.vaultDir, notesVaultRoot: vault.notesVaultDir }, null, 2));
  return userData;
}

async function run(vault, aiEnabled) {
  const userData = seedUserData(vault, aiEnabled);
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (x) => void x.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(3000);
  for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = page.locator(`button:has-text("${l}")`).first();
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
  }
  await page.keyboard.press('Escape').catch(() => {});

  for (let i = 0; i < 3; i++) {
    const btns = page.locator('.nav-expand-btn');
    const n = await btns.count().catch(() => 0);
    for (let j = 0; j < n; j++) await btns.nth(j).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  const row = page.locator('.nav-scene-row', { hasText: 'The Watch' }).first();
  if (await row.count().catch(() => 0) > 0) {
    await row.click({ force: true, timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  const label = aiEnabled ? 'ai-on' : 'ai-off';
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(`${label}: scene open`, !/Select a scene|Welcome to Mythos/.test(bodyText));

  const coachTab = page.locator('button', { hasText: 'Coach' }).first();
  const coachVisible = await coachTab.isVisible({ timeout: 1000 }).catch(() => false);
  const storyAssistBtn = page.locator('[data-testid="story-assist-btn"]').first();
  const storyAssistVisible = await storyAssistBtn.isVisible({ timeout: 1000 }).catch(() => false);

  if (aiEnabled) {
    check('ai-on: Coach sub-tab present', coachVisible);
    check('ai-on: Story Assist button present', storyAssistVisible);
  } else {
    check('ai-off: Coach sub-tab absent', !coachVisible);
    check('ai-off: Story Assist button absent', !storyAssistVisible);
  }

  await page.screenshot({ path: `${OUT}/${label}.png` });
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}

const vault = seedVault();
await run(vault, false);
await run(vault, true);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed → ${OUT}`);
if (failed.length) process.exit(1);
