/**
 * entity-system.spec.ts — SKY-220
 *
 * Entity system E2E happy path: create entity, add alias, reference in prose, browse.
 *
 * Acceptance criteria:
 *   TC-E-01  Create entity           — character created via Entity Browser CreateDialog (SKY-619)
 *   TC-E-02  Add alias via detail     — alias field updated and saved in entity detail
 *   TC-E-03  Reference in prose       — entity can be referenced via [[name]] in prose editor
 *   TC-E-04  Persistence              — entity + alias survives app restart
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium   # first time only
 *   npx playwright test e2e/entity-system.spec.ts --reporter=list
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
// SKY-619 replaced TypePickerPopover with CreateDialog; TC-E-01 enters this name
// in the dialog. Kept short to avoid collisions with other test entities.
const ENTITY_NAME = 'New Character';
const ENTITY_ALIAS = 'The Silver Lady';
const SCENE_TITLE = 'First Meeting';
const STORY_TITLE = 'Test Story';
const CHAPTER_TITLE = 'Test Chapter';
const MENTION_PROSE = 'She walked into the hall.';

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

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entity-e2e-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entity-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-entity-notes-'));
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

// ─── TC-E-01: Create entity via Entity Browser ────────────────────────────────

test('TC-E-01: create entity (character) via Entity Browser', async () => {
  // Wait for app to fully load
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate to Entities tab
  const entitiesTab = page.locator('.rail-tab', { hasText: 'Entities' });
  await entitiesTab.click();
  await expect(page.locator('.entity-browser')).toBeVisible({ timeout: 6_000 });

  // Click "+ New Entity" — SKY-619: opens CreateDialog (role="dialog")
  await page.locator('.entity-btn.entity-btn-primary.entity-btn-sm').click();

  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Enter name and submit (type defaults to "character")
  await dialog.locator('.entity-dialog-input').first().fill(ENTITY_NAME);
  await dialog.locator('.entity-btn.entity-btn-primary').click();

  // Dialog closes and entity appears in the list
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });
  const entityItem = page.locator('.entity-item-name', { hasText: ENTITY_NAME });
  await expect(entityItem).toBeVisible({ timeout: 8_000 });
});

// ─── TC-E-02: Add alias via EntityDetail panel ────────────────────────────────

test('TC-E-02: add alias to entity via EntityDetail panel', async () => {
  // Click on entity to open detail panel
  const entityItem = page.locator('.entity-item-name', { hasText: ENTITY_NAME });
  await entityItem.click();

  // Wait for detail panel
  const detailPanel = page.locator('.entity-detail');
  await expect(detailPanel).toBeVisible({ timeout: 8_000 });

  // Fill alias input (second input field after name)
  const aliasInput = detailPanel.locator('.entity-det-input').nth(1);
  await aliasInput.fill(ENTITY_ALIAS);

  // Click Save
  const saveBtn = detailPanel.locator('.entity-det-btn.entity-det-btn-primary');
  await saveBtn.click();

  // Wait for save to complete
  await expect(saveBtn).not.toBeVisible({ timeout: 6_000 });

  // Verify alias is saved by reopening detail
  await entityItem.click();
  await expect(detailPanel).toBeVisible({ timeout: 6_000 });
  await expect(aliasInput).toHaveValue(ENTITY_ALIAS, { timeout: 4_000 });
});

// ─── TC-E-03: Reference entity in prose editor via wiki-link ──────────────────

test('TC-E-03: reference entity in prose editor via wiki-link syntax', async () => {
  // Create a story/chapter/scene to get a prose editor
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  await storiesTab.click();

  // Create story
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);

  // Create chapter
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 6_000 });
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);

  // Create scene
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);

  // Open scene
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.click();

  // Type prose and add wiki-link reference
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await editor.click();
  await editor.type(MENTION_PROSE);

  // Add wiki-link reference to entity using [[Entity Name]] syntax
  await editor.type(` [[${ENTITY_NAME}]]`);

  // Verify the text with wiki-link was entered
  await expect(editor).toContainText(`[[${ENTITY_NAME}]]`, { timeout: 4_000 });
});

// ─── TC-E-04: Entity with alias persists after app restart ────────────────────

test('TC-E-04: entity with alias persists after full app restart', async () => {
  // Close the app
  await app.close().catch(() => {});

  // Relaunch with same userData (vault-settings.json points at same vaults)
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Wait for app to fully load
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate to Entities tab
  const entitiesTab = page.locator('.rail-tab', { hasText: 'Entities' });
  await entitiesTab.click();
  await expect(page.locator('.entity-browser')).toBeVisible({ timeout: 6_000 });

  // Entity should still exist after reload
  const entityItem = page.locator('.entity-item-name', { hasText: ENTITY_NAME });
  await expect(entityItem).toBeVisible({ timeout: 8_000 });

  // Open entity detail to verify alias persisted
  await entityItem.click();
  const detailPanel = page.locator('.entity-detail');
  await expect(detailPanel).toBeVisible({ timeout: 8_000 });

  const aliasInput = detailPanel.locator('.entity-det-input').nth(1);
  await expect(aliasInput).toHaveValue(ENTITY_ALIAS, { timeout: 4_000 });
});
