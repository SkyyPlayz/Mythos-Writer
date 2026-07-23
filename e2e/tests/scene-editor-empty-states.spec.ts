/**
 * scene-editor-empty-states.spec.ts — SKY-1996
 *
 * Playwright E2E coverage for the Scene Crafter editor empty states.
 *
 * Acceptance criteria:
 *   AC-ES-01  select-scene state — story with scenes, no scene selected
 *   AC-ES-02  no-scenes-yet state — story with no scenes
 *   AC-ES-03  loading state — covered by SceneEditorEmptyState.test.tsx (unit)
 *             (E2E is impractical: loading state clears within one render frame
 *             once BlockEditor fires onEditorReady; not reliably capturable)
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/scene-editor-empty-states.spec.ts --reporter=list
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

// SKY-8211: [data-testid=scene-editor-empty][data-variant] now only renders
// inside SplitEditorPane (frontend/src/SplitEditorPane.tsx) — the default
// single-pane path (DesktopShell.tsx) collapses both the select-scene and
// no-scenes-yet cases into one generic "Select a scene from the left panel…"
// message with no distinguishing testid, so it can't cover AC-ES-01/02's
// per-variant copy assertions. Drive each test into split-pane mode via the
// `[data-testid="split-toggle-btn"]` toggle instead, which is what actually
// renders SceneEditorEmptyState.

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'Empty State Test Story';
const STORY_ID = 'es-story-0001';
const CHAPTER_ID = 'es-chapter-0001';
const SCENE_ID = 'es-scene-0001';
const SCENE_TITLE = 'Opening Scene';
const CHAPTER_TITLE = 'Chapter One';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedBaseSettings(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

/** Seed a vault with a story that has one chapter and one scene. */
function seedVaultWithScene(vaultDir: string): void {
  const manifestDir = path.join(vaultDir, 'stories');
  fs.mkdirSync(manifestDir, { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    version: 1,
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: `stories/${STORY_ID}`,
        order: 0,
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: CHAPTER_ID,
            title: CHAPTER_TITLE,
            storyId: STORY_ID,
            order: 0,
            createdAt: now,
            updatedAt: now,
            scenes: [
              {
                id: SCENE_ID,
                title: SCENE_TITLE,
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                order: 0,
                draftState: 'in-progress',
                createdAt: now,
                updatedAt: now,
                blocks: [],
              },
            ],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Write the scene file
  const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${SCENE_ID}.md`), '');
}

/** Seed a vault with a story that has no scenes. */
function seedVaultWithNoScenes(vaultDir: string): void {
  const manifestDir = path.join(vaultDir, 'stories');
  fs.mkdirSync(manifestDir, { recursive: true });

  const now = new Date().toISOString();
  const manifest = {
    version: 1,
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: `stories/${STORY_ID}`,
        order: 0,
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: CHAPTER_ID,
            title: CHAPTER_TITLE,
            storyId: STORY_ID,
            order: 0,
            createdAt: now,
            updatedAt: now,
            scenes: [],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

// ─── AC-ES-01: select-scene state ─────────────────────────────────────────────

test.describe('AC-ES-01 select-scene empty state', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-es01-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-es01-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-es01-notes-'));
    seedBaseSettings(userData, vaultDir, notesVaultDir);
    seedVaultWithScene(vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    // Wait for the shell to finish loading (spinner disappears)
    await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });
    // SKY-8211: SceneEditorEmptyState only renders inside SplitEditorPane.
    await page.locator('[data-testid="split-toggle-btn"]').click();
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('AC-ES-01a shows empty state when story has scenes but none is selected', async () => {
    const emptyEl = page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="select-scene"]');
    await expect(emptyEl).toBeVisible({ timeout: 8_000 });
  });

  test('AC-ES-01b select-scene copy matches spec', async () => {
    await expect(
      page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="select-scene"]'),
    ).toContainText('Select a scene from your story to start writing.');
  });

  test('AC-ES-01c document icon is present (SVG)', async () => {
    const svg = page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="select-scene"] svg.se-empty-icon');
    await expect(svg).toBeAttached({ timeout: 5_000 });
  });
});

// ─── AC-ES-02: no-scenes-yet state ────────────────────────────────────────────

test.describe('AC-ES-02 no-scenes-yet empty state', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-es02-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-es02-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-es02-notes-'));
    seedBaseSettings(userData, vaultDir, notesVaultDir);
    seedVaultWithNoScenes(vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });
    // SKY-8211: SceneEditorEmptyState only renders inside SplitEditorPane.
    await page.locator('[data-testid="split-toggle-btn"]').click();
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('AC-ES-02a shows empty state when story exists but has no scenes', async () => {
    const emptyEl = page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="no-scenes-yet"]');
    await expect(emptyEl).toBeVisible({ timeout: 8_000 });
  });

  test('AC-ES-02b no-scenes-yet copy matches spec', async () => {
    await expect(
      page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="no-scenes-yet"]'),
    ).toContainText('Create your first scene to start writing.');
  });

  test('AC-ES-02c copy mentions the + button', async () => {
    await expect(
      page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="no-scenes-yet"]'),
    ).toContainText('+ button in your story outline');
  });

  test('AC-ES-02d document icon is present (SVG)', async () => {
    const svg = page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty"][data-variant="no-scenes-yet"] svg.se-empty-icon');
    await expect(svg).toBeAttached({ timeout: 5_000 });
  });
});

// ─── AC-ES-03: loading state (unit-tested) ───────────────────────────────────
// The loading state (variant="loading") is verified in unit tests:
//   frontend/src/SceneEditorEmptyState.test.tsx
// E2E verification is impractical because the loading state clears in < 1 render
// frame once BlockEditor fires onEditorReady on fast machines; no stable selector
// window exists in the headless runner. Unit tests assert role=status, aria-live,
// spinner presence, and "Loading your scene…" copy.
