/**
 * depth-slider.spec.ts — SKY-2441
 *
 * E2E tests for the in-editor depth slider + left/right scene navigator.
 *
 *   TC-DS-01  Visible on select   — depth slider bar appears when scene selected
 *   TC-DS-02  Scene→Chapter view  — clicking "Chapter" depth button shows chapter doc view
 *   TC-DS-03  Chapter→Book view   — clicking "Full Book" shows book outline view
 *   TC-DS-04  Book→Scene view     — clicking "Scene" returns to block editor
 *   TC-DS-05  Next navigates      — Next button advances to the next sibling scene
 *   TC-DS-06  Prev navigates      — Prev button returns to the previous scene
 *   TC-DS-07  Boundary disabling  — Prev disabled at first scene; Next disabled at last
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/depth-slider.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const STORY_ID = 'ds-story-01';
const CHAPTER_ID = 'ds-ch-01';
const SCENE1_ID = 'ds-sc-01';
const SCENE2_ID = 'ds-sc-02';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSceneContent(id: string, title: string, order: number): string {
  const now = new Date().toISOString();
  return [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    `order: ${order}`,
    'draftState: in-progress',
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    '---',
    '',
    '<!-- BLOCKS_JSON',
    JSON.stringify([]),
    'END_BLOCKS_JSON -->',
  ].join('\n');
}

function seedVault(vaultDir: string): void {
  const chapterDir = path.join(vaultDir, 'Manuscript', STORY_ID, CHAPTER_ID);
  fs.mkdirSync(chapterDir, { recursive: true });

  fs.writeFileSync(
    path.join(chapterDir, `${SCENE1_ID}.md`),
    makeSceneContent(SCENE1_ID, 'Scene One', 0),
  );
  fs.writeFileSync(
    path.join(chapterDir, `${SCENE2_ID}.md`),
    makeSceneContent(SCENE2_ID, 'Scene Two', 1),
  );

  const now = new Date(Date.now() - 5_000).toISOString();
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'Depth Slider Test Story',
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            order: 0,
            path: `Manuscript/${STORY_ID}/${CHAPTER_ID}`,
            createdAt: now,
            updatedAt: now,
            scenes: [
              {
                id: SCENE1_ID,
                title: 'Scene One',
                path: `Manuscript/${STORY_ID}/${CHAPTER_ID}/${SCENE1_ID}.md`,
                order: 0,
                draftState: 'in-progress',
                blocks: [],
                createdAt: now,
                updatedAt: now,
              },
              {
                id: SCENE2_ID,
                title: 'Scene Two',
                path: `Manuscript/${STORY_ID}/${CHAPTER_ID}/${SCENE2_ID}.md`,
                order: 1,
                draftState: 'in-progress',
                blocks: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      },
    ],
    scenes: [],
    entities: [],
    suggestions: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('Depth Slider + Scene Navigator (SKY-2441)', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ds-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ds-vault-'));
    seedVault(vaultDir);
    seedUserData(userData, vaultDir);
    app = await launchApp(userData);
    page = await app.firstWindow();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.waitForLoadState('domcontentloaded');
    // Wait for the shell to be ready
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    // Wait for the story to appear in the navigator
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
    // Select Scene One so the depth slider becomes visible
    const scene1Row = page.locator('.nav-scene-row').first();
    await expect(scene1Row).toBeVisible({ timeout: 10_000 });
    await scene1Row.click();
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  // ─── TC-DS-01 ─────────────────────────────────────────────────────────────

  test('TC-DS-01: depth slider bar is visible after selecting a scene', async () => {
    await expect(page.getByTestId('depth-slider')).toBeVisible({ timeout: 6_000 });
  });

  test('TC-DS-01b: context label shows chapter and scene name at depth=scene', async () => {
    await expect(page.locator('.depth-context-label')).toContainText('Scene One', { timeout: 4_000 });
  });

  // ─── TC-DS-02 ─────────────────────────────────────────────────────────────

  test('TC-DS-02: clicking "Chapter" depth button shows chapter doc view', async () => {
    const chapterBtn = page.getByRole('button', { name: /chapter/i }).filter({ hasNot: page.locator('.nav-chapter-toggle') });
    // The depth slider track has a "Chapter" button — find it within the depth slider
    const depthChapterBtn = page.getByTestId('depth-slider').getByRole('button', { name: /^chapter$/i });
    await depthChapterBtn.click();
    await expect(page.locator('.chapter-doc-view')).toBeVisible({ timeout: 4_000 });
  });

  // ─── TC-DS-03 ─────────────────────────────────────────────────────────────

  test('TC-DS-03: clicking "Full Book" depth button shows book outline view', async () => {
    const depthBookBtn = page.getByTestId('depth-slider').getByRole('button', { name: /full book/i });
    await depthBookBtn.click();
    await expect(page.locator('.book-outline-view')).toBeVisible({ timeout: 4_000 });
  });

  // ─── TC-DS-04 ─────────────────────────────────────────────────────────────

  test('TC-DS-04: clicking "Scene" depth button returns to block editor', async () => {
    const depthSceneBtn = page.getByTestId('depth-slider').getByRole('button', { name: /^scene$/i });
    await depthSceneBtn.click();
    await expect(page.locator('.shell-editor-scene-wrap')).toBeVisible({ timeout: 4_000 });
  });

  // ─── TC-DS-07 boundary (before nav tests move us away from Scene One) ─────

  test('TC-DS-07a: Prev button is disabled at the first scene', async () => {
    await expect(page.getByTestId('depth-slider').getByRole('button', { name: /previous/i })).toBeDisabled({ timeout: 4_000 });
  });

  test('TC-DS-07b: Next button is enabled at the first scene', async () => {
    await expect(page.getByTestId('depth-slider').getByRole('button', { name: /next/i })).toBeEnabled({ timeout: 4_000 });
  });

  // ─── TC-DS-05 ─────────────────────────────────────────────────────────────

  test('TC-DS-05: Next button advances to the next sibling scene', async () => {
    await page.getByTestId('depth-slider').getByRole('button', { name: /next/i }).click();
    // Context label must update to Scene Two
    await expect(page.locator('.depth-context-label')).toContainText('Scene Two', { timeout: 4_000 });
    // Block editor is still showing (depth stays at scene)
    await expect(page.locator('.shell-editor-scene-wrap')).toBeVisible({ timeout: 4_000 });
  });

  // ─── TC-DS-07 boundary at Scene Two ──────────────────────────────────────

  test('TC-DS-07c: Next button is disabled at the last scene', async () => {
    await expect(page.getByTestId('depth-slider').getByRole('button', { name: /next/i })).toBeDisabled({ timeout: 4_000 });
  });

  test('TC-DS-07d: Prev button is enabled at the last scene', async () => {
    await expect(page.getByTestId('depth-slider').getByRole('button', { name: /previous/i })).toBeEnabled({ timeout: 4_000 });
  });

  // ─── TC-DS-06 ─────────────────────────────────────────────────────────────

  test('TC-DS-06: Prev button navigates back to the previous scene', async () => {
    await page.getByTestId('depth-slider').getByRole('button', { name: /previous/i }).click();
    await expect(page.locator('.depth-context-label')).toContainText('Scene One', { timeout: 4_000 });
  });
});
