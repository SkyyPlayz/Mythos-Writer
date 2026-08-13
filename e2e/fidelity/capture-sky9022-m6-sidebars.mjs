// Ad-hoc capture for SKY-9022 (M6) PR fidelity evidence (PLAN.md P0.3): both
// sidebars rebuilt to the prototype spec, panel system removed. Shoots the
// prototype and the real app side by side, at the editor default view (both
// sidebars) and with the right sidebar's Scenes tab active.
// Usage: node e2e/fidelity/capture-sky9022-m6-sidebars.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron, chromium } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild, serveProto, chromiumLaunchOptions } from './lib.mjs';

requireBuild();
const OUT_DIR = outDir('sky9022-m6-sidebars');
const VIEWPORT = { width: 1920, height: 1080 };
const STORY_ID = 'm6-story-0001';
const CHAPTER_ID = 'm6-chapter-0001';
const SCENE_ID = 'm6-scene-0001';

// ── 1/2: prototype ──────────────────────────────────────────────────────────
const proto = await serveProto();
const browser = await chromium.launch(chromiumLaunchOptions());
const protoPage = await browser.newPage({ viewport: VIEWPORT });
await protoPage.goto(proto.url, { waitUntil: 'networkidle', timeout: 60_000 });
await protoPage.waitForTimeout(3500);
await protoPage.screenshot({ path: path.join(OUT_DIR, '1-proto-editor-both-sidebars.png') });

const clickText = async (label) => protoPage.evaluate((lbl) => {
  const els = [...document.querySelectorAll('div,span,button,a,li')];
  const hit = els.filter((e) => {
    const t = e.innerText?.trim();
    return t === lbl && getComputedStyle(e).cursor === 'pointer';
  });
  if (!hit.length) return false;
  hit[0].click();
  return true;
}, label);
await clickText('Scenes');
await protoPage.waitForTimeout(1300);
await protoPage.screenshot({ path: path.join(OUT_DIR, '2-proto-right-sidebar-scenes-tab.png') });

await browser.close();
await proto.close();

// ── 3/4: real app ────────────────────────────────────────────────────────────
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-shots-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-story-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-notes-'));
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, rightSidebarVisible: true,
  gettingStartedProgress: { completedItems: ['write-scene', 'add-character', 'brainstorm', 'notes-vault'], dismissed: true },
  notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
  agents: {
    writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
  },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

const now = new Date().toISOString();
const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
fs.mkdirSync(sceneDir, { recursive: true });
fs.writeFileSync(path.join(sceneDir, `${SCENE_ID}.md`), '---\ntitle: "The Gate"\n---\n\nShe crossed the threshold. The city held its breath below her.\n', 'utf8');
const manifest = {
  schemaVersion: 1,
  stories: [{
    id: STORY_ID, title: 'The Last City of Veynn', genre: 'Fantasy', path: `stories/${STORY_ID}`, order: 0,
    createdAt: now, updatedAt: now,
    chapters: [{
      id: CHAPTER_ID, title: 'Chapter One', storyId: STORY_ID, order: 0,
      createdAt: now, updatedAt: now,
      scenes: [{
        id: SCENE_ID, title: 'The Gate', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
        chapterId: CHAPTER_ID, storyId: STORY_ID, order: 0,
        draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
      }],
    }],
  }],
};
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize(VIEWPORT);
await page.locator('.app-menu-bar').waitFor({ state: 'visible', timeout: 12_000 });

// Open the seeded scene so both sidebars render with real content.
// SKY-9022 GAP-2: a story-title click resolves and opens the story's first
// scene, so one click selects the story AND puts a scene in the editor.
const storyTitle = page.locator('.nav-story-title').first();
if (await storyTitle.isVisible({ timeout: 4000 }).catch(() => false)) {
  await storyTitle.click();
  await page.locator('.nav-scene-row.active').first()
    .waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
await page.locator('[data-testid="left-rail"]').waitFor({ state: 'visible', timeout: 8_000 });
await page.locator('[data-testid="global-right-sidebar"]').waitFor({ state: 'visible', timeout: 8_000 });
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT_DIR, '3-app-editor-both-sidebars.png') });

await page.locator('[data-testid="global-right-sidebar"]').getByRole('tab', { name: 'Scenes' }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT_DIR, '4-app-right-sidebar-scenes-tab.png') });

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
fs.rmSync(notesVaultDir, { recursive: true, force: true });

// ── 5: AI-off side-by-side (R11 — right sidebar's Assistant tab is entirely
// AI-bearing chrome; the master AI toggle must drop it, not just gray it out) ──
const userDataAiOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-aioff-'));
const vaultDirAiOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-aioff-story-'));
const notesVaultDirAiOff = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-aioff-notes-'));
fs.writeFileSync(path.join(userDataAiOff, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, rightSidebarVisible: true,
  ai: { enabled: false },
  gettingStartedProgress: { completedItems: ['write-scene', 'add-character', 'brainstorm', 'notes-vault'], dismissed: true },
  notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userDataAiOff, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDirAiOff, notesVaultRoot: notesVaultDirAiOff }, null, 2));
fs.writeFileSync(path.join(vaultDirAiOff, 'manifest.json'), JSON.stringify({ ...manifest, stories: manifest.stories.map((s) => ({ ...s, path: s.path })) }, null, 2));
const sceneDirAiOff = path.join(vaultDirAiOff, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
fs.mkdirSync(sceneDirAiOff, { recursive: true });
fs.writeFileSync(path.join(sceneDirAiOff, `${SCENE_ID}.md`), '---\ntitle: "The Gate"\n---\n\nShe crossed the threshold. The city held its breath below her.\n', 'utf8');

const appAiOff = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userDataAiOff}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
const pageAiOff = await appAiOff.firstWindow();
await pageAiOff.waitForLoadState('domcontentloaded');
await pageAiOff.setViewportSize(VIEWPORT);
await pageAiOff.locator('.app-menu-bar').waitFor({ state: 'visible', timeout: 12_000 });
const storyTitleOff = pageAiOff.locator('.nav-story-title').first();
if (await storyTitleOff.isVisible({ timeout: 4000 }).catch(() => false)) {
  await storyTitleOff.click();
  await pageAiOff.locator('.nav-scene-row.active').first()
    .waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
  await pageAiOff.waitForTimeout(1500);
}
await pageAiOff.locator('[data-testid="left-rail"]').waitFor({ state: 'visible', timeout: 8_000 });
await pageAiOff.locator('[data-testid="global-right-sidebar"]').waitFor({ state: 'visible', timeout: 8_000 });
await pageAiOff.waitForTimeout(600);
await pageAiOff.screenshot({ path: path.join(OUT_DIR, '5-app-editor-ai-off.png') });

await appAiOff.close().catch(() => {});
fs.rmSync(userDataAiOff, { recursive: true, force: true });
fs.rmSync(vaultDirAiOff, { recursive: true, force: true });
fs.rmSync(notesVaultDirAiOff, { recursive: true, force: true });

console.log(`Captured 5 screenshots to ${OUT_DIR}`);
