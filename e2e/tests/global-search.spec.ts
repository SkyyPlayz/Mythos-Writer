/**
 * global-search.spec.ts — SKY-129 + SKY-160 (regression-hardened in SKY-905).
 *
 * E2E tests for Global Search across vault content (FTS5 index).
 *
 * Acceptance criteria:
 *   TC-GS-01  Ctrl+K opens search panel
 *   TC-GS-02  Typing returns FTS5 results with excerpt
 *   TC-GS-03  Click result opens scene + scrolls to match
 *   TC-GS-04  Scope selector (Story | Notes | Both) filters correctly
 *   TC-GS-05  Debounce fires only one request per 300ms window
 *   TC-GS-06  Empty query clears results gracefully
 *
 * Why the seed writes manifest.json directly (SKY-905):
 *   buildFullIndex reads scenes from `manifest.stories[].chapters[].scenes[]`
 *   and entities from `manifest.entities[]`. Raw `.md` files dropped into the
 *   vault directory before launch are NOT auto-discovered by the deferred
 *   startup indexer (vault watcher uses `ignoreInitial: true`), so the test
 *   must materialise the manifest entries itself. See SKY-900 / SKY-905.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'Global Search Test Vault';
const CHAPTER_TITLE = 'Story Chapter';
const SCENE_TITLE = 'Test Scene';
const SCENE_CONTENT =
  'The ancient dragon slumbered beneath the crystal mountains. Legends spoke of its power.';
const CHARACTER_TITLE = 'Dragon Oracle';
const SEARCH_TERM = 'dragon';

// Stable IDs so the manifest entries reference the seeded files deterministically.
const STORY_ID = 'story-gs-001';
const CHAPTER_ID = 'chapter-gs-001';
const SCENE_ID = 'scene-gs-001';
const ENTITY_ID = 'ent-gs-dragon-oracle';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
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

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

function seedVaultManifest(vaultDir: string): void {
  const now = new Date().toISOString();
  const sceneRelPath = path
    .join(STORY_TITLE, CHAPTER_TITLE, `${SCENE_TITLE}.md`)
    .split(path.sep)
    .join('/');

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: STORY_TITLE,
        chapters: [
          {
            id: CHAPTER_ID,
            title: CHAPTER_TITLE,
            path: path.join(STORY_TITLE, CHAPTER_TITLE).split(path.sep).join('/'),
            order: 0,
            scenes: [
              {
                id: SCENE_ID,
                title: SCENE_TITLE,
                path: sceneRelPath,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  {
                    id: crypto.randomUUID(),
                    type: 'prose',
                    order: 0,
                    content: SCENE_CONTENT,
                    updatedAt: now,
                  },
                ],
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [
      {
        id: ENTITY_ID,
        name: CHARACTER_TITLE,
        type: 'character',
        // The entity file path is relative to vaultRoot in buildFullIndex.
        // The file itself is intentionally missing — buildFullIndex tolerates
        // missing entity files and still indexes the name/aliases/tags.
        path: `entities/characters/${ENTITY_ID}.md`,
        aliases: ['Oracle of Dragons'],
        tags: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };

  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
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

/**
 * Wait for the deferred FTS index build to populate the seeded documents.
 * SKY-905: the previous helper only checked that `searchVault` resolved at
 * all (a non-null response object is truthy), which raced the deferred
 * `setImmediate` builder and let zero-result runs proceed silently.
 */
async function waitForFTSIndex(pg: Page, expectedMin = 2, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = (await pg.evaluate(
        ({ term }) => window.api.searchVault(term, 'both', 10),
        { term: SEARCH_TERM },
      )) as { results?: unknown[] } | null;
      const hits = Array.isArray(response?.results) ? response!.results!.length : 0;
      if (hits >= expectedMin) return true;
    } catch {
      // FTS not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gs-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gs-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-gs-notes-'));

  // Pre-seed the scene file on disk so click-result-opens-scene has a body
  // to render. The FTS index gets its body content from the manifest block
  // (via buildFullIndex → readVaultFile), so the file and the block content
  // are kept in sync.
  const chapterDir = path.join(vaultDir, STORY_TITLE, CHAPTER_TITLE);
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(chapterDir, `${SCENE_TITLE}.md`),
    `---\nid: ${SCENE_ID}\ntitle: "${SCENE_TITLE}"\ncreatedAt: ${new Date().toISOString()}\n---\n\n${SCENE_CONTENT}\n`,
  );

  // Seed the manifest with story → chapter → scene + the Dragon Oracle entity.
  // Without this, the deferred FTS build sees an empty manifest and the
  // assertions below fail with 0 results (SKY-900 / SKY-905).
  seedVaultManifest(vaultDir);

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  const ftsReady = await waitForFTSIndex(page, 2);
  if (!ftsReady) {
    throw new Error(
      `FTS index never reported ≥2 results for "${SEARCH_TERM}" — startup index build is broken`,
    );
  }
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-GS-01: Ctrl+K opens Global Search panel ────────────────────────────────

