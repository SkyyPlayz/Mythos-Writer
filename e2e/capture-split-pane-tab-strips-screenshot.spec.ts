/**
 * capture-split-pane-tab-strips-screenshot.spec.ts — SKY-8907 (not part of CI)
 *
 * One-off Playwright script to capture a PR evidence screenshot of the
 * per-pane tab strips: split view active, each pane showing its own,
 * independent tab strip with a different scene open. Not registered in
 * package.json/CI — run manually:
 *   npx playwright test e2e/capture-split-pane-tab-strips-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/split-pane-tab-strips-sky8907');
const STORY_ID = 'ss-story-0001';
const CHAPTER_ID = 'ss-chapter-0001';
const SCENE_ALPHA_ID = 'ss-scene-alpha';
const SCENE_BETA_ID = 'ss-scene-beta';

test('capture split-pane tab strips screenshot', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const manifestDir = path.join(vaultDir, 'stories');
  fs.mkdirSync(manifestDir, { recursive: true });
  const now = new Date().toISOString();
  const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  const scene = (id: string, title: string, order: number) => ({
    id, title,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${id}.md`,
    chapterId: CHAPTER_ID, storyId: STORY_ID, order,
    draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
  });
  const manifest = {
    version: 1,
    stories: [{
      id: STORY_ID, title: 'Split Tab Story', path: `stories/${STORY_ID}`, order: 0,
      createdAt: now, updatedAt: now,
      chapters: [{
        id: CHAPTER_ID, title: 'Chapter One', storyId: STORY_ID, order: 0,
        createdAt: now, updatedAt: now,
        scenes: [scene(SCENE_ALPHA_ID, 'Scene Alpha', 0), scene(SCENE_BETA_ID, 'Scene Beta', 1)],
      }],
    }],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(sceneDir, `${SCENE_ALPHA_ID}.md`), '');
  fs.writeFileSync(path.join(sceneDir, `${SCENE_BETA_ID}.md`), '');

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });

  await page.locator('[data-testid="split-toggle-btn"]').click();
  await expect(page.locator('[data-testid="split-divider"]')).toBeVisible({ timeout: 8_000 });

  const selectSceneInPane = async (paneNumber: 1 | 2, sceneId: string) => {
    const pane = page.locator(`[data-testid="split-pane-${paneNumber}"]`);
    await pane.locator('[data-testid="spe-scene-btn"]').click();
    await pane.locator(`[data-testid="spe-scene-option-${sceneId}"]`).click();
  };

  await selectSceneInPane(1, SCENE_ALPHA_ID);
  await selectSceneInPane(2, SCENE_BETA_ID);
  await expect(page.locator('[data-testid="split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Scene Alpha' })).toBeVisible();
  await expect(page.locator('[data-testid="split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Scene Beta' })).toBeVisible();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'split-pane-independent-tab-strips.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
