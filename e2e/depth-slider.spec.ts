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

  // ─── SKY-5904 ─────────────────────────────────────────────────────────────
  // On-canvas edge arrows (DepthEdgeArrows/.edge-arrow) must anchor to the
  // 720px page column, not the full-width canvas behind it — else on a wide
  // window they float far from the actual page edge they're meant to hug.

  test('SKY-5904: on-canvas edge arrows hug the page column, not the outer canvas edges', async () => {
    const originalSize = page.viewportSize();
    // Very wide viewport: the right sidebar and navigator both eat into a
    // 1440px window, leaving little slack between the page column and the
    // canvas behind it. Go wide enough that a page column stuck at ~720px
    // is unambiguously narrower than the canvas even with sidebars open.
    await page.setViewportSize({ width: 2400, height: 1000 });
    try {
      const prevArrow = page.getByTestId('edge-arrow-prev');
      const nextArrow = page.getByTestId('edge-arrow-next');
      await expect(prevArrow).toBeVisible();
      await expect(nextArrow).toBeVisible();

      const pageBox = await page.locator('.shell-editor-beta-wrap--page-mode').boundingBox();
      const canvasBox = await page.locator('.shell-editor-scene-wrap.story-page-canvas').boundingBox();
      const prevBox = await prevArrow.boundingBox();
      const nextBox = await nextArrow.boundingBox();
      if (!pageBox || !canvasBox || !prevBox || !nextBox) {
        throw new Error('Expected page column, canvas, and edge-arrow boxes to be measurable');
      }
      // Sanity check the viewport is actually wide enough to stress the bug.
      expect(canvasBox.width).toBeGreaterThan(pageBox.width + 200);

      // The arrows must hug the page column's edges, not the far edges of
      // the full-width canvas behind it.
      expect(Math.abs(prevBox.x - pageBox.x)).toBeLessThan(20);
      expect(Math.abs(nextBox.x + nextBox.width - (pageBox.x + pageBox.width))).toBeLessThan(20);
    } finally {
      if (originalSize) await page.setViewportSize(originalSize);
    }
  });

  // ─── TC-DS-02 ─────────────────────────────────────────────────────────────

  test('TC-DS-02: clicking "Chapter" depth button shows chapter doc view', async () => {
    const chapterBtn = page.getByRole('button', { name: /chapter/i }).filter({ hasNot: page.locator('.nav-chapter-toggle') });
    // The depth slider track has a "Chapter" button — find it within the depth slider
    const depthChapterBtn = page.getByTestId('depth-slider').getByRole('button', { name: /^chapter$/i });
    await depthChapterBtn.click();
    // SKY-3211: ChapterDocView was replaced with ChapterContinuousView (per-scene editable bands)
    await expect(page.locator('.chapter-continuous-view')).toBeVisible({ timeout: 4_000 });
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

// ─── Cross-chapter navigation (SKY-5156 / GH #631) ──────────────────────────
//
//   TC-DS-XC-01  Next at last scene of a chapter enters the next chapter
//   TC-DS-XC-02  Prev at first scene of a chapter returns to the previous chapter
//   TC-DS-XC-03  Prev disabled at the very first scene of the story
//   TC-DS-XC-04  Next disabled at the very last scene of the story
//
// Regression guard for the depth→editor wiring: at scene depth the header
// arrows step across chapter boundaries (bounded at the story's first/last
// scene), not just within the current chapter.

const XC_STORY_ID = 'xc-story-01';
const XC_CH1_ID = 'xc-ch-01';
const XC_CH2_ID = 'xc-ch-02';
const XC_SCENE_A = 'xc-sc-a';
const XC_SCENE_B = 'xc-sc-b';
const XC_SCENE_C = 'xc-sc-c';

function seedCrossChapterVault(vaultDir: string): void {
  const ch1Dir = path.join(vaultDir, 'Manuscript', XC_STORY_ID, XC_CH1_ID);
  const ch2Dir = path.join(vaultDir, 'Manuscript', XC_STORY_ID, XC_CH2_ID);
  fs.mkdirSync(ch1Dir, { recursive: true });
  fs.mkdirSync(ch2Dir, { recursive: true });

  fs.writeFileSync(path.join(ch1Dir, `${XC_SCENE_A}.md`), makeSceneContent(XC_SCENE_A, 'Scene A', 0));
  fs.writeFileSync(path.join(ch1Dir, `${XC_SCENE_B}.md`), makeSceneContent(XC_SCENE_B, 'Scene B', 1));
  fs.writeFileSync(path.join(ch2Dir, `${XC_SCENE_C}.md`), makeSceneContent(XC_SCENE_C, 'Scene C', 0));

  const now = new Date(Date.now() - 5_000).toISOString();
  const scene = (id: string, title: string, chId: string, order: number) => ({
    id,
    title,
    path: `Manuscript/${XC_STORY_ID}/${chId}/${id}.md`,
    order,
    draftState: 'in-progress',
    blocks: [],
    createdAt: now,
    updatedAt: now,
  });
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: XC_STORY_ID,
        title: 'Cross Chapter Story',
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: XC_CH1_ID,
            title: 'Chapter One',
            order: 0,
            path: `Manuscript/${XC_STORY_ID}/${XC_CH1_ID}`,
            createdAt: now,
            updatedAt: now,
            scenes: [scene(XC_SCENE_A, 'Scene A', XC_CH1_ID, 0), scene(XC_SCENE_B, 'Scene B', XC_CH1_ID, 1)],
          },
          {
            id: XC_CH2_ID,
            title: 'Chapter Two',
            order: 1,
            path: `Manuscript/${XC_STORY_ID}/${XC_CH2_ID}`,
            createdAt: now,
            updatedAt: now,
            scenes: [scene(XC_SCENE_C, 'Scene C', XC_CH2_ID, 0)],
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

test.describe('Depth Slider — cross-chapter navigation (SKY-5156)', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  const depthSlider = () => page.getByTestId('depth-slider');
  const nextBtn = () => depthSlider().getByRole('button', { name: /next/i });
  const prevBtn = () => depthSlider().getByRole('button', { name: /previous/i });
  const contextLabel = () => page.locator('.depth-context-label');

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-xc-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-xc-vault-'));
    seedCrossChapterVault(vaultDir);
    seedUserData(userData, vaultDir);
    app = await launchApp(userData);
    page = await app.firstWindow();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
    // Select Scene A (first scene of the story)
    const sceneA = page.locator('.nav-scene-row').first();
    await expect(sceneA).toBeVisible({ timeout: 10_000 });
    await sceneA.click();
    await expect(depthSlider()).toBeVisible({ timeout: 6_000 });
    await expect(contextLabel()).toContainText('Scene A', { timeout: 4_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('TC-DS-XC-03: Prev disabled at the very first scene of the story', async () => {
    await expect(prevBtn()).toBeDisabled({ timeout: 4_000 });
    await expect(nextBtn()).toBeEnabled({ timeout: 4_000 });
  });

  test('TC-DS-XC-01: Next at the last scene of a chapter enters the next chapter', async () => {
    // Scene A → Scene B (within Chapter One)
    await nextBtn().click();
    await expect(contextLabel()).toContainText('Scene B', { timeout: 4_000 });
    // Scene B is the last scene of Chapter One → Next crosses into Chapter Two
    await nextBtn().click();
    await expect(contextLabel()).toContainText('Chapter Two', { timeout: 4_000 });
    await expect(contextLabel()).toContainText('Scene C', { timeout: 4_000 });
    // Still rendering the scene editor, not a chapter/book view
    await expect(page.locator('.shell-editor-scene-wrap')).toBeVisible({ timeout: 4_000 });
  });

  test('TC-DS-XC-04: Next disabled at the very last scene of the story', async () => {
    await expect(nextBtn()).toBeDisabled({ timeout: 4_000 });
    await expect(prevBtn()).toBeEnabled({ timeout: 4_000 });
  });

  test('TC-DS-XC-02: Prev at the first scene of a chapter returns to the previous chapter', async () => {
    // From Scene C (first + only scene of Chapter Two) → back into Chapter One's Scene B
    await prevBtn().click();
    await expect(contextLabel()).toContainText('Scene B', { timeout: 4_000 });
    await expect(page.locator('.shell-editor-scene-wrap')).toBeVisible({ timeout: 4_000 });
  });
});
