/**
 * capture-sky10876-timeline-rebuild-screenshot.spec.ts — SKY-10876 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence for the "Rebuild my
 * timeline" command: Timeline view → right panel → Archive tab → the new
 * "Rebuild my timeline" button, before and after a real rebuild. Not
 * registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky10876-timeline-rebuild-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10876-timeline-rebuild-command');

const STORY_ID = 'story-timeline-rebuild-shots';
const CHAPTER_ID = 'chapter-timeline-rebuild-shots';
const STORY_TITLE = 'The Rebuilt Chronicle';
const CHAPTER_TITLE = 'Opening Chapter';
const SCENE = { id: 'sc-shots-a', title: 'The Departure' };

test('capture "Rebuild my timeline" in the Archive tab', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-rebuild-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-rebuild-shots-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-rebuild-shots-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });
  const manifest = {
    schemaVersion: 1, version: '2.0.0', vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID, title: STORY_TITLE, path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID, title: CHAPTER_TITLE, path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`, order: 0,
        scenes: [{
          id: SCENE.id, title: SCENE.title, path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE.id}.md`,
          order: 0, chapterId: CHAPTER_ID, storyId: STORY_ID, blocks: [], createdAt: now, updatedAt: now,
        }],
        createdAt: now, updatedAt: now,
      }],
      createdAt: now, updatedAt: now,
    }],
    entities: [], suggestions: [], scenes: [], chapters: [], provenance: {}, boardReferences: [], smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const scenePath = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${SCENE.id}.md`);
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  fs.writeFileSync(scenePath, `---\nid: ${SCENE.id}\ntitle: ${SCENE.title}\nchapterId: ${CHAPTER_ID}\nstoryId: ${STORY_ID}\nupdatedAt: ${now}\n---\n\n${SCENE.title} prose body.\n`);
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify({
    schemaVersion: 1, activeTimelineId: 'tl-shots',
    timelines: [{ id: 'tl-shots', name: STORY_TITLE, kind: 'story', axis: 'calendar', calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 }, createdAt: now, updatedAt: now }],
    eras: [], spans: [], rows: [], events: [],
  }, null, 2));

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE.title }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if (await storyNavBtn.getAttribute('aria-current') !== 'page') await storyNavBtn.click();
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
  const timelineBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="timeline-right-panel"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="trp-tab-archive"]').click();
  await expect(page.locator('[data-testid="trp-archive-tab"]')).toBeVisible({ timeout: 6_000 });

  const rebuildBtn = page.locator('[data-testid="trp-rebuild-timeline-btn"]');
  await expect(rebuildBtn).toBeVisible({ timeout: 6_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, '01-rebuild-button-in-archive-tab.png') });

  await rebuildBtn.click();
  await expect.poll(() => {
    const raw = fs.readFileSync(path.join(vaultDir, 'timelines.json'), 'utf-8');
    return JSON.parse(raw).events.length;
  }, { timeout: 10_000 }).toBe(1);
  await page.screenshot({ path: path.join(OUT_DIR, '02-after-rebuild.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
