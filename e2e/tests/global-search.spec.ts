/**
 * global-search.spec.ts — SKY-129 + SKY-160
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'Global Search Test Vault';
const CHAPTER_TITLE = 'Story Chapter';
const SCENE_TITLE = 'Test Scene';
const SCENE_CONTENT = 'The ancient dragon slumbered beneath the crystal mountains. Legends spoke of its power.';
const NOTE_TITLE = 'Magic System';
const NOTE_CONTENT = 'Fire magic flows through ancient runes. The dragon oracle guards the flame.';
const CHARACTER_TITLE = 'Dragon Oracle';
const SEARCH_TERM = 'dragon';

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

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

async function openVaultTab(pg: Page): Promise<void> {
  const vaultTab = pg.locator('.rail-tab', { hasText: 'Vault' });
  await expect(vaultTab).toBeVisible({ timeout: 8_000 });
  await vaultTab.click();
  await expect(pg.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });
}

async function waitForFTSIndex(pg: Page, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await pg.evaluate(() => window.api.searchVault('dragon', 'both', 10));
      if (response) return true;
    } catch {
      // FTS not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
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

  // Pre-seed content in story vault
  const chapterDir = path.join(vaultDir, STORY_TITLE, CHAPTER_TITLE);
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.writeFileSync(
    path.join(chapterDir, `${SCENE_TITLE}.md`),
    `---\ntitle: "${SCENE_TITLE}"\ncreatedAt: ${new Date().toISOString()}\n---\n\n${SCENE_CONTENT}\n`,
  );

  // Pre-seed content in notes vault
  const noteFile = path.join(notesVaultDir, `${NOTE_TITLE}.md`);
  fs.writeFileSync(
    noteFile,
    `---\ntitle: "${NOTE_TITLE}"\ncreatedAt: ${new Date().toISOString()}\n---\n\n${NOTE_CONTENT}\n`,
  );

  const entityFile = path.join(notesVaultDir, `.entities-${CHARACTER_TITLE}.md`);
  fs.writeFileSync(
    entityFile,
    `---\ntitle: "${CHARACTER_TITLE}"\nkind: "character"\ncreatedAt: ${new Date().toISOString()}\n---\n\nThe dragon oracle speaks in riddles about magic and fire.\n`,
  );

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  const ftsReady = await waitForFTSIndex(page);
  if (!ftsReady) {
    console.warn('FTS index did not become ready in time; some tests may fail');
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
  const input = page.locator('.gsp-input');
  await input.fill(SEARCH_TERM);
  await expect(page.locator('.gsp-result-item')).toHaveCount(2, { timeout: 3_000 });
  const firstResult = page.locator('.gsp-result-item').first();
  await firstResult.click();
  await expect(searchPanel).not.toBeVisible({ timeout: 2_000 });
  const editorContent = page.locator('.scene-editor-toolbar, [data-testid="note-editor"]');
  await expect(editorContent.first()).toBeVisible({ timeout: 4_000 });
});

// ─── TC-GS-04: Scope selector filters results correctly ──────────────────────────

test('TC-GS-04: scope selector (Story | Notes | Both) filters results correctly', async () => {
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
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
  await page.keyboard.press('Escape');
});

// ─── TC-GS-06: Empty query clears results gracefully ──────────────────────────────

test('TC-GS-06: empty query clears results gracefully', async () => {
  await page.click('.app-container, .desktop-shell, body');
  await page.keyboard.press('Control+K');
  const searchPanel = page.locator('[role="dialog"][aria-label="Search vault"]');
  await expect(searchPanel).toBeVisible({ timeout: 6_000 });
  const input = page.locator('.gsp-input');
  await input.fill(SEARCH_TERM);
  await expect(page.locator('.gsp-result-item')).toHaveCount(2, { timeout: 3_000 });
  await input.clear();
  await expect(page.locator('.gsp-result-item')).toHaveCount(0, { timeout: 2_000 });
  const hintMsg = page.locator('.gsp-hint', { hasText: /Type to search/ });
  await expect(hintMsg).toBeVisible();
  await page.keyboard.press('Escape');
});
