// SKY-10608 — Comments gutter honors the AI master toggle (M11c defect).
// Surface contract (PLAN.md §4 M11 M11b, "Comments gutter" row): AI off →
// human comments only; agent comments hidden not deleted; reappear when AI
// returns. Repro fixture mirrors the SKY-10603 audit: one kind:'user'
// comment + one kind:'archive' comment in comments.json.
//
// Two app launches against the SAME vault (so "hidden not deleted" is proved
// by the same comments.json feeding both): ai.enabled:false → only the human
// card; ai.enabled:true → both cards.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// never pipe the runner through `head`).
//
// Usage: xvfb-run node e2e/fidelity/sky10608-comments-ai-gate.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { outDir, mainJs as MAIN_JS, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky10608-comments-ai-gate');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const NOW = new Date().toISOString();
const SID = 'cg-story', CID = 'cg-c1', SCN = 'cg-s1';
const USER_ANCHOR = 'gate had not been broken';
const AGENT_ANCHOR = 'so much as persuaded';
const PROSE = `Mira swore the ${USER_ANCHOR}, not by storm nor siege. The Council had not been warned, ${AGENT_ANCHOR}, and the bells kept their own counsel until dawn.`;
const USER_TEXT = 'Nice line.';
const AGENT_TEXT = 'Continuity: check gate state in ch.2.';

// One shared vault — both launches read the identical comments.json.
function seedVault() {
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-10608-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-10608-'));
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: SID, title: 'The Broken Gate', path: `stories/${SID}`, genre: 'Epic Fantasy', createdAt: NOW, updatedAt: NOW,
      chapters: [{ id: CID, title: 'Fractures', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: NOW, updatedAt: NOW,
        scenes: [{
          id: SCN, title: 'The Gate Holds', order: 0, chapterId: CID, storyId: SID,
          path: `stories/${SID}/chapters/${CID}/scenes/${SCN}.md`, draftState: 'in-progress',
          createdAt: NOW, updatedAt: NOW,
          blocks: [{ id: `${SCN}-b`, type: 'prose', content: PROSE, order: 0, updatedAt: NOW }],
        }] }] }],
    entities: [], suggestions: [], scenes: [], chapters: [], provenance: {}, boardReferences: [], smartFolders: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${SCN}.md`),
    ['---', `id: ${SCN}`, 'title: "The Gate Holds"', 'draftState: in-progress', `updatedAt: ${NOW}`, '---', '', PROSE, ''].join('\n'));
  fs.writeFileSync(path.join(vaultDir, 'stories', SID, 'comments.json'), JSON.stringify({
    version: 1,
    comments: [
      { id: 'c-user-1', storyId: SID, sceneId: SCN, anchor: USER_ANCHOR, author: 'You', kind: 'user', text: USER_TEXT, createdAt: NOW },
      { id: 'c-arch-1', storyId: SID, sceneId: SCN, anchor: AGENT_ANCHOR, author: 'Archive Agent', kind: 'archive', text: AGENT_TEXT, createdAt: NOW },
    ],
  }, null, 2) + '\n');
  return { vaultDir, notesVaultDir };
}

function seedUserData(vault, aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-10608-ud-${aiEnabled ? 'on' : 'off'}-`));
  const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedProgress: { completedItems: [], dismissed: true },
    ai: { enabled: aiEnabled },
    agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vault.vaultDir, notesVaultRoot: vault.notesVaultDir }, null, 2));
  return userData;
}

async function captureRun(vault, { aiEnabled, shotName }) {
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
  const row = page.locator('.nav-scene-row', { hasText: 'The Gate Holds' }).first();
  if (await row.count().catch(() => 0) > 0) {
    await row.click({ force: true, timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  const bodyText = await page.evaluate(() => document.body.innerText);
  const label = aiEnabled ? 'ai-on' : 'ai-off';
  check(`${label}: scene open`, !/Select a scene|Welcome to Mythos/.test(bodyText));
  check(`${label}: human comment visible`, bodyText.includes(USER_TEXT));
  if (aiEnabled) {
    check('ai-on: agent comment visible (reappears, not deleted)', bodyText.includes(AGENT_TEXT) && bodyText.includes('Archive Agent'));
  } else {
    check('ai-off: agent comment hidden', !bodyText.includes(AGENT_TEXT) && !bodyText.includes('Archive Agent'));
  }
  await page.screenshot({ path: `${OUT}/${shotName}.png` });
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}

const vault = seedVault();
await captureRun(vault, { aiEnabled: false, shotName: 'ai-off-comments-gutter' });
await captureRun(vault, { aiEnabled: true, shotName: 'ai-on-comments-gutter' });

// "Hidden, not deleted" — the shared comments.json still holds both entries
// after both runs (the filter is render-time only, no writes).
const after = JSON.parse(fs.readFileSync(path.join(vault.vaultDir, 'stories', SID, 'comments.json'), 'utf8'));
check('comments.json untouched (both comments persisted)',
  Array.isArray(after.comments) && after.comments.length === 2,
  `count=${after.comments?.length}`);

for (const d of [vault.vaultDir, vault.notesVaultDir]) fs.rmSync(d, { recursive: true, force: true });

fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(checks, null, 2));
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed → ${OUT}`);
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' | ')); process.exitCode = 1; }
console.log('DONE');
