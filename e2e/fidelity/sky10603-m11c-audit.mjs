// SKY-10603 (M11c manual-mode completeness audit) — QA verification script.
// Seeds a real story + one user comment + one agent (archive-kind) comment,
// then drives the app with AI master off (and on, for comparison) to check
// two surfaces the code audit flagged as unguarded by useAiEnabled():
//   1. Editor sub-tab bar — does "Coach" disappear when AI is off?
//   2. Comments gutter — does the agent-authored comment hide when AI is off?
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky10603-m11c-audit');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };
const now = new Date().toISOString();
const storyId = 'aud-story-10603';
const STORY_TITLE = 'Manual Mode Audit Story';
const sceneId = 'aud-sc-10603';
const chapterId = 'aud-ch-10603';
const BODY = 'The gate had not been broken so much as persuaded.';

function seedFixture(aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10603-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault10603-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault10603-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: { enabled: aiEnabled, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000, scanIntervalSeconds: 30 },
      brainstorm: { enabled: aiEnabled, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      archive: { enabled: aiEnabled, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const storyPath = `stories/${storyId}`;
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: storyId, title: STORY_TITLE, path: storyPath, createdAt: now, updatedAt: now,
      chapters: [{ id: chapterId, title: 'Chapter 1', path: `${storyPath}/chapters/${chapterId}`, order: 0, createdAt: now, updatedAt: now,
        scenes: [{ id: sceneId, title: 'The Broken Gate', order: 0, chapterId, storyId,
          path: `${storyPath}/chapters/${chapterId}/scenes/${sceneId}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
          blocks: [{ id: `${sceneId}-b1`, type: 'prose', content: BODY, order: 0, updatedAt: now }] }] }] }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), [
    '---', `id: ${sceneId}`, `title: "The Broken Gate"`, 'draftState: in-progress', `updatedAt: ${now}`,
    '---', '', BODY, '',
  ].join('\n'));

  // One user comment + one agent (archive-kind) comment, per comments/types.ts.
  const storyDir = path.join(vaultDir, storyPath);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'comments.json'), JSON.stringify({
    version: 1,
    comments: [
      { id: 'c-user-1', storyId, sceneId, anchor: 'gate had not been broken', text: 'Nice line.', kind: 'user', author: 'You', createdAt: now },
      { id: 'c-agent-1', storyId, sceneId, anchor: 'so much as persuaded', text: 'Continuity: check gate state in ch.2.', kind: 'archive', author: 'Archive Agent', createdAt: now },
    ],
  }, null, 2));

  return { userData, vaultDir, notesVaultDir };
}

function cleanupFixture({ userData, vaultDir, notesVaultDir }) {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
}

async function run(aiEnabled) {
  const prefix = aiEnabled ? 'ai-on-' : 'ai-off-';
  const fixture = seedFixture(aiEnabled);
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', d => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
  await page.waitForTimeout(2500);

  const alive = () => !page.isClosed();
  async function clearBlockers() {
    for (let i = 0; i < 4; i++) {
      if (!alive()) return;
      let acted = false;
      for (const label of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
        if (!alive()) return;
        const b = page.locator(`button:has-text("${label}")`).first();
        if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
          await b.click().catch(() => {}); acted = true;
          await page.waitForTimeout(500).catch(() => {});
        }
      }
      if (!acted) break;
    }
    if (alive()) await page.keyboard.press('Escape').catch(() => {});
    if (alive()) await page.waitForTimeout(400).catch(() => {});
  }
  await clearBlockers();

  const shot = async (name) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${prefix}${name}.png` });
    console.log(`  shot ${prefix}${name}`);
  };
  await shot('00-boot');

  // Select the story via the Stories popover (SKY-10382 pattern).
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.nav-rail__item, [class*="nav-rail__item"]')];
    for (const el of items) {
      const box = el.closest('button,[role="button"],li,div') || el;
      if ((box.innerText || '').replace(/[^A-Za-z ]/g, '').trim() === 'Story Writer') { box.click(); return; }
    }
  });
  await page.waitForTimeout(1200);
  let storySelected = await page.evaluate((sid) => {
    const row = document.querySelector(`[data-testid="nav-rail-story-${sid}"]`);
    if (row) { row.click(); return true; }
    return false;
  }, storyId);
  if (!storySelected) {
    storySelected = await page.evaluate((title) => {
      const el = [...document.querySelectorAll('.nav-story-title')].find((t) => (t.textContent || '').trim() === title);
      if (el) { el.click(); return true; }
      return false;
    }, STORY_TITLE);
  }
  await page.waitForTimeout(1000);
  console.log(`  storySelected=${storySelected}`);

  // Open the scene.
  try {
    const storyRow = page.locator('.nav-story-row').first();
    if (await storyRow.isVisible({ timeout: 4000 }).catch(() => false)) {
      await storyRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
      await page.waitForTimeout(500);
      const rows = page.locator('.nav-chapter-row');
      const cn = await rows.count().catch(() => 0);
      for (let i = 0; i < cn; i++) await rows.nth(i).locator('.nav-expand-btn, button').first().click().catch(() => {});
      await page.waitForTimeout(600);
      const scene = page.locator('.nav-scene-row').first();
      if (await scene.isVisible({ timeout: 2000 }).catch(() => false)) { await scene.click(); await page.waitForTimeout(1800); }
    }
  } catch (e) { console.log('tree nav: ' + String(e).slice(0, 120)); }

  await shot('editor-scene-open');

  // 1) Editor sub-tab bar — is Coach present?
  const subTabBarText = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="story-subview-bar"]');
    return bar ? bar.innerText : '(bar not found)';
  });
  const coachTabPresent = await page.evaluate(() => !!document.querySelector('[data-testid="story-subview-coach"]'));
  console.log(`  SUBTAB_BAR aiEnabled=${aiEnabled}: "${subTabBarText.replace(/\n/g, ' | ')}"`);
  console.log(`  COACH_TAB_PRESENT aiEnabled=${aiEnabled}: ${coachTabPresent}`);

  // If Coach tab is clickable, try clicking it to see what renders (manual path check).
  if (coachTabPresent) {
    await page.locator('[data-testid="story-subview-coach"]').click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot('coach-tab-clicked');
    const coachBodyText = await page.evaluate(() => document.body.innerText);
    console.log(`  COACH_PAGE_TEXT aiEnabled=${aiEnabled}: "${coachBodyText.slice(0, 300).replace(/\n/g, ' | ')}"`);
    // back to editor
    await page.locator('[data-testid="story-subview-editor"]').click().catch(() => {});
    await page.waitForTimeout(800);
  }

  // 2) Comments gutter — is the agent comment visible?
  const commentsGutterText = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[class*="comments-gutter"], [class*="CommentsGutter"]')];
    return els.map(e => e.innerText).join(' || ') || '(gutter not found in DOM)';
  });
  const bodyHasAgentComment = await page.evaluate(() => document.body.innerText.includes('Archive Agent'));
  const bodyHasUserComment = await page.evaluate(() => document.body.innerText.includes('Nice line.'));
  console.log(`  GUTTER_TEXT aiEnabled=${aiEnabled}: "${commentsGutterText.slice(0, 400).replace(/\n/g, ' | ')}"`);
  console.log(`  AGENT_COMMENT_VISIBLE aiEnabled=${aiEnabled}: ${bodyHasAgentComment}`);
  console.log(`  USER_COMMENT_VISIBLE aiEnabled=${aiEnabled}: ${bodyHasUserComment}`);
  await shot('comments-gutter');

  await app.close().catch(() => {});
  cleanupFixture(fixture);
}

await run(false);
await run(true);
console.log('DONE');
