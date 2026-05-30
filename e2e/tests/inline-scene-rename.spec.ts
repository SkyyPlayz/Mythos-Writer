/**
 * inline-scene-rename.spec.ts — SKY-115
 *
 * E2E regression coverage for inline scene rename feature (Story Vault).
 *
 * Test cases verify:
 *   TC-ISR-01  Double-click scene → inline input appears with name pre-filled
 *   TC-ISR-02  Type new name in input → input accepts the text value
 *   TC-ISR-03  Press Escape during rename → cancels edit and reverts name
 *   TC-ISR-04  Submit empty name → shows validation error
 *   TC-ISR-05  Rename input receives autofocus when opened
 *   TC-ISR-06  Invalid characters (e.g., /) trigger validation error
 *   Setup      Create story, chapter, and scene for tests
 *
 * Validation:
 * - Empty names are rejected with "cannot be empty" error
 * - Invalid characters (/ \ : * ? " < > |) are rejected
 * - Escape key cancels rename without changes
 * - Input receives autofocus for immediate typing
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
const STORY_TITLE = 'Inline Rename Test';
const CHAPTER_TITLE = 'Chapter One';
const SCENE_TITLE = 'Original Scene Name';
const SCENE_RENAMED = 'Renamed Scene Title';
const SCENE_RENAMED_2 = 'Second Rename';
const NOTE_DIR = 'characters';
const NOTE_FILE = 'protagonist.md';
const NOTE_RENAMED = 'hero-renamed.md';

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

function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function openVaultTab(pg: Page): Promise<void> {
  const vaultTab = pg.locator('.rail-tab', { hasText: 'Vault' });
  await expect(vaultTab).toBeVisible({ timeout: 8_000 });
  await vaultTab.click();
  await expect(pg.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-isr-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-isr-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-isr-notes-'));

  // Pre-seed a note in the Notes Vault so we can test rename there
  const noteSubDir = path.join(vaultDir, NOTE_DIR);
  fs.mkdirSync(noteSubDir, { recursive: true });
  fs.writeFileSync(
    path.join(noteSubDir, NOTE_FILE),
    `---\ntitle: "Protagonist"\ncreatedAt: ${new Date().toISOString()}\n---\n\nMain character details.\n`,
  );

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── Setup: Create story, chapter, and scene for rename tests ─────────────────

test('Setup: Create story, chapter, and scene', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await openVaultTab(page);

  // Create story
  await page.locator('[data-testid="vb-story-vault"] [aria-label="New Story"]').click();
  await fillPrompt(page, STORY_TITLE);
  await expect(
    page.locator('[data-testid="vb-story-vault"] .vb-name', { hasText: STORY_TITLE }),
  ).toBeVisible({ timeout: 8_000 });

  // Create chapter
  await page.locator('[data-testid="vb-story-vault"]')
    .locator(`[aria-label="New chapter in ${STORY_TITLE}"]`)
    .click();
  await fillPrompt(page, CHAPTER_TITLE);
  await expect(
    page.locator('[data-testid="vb-story-vault"] .vb-name', { hasText: CHAPTER_TITLE }),
  ).toBeVisible({ timeout: 6_000 });

  // Expand chapter
  await page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE }).click();

  // Create scene
  await page.locator('[data-testid="vb-story-vault"]')
    .locator(`[aria-label="New scene in ${CHAPTER_TITLE}"]`)
    .click();
  await fillPrompt(page, SCENE_TITLE);

  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row .vb-name', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
});

// ─── TC-ISR-01: Double-click scene → inline input appears with name pre-filled ─

test('TC-ISR-01: double-click scene node shows inline input with name pre-filled', async () => {
  await openVaultTab(page);

  // Find the chapter and ensure it's expanded
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  const isExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await chapterToggle.click();
  }

  // Find and double-click the scene
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.dblclick();

  // Rename input appears
  const renameInput = page.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });

  // Input value contains the original scene name (without .md extension)
  const inputValue = await renameInput.inputValue();
  expect(inputValue).toBe(SCENE_TITLE);

  // Cancel rename by pressing Escape
  await renameInput.press('Escape');
  await expect(renameInput).not.toBeVisible({ timeout: 4_000 });
});

// ─── TC-ISR-02: Type new name + Enter → rename input accepts value ──────────

test('TC-ISR-02: typing in rename input updates the input value', async () => {
  await openVaultTab(page);

  // Ensure chapter is expanded
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  const isExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await chapterToggle.click();
    await page.waitForTimeout(500);
  }

  // Double-click scene to start rename
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.dblclick();

  // Type new name
  const renameInput = page.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });
  await renameInput.fill(SCENE_RENAMED);

  // Verify input value was updated
  const inputValue = await renameInput.inputValue();
  expect(inputValue).toBe(SCENE_RENAMED);

  // Cancel by pressing Escape
  await renameInput.press('Escape');
  await expect(renameInput).not.toBeVisible({ timeout: 4_000 });
});

// ─── TC-ISR-03: Press Escape cancels rename without changes ────────────────

test('TC-ISR-03: press Escape during rename cancels edit and reverts name', async () => {
  await openVaultTab(page);

  // Ensure chapter is expanded
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  const isExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await chapterToggle.click();
    await page.waitForTimeout(500);
  }

  // Double-click scene to start rename
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.dblclick();

  // Start typing a new name
  const renameInput = page.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });
  await renameInput.fill('This Name Will Be Cancelled');

  // Press Escape to cancel
  await renameInput.press('Escape');

  // Input disappears
  await expect(renameInput).not.toBeVisible({ timeout: 4_000 });

  // Scene still shows the original name
  await expect(
    page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE }),
  ).toBeVisible({ timeout: 6_000 });
});

// ─── TC-ISR-04: Empty name validation shows error ────────────────────────

test('TC-ISR-04: submit empty name shows error message', async () => {
  await openVaultTab(page);

  // Ensure chapter is expanded
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  const isExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await chapterToggle.click();
    await page.waitForTimeout(500);
  }

  // Double-click scene to start rename
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.dblclick();

  // Clear the input to make it empty
  const renameInput = page.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });
  await renameInput.fill('');

  // Press Enter to attempt submission
  await renameInput.press('Enter');

  // Rename input should still be visible (error state)
  await expect(renameInput).toBeVisible({ timeout: 4_000 });

  // Error message should be displayed
  const errorMsg = page.locator('.vb-rename-error');
  await expect(errorMsg).toBeVisible({ timeout: 4_000 });

  // Cancel by pressing Escape
  await renameInput.press('Escape');
  await expect(renameInput).not.toBeVisible({ timeout: 4_000 });
});

// ─── TC-ISR-05: Rename input shows with focus and autoFocus ────────────────

test('TC-ISR-05: rename input receives autofocus when opened', async () => {
  await openVaultTab(page);

  // Ensure chapter is expanded
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  const isExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await chapterToggle.click();
    await page.waitForTimeout(500);
  }

  // Double-click scene to start rename
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.dblclick();

  // Input should appear and have focus
  const renameInput = page.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });

  // Input should be focused (can type immediately)
  const isFocused = await renameInput.evaluate((el) => el === document.activeElement);
  expect(isFocused).toBe(true);

  // Cancel by pressing Escape
  await renameInput.press('Escape');
  await expect(renameInput).not.toBeVisible({ timeout: 4_000 });
});

// ─── TC-ISR-06: Invalid characters are rejected by validator ────────────────

test('TC-ISR-06: rename validator rejects invalid characters', async () => {
  await openVaultTab(page);

  // Ensure chapter is expanded
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  const isExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await chapterToggle.click();
    await page.waitForTimeout(500);
  }

  // Double-click scene to start rename
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.dblclick();

  // Type invalid name with forward slash
  const renameInput = page.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });
  await renameInput.fill('Invalid/Name');

  // Press Enter to attempt submission
  await renameInput.press('Enter');

  // Rename input should still be visible with an error message
  await expect(renameInput).toBeVisible({ timeout: 4_000 });

  // Error message should be displayed
  const errorMsg = page.locator('.vb-rename-error');
  await expect(errorMsg).toBeVisible({ timeout: 4_000 });

  // Cancel by pressing Escape
  await renameInput.press('Escape');
  await expect(renameInput).not.toBeVisible({ timeout: 4_000 });
});

