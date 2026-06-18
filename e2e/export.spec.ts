/**
 * export.spec.ts — SKY-2213
 *
 * E2E tests for the ExportDialog component and the export IPC flow.
 *
 * Test matrix:
 *   AC-EXQ-1  Dialog renders three format radio options (Markdown, Plaintext, DOCX)
 *   AC-EXQ-3  Selecting DOCX → Export clicked → file written to disk
 *   AC-EXQ-6  Cancel closes dialog without writing any file
 *   AC-EXQ-7  Dialog shows a word count estimate matching the scope
 *
 *   AC-EXQ-2  EPUB radio present when scope=story     (skipped: requires SKY-2210)
 *   AC-EXQ-4  EPUB export writes file to disk         (skipped: requires SKY-2210)
 *   AC-EXQ-5  EPUB radio disabled for scene/chapter   (skipped: requires SKY-2210)
 *
 * The export handlers call dialog.showSaveDialog() which cannot be driven by
 * Playwright. We override those IPC channels after launch via app.evaluate()
 * so they write a deterministic temp file and return its path without opening
 * the native save dialog.
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

const STORY_ID = 'export-story-001';
const CHAPTER_ID = 'export-chapter-001';
const SCENE_ID = 'export-scene-001';
const STORY_TITLE = 'Export Test Chronicle';
const CHAPTER_TITLE = 'Chapter One';
const SCENE_TITLE = 'The Opening Scene';
const SCENE_PROSE = 'Once upon a time in a land of tests, every assertion passed.';

// ─── Vault seeding ────────────────────────────────────────────────────────────

function seedVault(vaultDir: string): void {
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const sceneAbsPath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(sceneAbsPath), { recursive: true });
  fs.writeFileSync(sceneAbsPath, `# ${SCENE_TITLE}\n\n${SCENE_PROSE}\n`);

  const words = SCENE_PROSE.trim().split(/\s+/).length;
  const now = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: `stories/${STORY_ID}`,
        synopsis: '',
        chapters: [
          {
            id: CHAPTER_ID,
            title: CHAPTER_TITLE,
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            createdAt: now,
            updatedAt: now,
            scenes: [
              {
                id: SCENE_ID,
                title: SCENE_TITLE,
                path: scenePath,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                createdAt: now,
                updatedAt: now,
                blocks: [
                  {
                    id: 'blk-001',
                    type: 'paragraph',
                    content: SCENE_PROSE,
                    order: 0,
                    updatedAt: now,
                  },
                ],
              },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    scenes: [],
    arcs: [],
    _wordCountHint: words,
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

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

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Override export IPC handlers so they write deterministic temp files instead
 * of opening the native save dialog. Call after app.firstWindow().
 *
 * Recorded calls are available via globalThis.__exportCalls in app.evaluate().
 */
async function mockExportHandlers(app: ElectronApplication, exportDir: string): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { dir }: { dir: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path') as typeof import('path');

      (globalThis as Record<string, unknown>).__exportCalls = [];

      const record = (channel: string, filePath: string | null) => {
        ((globalThis as Record<string, unknown>).__exportCalls as unknown[]).push({ channel, filePath });
      };

      const stub = (channel: string, ext: string) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => {
          const filePath = path.join(dir, `export-stub.${ext}`);
          fs.writeFileSync(filePath, `stub:${channel}`);
          record(channel, filePath);
          return { path: filePath, cancelled: false };
        });
      };

      const stubCancel = (channel: string) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => {
          record(channel, null);
          return { path: null, cancelled: true };
        });
      };

      // Default: all export channels write a stub file.
      stub('export:markdown', 'md');
      stub('export:plaintext', 'txt');
      stub('export:docx', 'docx');
      stub('export:epub', 'epub');

      // Expose a helper to switch a channel into cancel mode.
      (globalThis as Record<string, unknown>).__setExportCancel = (channel: string) => stubCancel(channel);
    },
    { dir: exportDir },
  );
}

/** Switch one export channel into cancel mode (returns { cancelled: true }). */
async function setExportCancel(app: ElectronApplication, channel: string): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, ch: string) => {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, () => ({ path: null, cancelled: true }));
    },
    channel,
  );
}

/** Read the recorded export calls from the main process. */
async function getExportCalls(app: ElectronApplication): Promise<Array<{ channel: string; filePath: string | null }>> {
  return app.evaluate(
    () => (globalThis as Record<string, unknown>).__exportCalls as Array<{ channel: string; filePath: string | null }>,
  );
}

/** Reset the recorded export calls. */
async function clearExportCalls(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as Record<string, unknown>).__exportCalls = [];
  });
}

/**
 * Open the ExportDialog via File menu > "Export Markdown…".
 * Requires a story to be selected (click .nav-story-row first).
 */
async function openExportDialog(page: Page): Promise<void> {
  await page.locator('.app-menu-item-trigger', { hasText: 'File' }).click();
  await page.locator('#file-menu').waitFor({ state: 'visible', timeout: 4_000 });
  await page.locator('#file-menu button[role="menuitem"]', { hasText: 'Export Markdown…' }).click();
  await page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]').waitFor({ state: 'visible', timeout: 6_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let exportDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-export-ud-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-export-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-export-notes-'));
  exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-export-out-'));

  seedVault(vaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await mockExportHandlers(app, exportDir);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
  fs.rmSync(exportDir, { recursive: true, force: true });
});

// ─── AC-EXQ-1: Dialog renders three format radio options ─────────────────────