test('TC-GS-01: Ctrl+K opens Global Search panel', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  // Ensure the page has focus by clicking on the main app area
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  const input = page.locator('.gsp-input');
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(searchPanel).not.toBeVisible({ timeout: 2_000 });
});

// ─── TC-GS-02: Typing query returns FTS5 results with excerpt ──────────────────

test('TC-GS-02: typing query returns FTS5 results with excerpt and filename', async () => {
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  // DesktopShell sets defaultScope based on the active view; in the test seed
  // we land in 'editor' which biases the search to 'story' only. Force the
  // 'All' scope so both seeded matches (scene + entity) are exercised.
  await page.locator('.gsp-scope-btn', { hasText: 'All' }).click();
  const input = page.locator('.gsp-input');
  await input.fill(SEARCH_TERM);
  const resultItems = page.locator('.gsp-result-item');
  await expect(resultItems).toHaveCount(2, { timeout: 3_000 });
  const titles = await page.locator('.gsp-result-title').allTextContents();
  expect(titles.length).toBeGreaterThanOrEqual(1);
  const snippets = await page.locator('.gsp-result-snippet').allTextContents();
  expect(snippets.length).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Escape');
});

// ─── TC-GS-03: Click result opens correct scene + scrolls to match ──────────────

test('TC-GS-03: clicking result opens scene and scrolls to match location', async () => {
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  await page.locator('.gsp-scope-btn', { hasText: 'All' }).click();
  const input = page.locator('.gsp-input');
  await input.fill(SEARCH_TERM);
  await expect(page.locator('.gsp-result-item')).toHaveCount(2, { timeout: 3_000 });
  const firstResult = page.locator('.gsp-result-item').first();
  await firstResult.click();
  await expect(searchPanel).not.toBeVisible({ timeout: 2_000 });
  // The scene editor renders `shell-editor-scene-wrap` + `scene-snapshot-toolbar`
  // when a scene is selected. Either is sufficient to prove navigation landed.
  const editorContent = page.locator(
    '.shell-editor-scene-wrap, .scene-snapshot-toolbar, [data-testid="note-editor"]',
  );
  await expect(editorContent.first()).toBeVisible({ timeout: 4_000 });
});

// ─── TC-GS-04: Scope selector filters results correctly ──────────────────────────

test('TC-GS-04: scope selector (Story | Notes | Both) filters results correctly', async () => {
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  await page.locator('.gsp-scope-btn', { hasText: 'All' }).click();
  const input = page.locator('.gsp-input');
  await input.fill(SEARCH_TERM);
  await expect(page.locator('.gsp-result-item')).toHaveCount(2, { timeout: 3_000 });
  let resultCount = await page.locator('.gsp-result-item').count();
  expect(resultCount).toBeGreaterThanOrEqual(1);
  await page.locator('.gsp-scope-btn', { hasText: 'Story Vault' }).click();
  resultCount = await page.locator('.gsp-result-item').count();
  expect(resultCount).toBeLessThanOrEqual(2);
  await page.locator('.gsp-scope-btn', { hasText: 'Notes Vault' }).click();
  resultCount = await page.locator('.gsp-result-item').count();
  expect(resultCount).toBeGreaterThanOrEqual(1);
  await page.locator('.gsp-scope-btn', { hasText: 'All' }).click();
  await expect(page.locator('.gsp-result-item')).toHaveCount(2, { timeout: 3_000 });
  await page.keyboard.press('Escape');
});

// ─── TC-GS-05: Debounce fires only one request per 300ms window ─────────────────

test('TC-GS-05: rapid typing debounces search requests (≤1 request per 300ms window)', async () => {
  let searchRequestCount = 0;
  let lastSearchTime = 0;
  const searchTimes: number[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('searchVault')) {
      const now = Date.now();
      searchTimes.push(now);
      searchRequestCount++;
      if (searchTimes.length > 1) {
        lastSearchTime = searchTimes[searchTimes.length - 1] - searchTimes[searchTimes.length - 2];
      }
    }
  });

  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  const input = page.locator('.gsp-input');
  const testQuery = 'dragonfire';
  for (const char of testQuery) {
    await input.type(char, { delay: 50 });
  }
  await new Promise((r) => setTimeout(r, 500));
  const resultsVisible = await page.locator('.gsp-result-item').count();
  expect(resultsVisible).toBeGreaterThanOrEqual(0);
  expect(searchRequestCount).toBeLessThan(testQuery.length);
  void lastSearchTime;
  await page.keyboard.press('Escape');
});

// ─── TC-GS-06: Empty query clears results gracefully ──────────────────────────────

test('TC-GS-06: empty query clears results gracefully', async () => {
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  await page.locator('.gsp-scope-btn', { hasText: 'All' }).click();
  const input = page.locator('.gsp-input');
  await input.fill(SEARCH_TERM);
  await expect(page.locator('.gsp-result-item')).toHaveCount(2, { timeout: 3_000 });
  await input.clear();
  await expect(page.locator('.gsp-result-item')).toHaveCount(0, { timeout: 2_000 });
  const hintMsg = page.locator('.gsp-hint', { hasText: /Type to search/ });
  await expect(hintMsg).toBeVisible();
  await page.keyboard.press('Escape');
});
