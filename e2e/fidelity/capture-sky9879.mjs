// Ad-hoc capture for SKY-9879 PR #1212 screenshot-check evidence.
// Boots the app with an EMPTY vault so the Brainstorm Board and Timeline
// Plotlines/Relationships/Subway empty states (the shared EmptyState
// component this PR introduces) actually render.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky9879');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1600, height: 1000 };
const now = new Date().toISOString();
const storyId = 'sky9879-story';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-9879-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-9879-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-9879-'));

const agentCfg = (extra = {}) => ({
  enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
  maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500000, ...extra,
});
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  agents: { writingAssistant: agentCfg({ scanIntervalSeconds: 30 }), brainstorm: agentCfg({ enabled: true }), archive: agentCfg({ continuityCheckIntervalSeconds: 60 }) },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

// One scene so `selectedStory` gets set (needed for the Relationships/Subway
// aeon views) while leaving Brainstorm facts + Timeline plotlines/relationships/
// subway data stores themselves empty (those are separate from scene content).
const chapterId = 'sky9879-ch-001';
const sceneId = 'sky9879-sc-001';
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: storyId, title: 'Empty Story', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
    chapters: [{ id: chapterId, title: 'Chapter 1', path: `stories/${storyId}/chapters/${chapterId}`, order: 0, createdAt: now, updatedAt: now,
      scenes: [{ id: sceneId, title: 'Opening', order: 0, chapterId, storyId,
        path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now }] }] }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
fs.mkdirSync(sceneDir, { recursive: true });
fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`),
  ['---', `id: ${sceneId}`, 'title: "Opening"', 'draftState: in-progress', `updatedAt: ${now}`, '---', '', 'A quiet start.', ''].join('\n'));

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
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
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot ' + name);
};
await shot('00-boot');

// Select the story first (Timeline/Brainstorm show "Select a story" otherwise).
async function goRail(label) {
  await clearBlockers();
  const ok = await page.evaluate((lbl) => {
    const items = [...document.querySelectorAll('.nav-rail__item, [class*="nav-rail__item"]')];
    for (const el of items) {
      const box = el.closest('button,[role="button"],li,div') || el;
      if ((box.innerText || '').replace(/[^A-Za-z ]/g, '').trim() === lbl) { box.click(); return true; }
    }
    return false;
  }, label);
  await page.waitForTimeout(1500);
  return ok;
}
await goRail('Story Writer');
await clearBlockers();
try {
  const storyRow = page.locator('.nav-story-row').first();
  if (await storyRow.isVisible({ timeout: 4000 }).catch(() => false)) {
    await storyRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
    await page.waitForTimeout(500);
    const chapterRow = page.locator('.nav-chapter-row').first();
    if (await chapterRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await chapterRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const scene = page.locator('.nav-scene-row').first();
    if (await scene.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scene.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  }
} catch {}

if (await goRail('Brainstorm')) await shot('brainstorm-board-empty');

if (await goRail('Timeline')) {
  await shot('timeline-default');
  for (const label of ['Plotlines', 'Relationships', 'Subway']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible({ timeout: 1500 }).catch(() => false)) {
      await b.click().catch(() => {});
      await page.waitForTimeout(2500);
      await shot(`timeline-${label.toLowerCase()}-empty`);
    }
  }
}

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
fs.rmSync(notesVaultDir, { recursive: true, force: true });
console.log('DONE');