test('AC-EXQ-1: ExportDialog opens and renders Markdown, Plaintext, DOCX radio options', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Select the seeded story so selectedStoryId is set in AppMenuBar.
  const storyPanel = page.locator('[data-panel-id="stories"]');
  if (await storyPanel.isVisible().catch(() => false)) {
    const collapsed = await storyPanel.evaluate((el) => el.classList.contains('lr-panel--collapsed')).catch(() => false);
    if (collapsed) await storyPanel.locator('.lr-panel-collapse-btn').click();
  }
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 10_000 });
  await storyRow.click();

  await openExportDialog(page);

  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');
  await expect(dialog).toBeVisible();

  // All three format options must be present.
  await expect(dialog.locator('label', { hasText: 'Markdown (.md)' })).toBeVisible();
  await expect(dialog.locator('label', { hasText: 'Plain Text (.txt)' })).toBeVisible();
  await expect(dialog.locator('label', { hasText: 'Word Document (.docx)' })).toBeVisible();

  // Close dialog before next test.
  await dialog.locator('button[aria-label="Close"]').click();
  await dialog.waitFor({ state: 'detached', timeout: 4_000 });
});

// ─── AC-EXQ-7: Dialog shows word count estimate ───────────────────────────────

test('AC-EXQ-7: ExportDialog shows non-zero word count estimate for seeded story', async () => {
  await openExportDialog(page);

  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');
  const statsEl = dialog.locator('.export-dialog-stats');
  await expect(statsEl).toBeVisible();

  const statsText = await statsEl.innerText();
  // Should match "N scenes · ~W words"
  expect(statsText).toMatch(/scene/);
  expect(statsText).toMatch(/words/);

  // Word count must be > 0 (the scene has prose)
  const match = statsText.match(/~([\d,]+)\s+words/);
  expect(match, `Expected word count in stats text: "${statsText}"`).toBeTruthy();
  const wc = parseInt((match![1] ?? '0').replace(/,/g, ''), 10);
  expect(wc, 'Word count must be > 0').toBeGreaterThan(0);

  await dialog.locator('button[aria-label="Close"]').click();
  await dialog.waitFor({ state: 'detached', timeout: 4_000 });
});

// ─── AC-EXQ-3: DOCX selection + export writes file ───────────────────────────

test('AC-EXQ-3: selecting DOCX and clicking Export triggers IPC and writes export file', async () => {
  await clearExportCalls(app!);

  await openExportDialog(page);
  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');

  // Select DOCX radio.
  await dialog.locator('input[type="radio"][value="docx"]').click();
  await expect(dialog.locator('input[type="radio"][value="docx"]')).toBeChecked();

  // Click Export.
  await dialog.locator('button.export-dialog-btn-primary').click();

  // Dialog should close (mock returns non-cancelled, then onClose is called).
  await dialog.waitFor({ state: 'detached', timeout: 8_000 });

  const calls = await getExportCalls(app!);
  const docxCall = calls.find((c) => c.channel === 'export:docx');
  expect(docxCall, 'export:docx IPC must have been called').toBeTruthy();
  expect(docxCall!.filePath, 'IPC must return a file path').toBeTruthy();
  expect(fs.existsSync(docxCall!.filePath!), 'Exported DOCX stub file must exist on disk').toBe(true);
});

// ─── AC-EXQ-6: Cancel closes dialog without writing any file ─────────────────

test('AC-EXQ-6: clicking Cancel closes ExportDialog without triggering any export', async () => {
  await clearExportCalls(app!);

  await openExportDialog(page);
  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');

  const filesBefore = fs.readdirSync(exportDir).length;

  await dialog.locator('button.export-dialog-btn-secondary', { hasText: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 4_000 });

  // No IPC call made.
  const calls = await getExportCalls(app!);
  expect(calls.length, 'No export IPC calls expected after Cancel').toBe(0);

  // No new files written.
  const filesAfter = fs.readdirSync(exportDir).length;
  expect(filesAfter, 'No export files should be written after Cancel').toBe(filesBefore);
});

// ─── AC-EXQ-2: EPUB radio present when scope=story ───────────────────────────
// Skipped until SKY-2210 lands (EPUB option not yet added to ExportDialog).

test.skip('AC-EXQ-2: ExportDialog shows EPUB radio option when scope is story [requires SKY-2210]', async () => {
  await openExportDialog(page);
  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');
  await expect(dialog.locator('label', { hasText: 'EPUB' })).toBeVisible();
  await dialog.locator('button[aria-label="Close"]').click();
  await dialog.waitFor({ state: 'detached', timeout: 4_000 });
});

// ─── AC-EXQ-4: EPUB export writes file ───────────────────────────────────────
// Skipped until SKY-2210 lands.

test.skip('AC-EXQ-4: selecting EPUB and clicking Export writes EPUB file [requires SKY-2210]', async () => {
  await clearExportCalls(app!);
  await openExportDialog(page);
  const dialog = page.locator('[role="dialog"][aria-labelledby="export-dialog-title"]');
  await dialog.locator('input[type="radio"][value="epub"]').click();
  await dialog.locator('button.export-dialog-btn-primary').click();
  await dialog.waitFor({ state: 'detached', timeout: 8_000 });
  const calls = await getExportCalls(app!);
  const epubCall = calls.find((c) => c.channel === 'export:epub');
  expect(epubCall, 'export:epub IPC must have been called').toBeTruthy();
  expect(fs.existsSync(epubCall!.filePath!), 'Exported EPUB stub file must exist on disk').toBe(true);
});

// ─── AC-EXQ-5: EPUB radio disabled for scene/chapter scope ───────────────────
// Skipped until SKY-2210 lands.

test.skip('AC-EXQ-5: EPUB radio is disabled/absent when scope is scene or chapter [requires SKY-2210]', async () => {
  // This test requires opening the ExportDialog via StoryContextMenu with
  // scope={kind:'scene'} and scope={kind:'chapter'} and asserting the EPUB
  // radio is absent or disabled. Implement when SKY-2210 adds the EPUB radio
  // and context-menu export triggers.
});
