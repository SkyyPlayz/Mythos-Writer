/**
 * draft-history.spec.ts — SKY-2212
 *
 * E2E coverage for the draft version history feature:
 *   AC-DH-1  Snapshot on save        — saving creates a history entry in the panel
 *   AC-DH-2  History panel opens     — history button reveals the panel
 *   AC-DH-3  Snapshot preview        — selecting an entry shows its content
 *   AC-DH-4  One-click rollback      — Restore replaces editor content
 *   AC-DH-5  Pre-restore backup      — restore creates a new snapshot first
 *   AC-DH-6  Newest-first order      — list is sorted newest → oldest
 *   AC-DH-7  Accessible restore btn  — restore button has a descriptive aria-label
 *
 * Run:
 *   npx playwright test e2e/draft-history.spec.ts --reporter=list
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
const STORY_TITLE = 'History Test Story';
const CHAPTER_TITLE = 'History Chapter';
const SCENE_TITLE = 'History Scene';
const PROSE_V1 = 'The first draft of this scene was written at dawn.';
const PROSE_V2 = 'The second draft changed everything under a noon sun.';

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
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
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

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

// ─── Suite state ──────────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-draft-history-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-draft-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-draft-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Ensure stories panel is visible
  const storiesPanel = page.locator('[data-panel-id="stories"]');
  if (await storiesPanel.isVisible().catch(() => false)) {
    const isCollapsed = await storiesPanel
      .evaluate((el) => el.classList.contains('lr-panel--collapsed'))
      .catch(() => false);
    if (isCollapsed) await storiesPanel.locator('.lr-panel-collapse-btn').click();
  }

  // Create story
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Create chapter
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  // Create scene
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await expect(sceneRow).toContainText(SCENE_TITLE);

  // Wait for editor to be ready
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── AC-DH-1: Snapshot on save triggers a history entry ───────────────────────

test('AC-DH-1: saving creates a snapshot — history panel shows at least one entry', async () => {
  // Select scene and type prose
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await editor.click();
  await page.keyboard.type(PROSE_V1);
  await expect(editor).toContainText(PROSE_V1);

  // Trigger a manual snapshot (populated into the SQLite drafts store by handleManualSnapshot)
  await page.locator('.scene-snapshot-save').click();
  await expect(page.locator('.scene-autosave')).toContainText('Snapshot saved', { timeout: 5_000 });

  // Open history panel
  await page.locator('.btn-history').click();
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel).toBeVisible({ timeout: 6_000 });

  // At least one snapshot entry should appear
  const items = panel.locator('.history-item');
  await items.first().waitFor({ state: 'visible', timeout: 5_000 });
  expect(await items.count()).toBeGreaterThanOrEqual(1);

  // Close panel for subsequent tests
  await panel.locator('[aria-label="Close draft history"]').click();
  await expect(panel).not.toBeVisible({ timeout: 3_000 });
});

// ─── AC-DH-2: History button opens the panel ──────────────────────────────────

test('AC-DH-2: clicking history button reveals the Draft History panel', async () => {
  // Panel should not be visible at start
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel, 'panel should not be visible before button click').not.toBeVisible();

  await page.locator('.btn-history').click();
  await expect(panel).toBeVisible({ timeout: 4_000 });

  await panel.locator('[aria-label="Close draft history"]').click();
  await expect(panel).not.toBeVisible({ timeout: 3_000 });
});

// ─── AC-DH-3: Selecting a snapshot shows its content ──────────────────────────

test('AC-DH-3: selecting a snapshot entry shows a content preview', async () => {
  // Add a second snapshot with different content
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.selectAll();
  await page.keyboard.type(PROSE_V2);
  await expect(editor).toContainText(PROSE_V2);

  await page.locator('.scene-snapshot-save').click();
  await expect(page.locator('.scene-autosave')).toContainText('Snapshot saved', { timeout: 5_000 });

  // Open history
  await page.locator('.btn-history').click();
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel).toBeVisible({ timeout: 4_000 });

  // Select the first (most recent) item
  const firstItem = panel.locator('.history-item-btn').first();
  await firstItem.click();

  // A content preview should now be visible
  const preview = panel.locator('.history-content-view');
  await expect(preview).toBeVisible({ timeout: 5_000 });
  // Preview text should be non-empty
  const previewText = await preview.innerText();
  expect(previewText.trim().length).toBeGreaterThan(0);

  await panel.locator('[aria-label="Close draft history"]').click();
  await expect(panel).not.toBeVisible({ timeout: 3_000 });
});

// ─── AC-DH-4: Restore replaces editor content ─────────────────────────────────

test('AC-DH-4: clicking Restore (with confirm) replaces editor content with snapshot', async () => {
  // Ensure V1 prose is saved as a distinct snapshot
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.selectAll();
  await page.keyboard.type(PROSE_V1);
  await page.locator('.scene-snapshot-save').click();
  await expect(page.locator('.scene-autosave')).toContainText('Snapshot saved', { timeout: 5_000 });

  // Now change editor to V2
  await editor.click();
  await page.keyboard.selectAll();
  await page.keyboard.type(PROSE_V2);
  await expect(editor).toContainText(PROSE_V2);
  // Do NOT save V2 — we want current content to differ from the saved snapshot

  // Open history
  await page.locator('.btn-history').click();
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel).toBeVisible({ timeout: 4_000 });

  // Select the latest snapshot (should contain V1)
  const firstItemBtn = panel.locator('.history-item-btn').first();
  await firstItemBtn.click();
  await expect(panel.locator('.history-content-view')).toBeVisible({ timeout: 5_000 });

  // Click Restore
  await panel.locator('.btn-restore').first().click();

  // Confirm dialog appears
  const confirmDialog = page.locator('[role="alertdialog"][aria-label="Confirm restore"]');
  await expect(confirmDialog).toBeVisible({ timeout: 4_000 });
  await confirmDialog.locator('[aria-label="Confirm restore"]').click();

  // Panel closes after restore
  await expect(panel).not.toBeVisible({ timeout: 5_000 });

  // Editor should now contain the restored content (V1)
  await expect(editor).toContainText(PROSE_V1, { timeout: 5_000 });
});

// ─── AC-DH-5: Restore creates a pre-restore backup snapshot ───────────────────

test('AC-DH-5: after restore, history list has grown (pre-restore snapshot was created)', async () => {
  // Save a named snapshot
  await page.locator('.scene-snapshot-save').click();
  await expect(page.locator('.scene-autosave')).toContainText('Snapshot saved', { timeout: 5_000 });

  // Open history and count entries
  await page.locator('.btn-history').click();
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel).toBeVisible({ timeout: 4_000 });

  const items = panel.locator('.history-item');
  await items.first().waitFor({ state: 'visible', timeout: 5_000 });
  const countBefore = await items.count();

  // Select first item and restore
  await panel.locator('.history-item-btn').first().click();
  await expect(panel.locator('.history-content-view')).toBeVisible({ timeout: 5_000 });
  await panel.locator('.btn-restore').first().click();
  const confirmDialog = page.locator('[role="alertdialog"][aria-label="Confirm restore"]');
  await expect(confirmDialog).toBeVisible({ timeout: 4_000 });
  await confirmDialog.locator('[aria-label="Confirm restore"]').click();
  await expect(panel).not.toBeVisible({ timeout: 5_000 });

  // Re-open history and verify entry count increased (pre-restore backup was created)
  await page.locator('.btn-history').click();
  const panel2 = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel2).toBeVisible({ timeout: 4_000 });
  const items2 = panel2.locator('.history-item');
  await items2.first().waitFor({ state: 'visible', timeout: 5_000 });
  const countAfter = await items2.count();
  expect(countAfter, 'history should have more entries after restore (pre-restore backup added)').toBeGreaterThan(countBefore);

  await panel2.locator('[aria-label="Close draft history"]').click();
});

// ─── AC-DH-6: Newest-first ordering ──────────────────────────────────────────

test('AC-DH-6: history entries are listed newest-first', async () => {
  const OLDER_TEXT = 'Older snapshot content for ordering test.';
  const NEWER_TEXT = 'Newer snapshot content for ordering test.';

  // Save older snapshot
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.selectAll();
  await page.keyboard.type(OLDER_TEXT);
  await page.locator('.scene-snapshot-save').click();
  await expect(page.locator('.scene-autosave')).toContainText('Snapshot saved', { timeout: 5_000 });

  // Wait to guarantee distinct timestamps, then save newer snapshot
  await page.waitForTimeout(1_200);
  await editor.click();
  await page.keyboard.selectAll();
  await page.keyboard.type(NEWER_TEXT);
  await page.locator('.scene-snapshot-save').click();
  await expect(page.locator('.scene-autosave')).toContainText('Snapshot saved', { timeout: 5_000 });

  await page.locator('.btn-history').click();
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel).toBeVisible({ timeout: 4_000 });

  const items = panel.locator('.history-item-btn');
  await items.first().waitFor({ state: 'visible', timeout: 5_000 });
  expect(await items.count(), 'need at least 2 history entries').toBeGreaterThanOrEqual(2);

  // First item (top of list) should preview the NEWER content
  await items.nth(0).click();
  const preview = panel.locator('.history-content-view');
  await expect(preview).toBeVisible({ timeout: 5_000 });
  const firstPreview = await preview.innerText();

  // Second item should preview the OLDER content
  await items.nth(1).click();
  await page.waitForTimeout(500); // let preview update
  const secondPreview = await preview.innerText();

  // Newest content should be first in the list
  expect(firstPreview.trim()).toContain(NEWER_TEXT);
  expect(secondPreview.trim()).toContain(OLDER_TEXT);

  await panel.locator('[aria-label="Close draft history"]').click();
});

// ─── AC-DH-7: Restore button has a descriptive aria-label ─────────────────────

test('AC-DH-7: the restore button has a descriptive aria-label', async () => {
  await page.locator('.btn-history').click();
  const panel = page.locator('[role="dialog"][aria-label="Draft history"]');
  await expect(panel).toBeVisible({ timeout: 4_000 });

  // Select any snapshot to reveal the restore button
  const firstItemBtn = panel.locator('.history-item-btn').first();
  await firstItemBtn.click();
  await expect(panel.locator('.history-content-view')).toBeVisible({ timeout: 5_000 });

  const restoreBtn = panel.locator('.btn-restore').first();
  await expect(restoreBtn).toBeVisible();
  const label = await restoreBtn.getAttribute('aria-label');
  // Must have a non-empty, descriptive aria-label (not just "Restore")
  expect(label, 'restore button should have a descriptive aria-label').toBeTruthy();
  expect(label!.length).toBeGreaterThan('Restore'.length);

  await panel.locator('[aria-label="Close draft history"]').click();
});
