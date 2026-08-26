/**
 * delete-scene-chapter.spec.ts — SKY-7994 / SKY-10917 / SKY-11004
 *
 * Real, process-boundary E2E coverage for the Story Navigator right-click
 * "Delete scene…" / "Delete chapter…" actions (added by SKY-10917,
 * DesktopShell.tsx's deleteScene/deleteChapter). This is a destructive,
 * user-facing path that writes to disk via window.api.deleteVault, and
 * before this file it was only reachable through unit tests that mock
 * window.api — a broken IPC handler or a broken renderer→main wiring would
 * still pass those. This spec drives the real UI, through the real preload
 * bridge, into the real Electron main process, onto a real temp vault on
 * disk, and asserts the .md files are actually gone (see vault.ts's
 * deleteVaultFile: rename-to-trash then unlink/rmSync — a real deletion,
 * not a soft-delete flag).
 *
 * Acceptance criteria:
 *   TC-DEL-01  Delete scene…  removes the row from the tree, deletes that
 *              scene's .md file from the vault on disk, and leaves a
 *              sibling scene in the same chapter untouched.
 *   TC-DEL-02  Delete chapter… removes the chapter (and its scene) from the
 *              tree, deletes that scene's .md file from disk, and leaves an
 *              unrelated chapter/scene untouched.
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
const CHAPTER_A_TITLE = 'Chapter Alpha';
const SCENE_A1_TITLE = 'Scene Alpha One';
const SCENE_A2_TITLE = 'Scene Alpha Two';
const CHAPTER_B_TITLE = 'Chapter Beta';
const SCENE_B1_TITLE = 'Scene Beta One';

// ─── Helpers (mirrors inline-scene-rename.spec.ts / two-vault-crud.spec.ts) ────

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
  // The delete confirmations below are real window.confirm() calls (native
  // Electron dialogs), not the app's custom prompt-modal — auto-accept them.
  pg.on('dialog', (d) => void d.accept().catch(() => undefined));
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

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

// Absolute path of Scene Alpha Two's .md file on disk, captured once created
// in Setup so TC-DEL-01 can assert it (and only it) is gone afterward.
let sceneA2Path: string;
// Absolute path of Scene Beta One's .md file, captured once created so
// TC-DEL-02 can assert deleting Chapter Beta also removes it from disk.
let sceneB1Path: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-del-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-del-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-del-notes-'));

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── Setup: story with two chapters, one holding two scenes ───────────────────

test('Setup: create story, Chapter Alpha (2 scenes), Chapter Beta (1 scene)', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  await page.locator('.lr-nav-add').first().click();
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Chapter Alpha + two scenes
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_A_TITLE);
  const chapterARow = page.locator('.nav-chapter-row', { hasText: CHAPTER_A_TITLE });
  await expect(chapterARow).toBeVisible({ timeout: 6_000 });

  await chapterARow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_A1_TITLE);
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_A1_TITLE })).toBeVisible({ timeout: 6_000 });

  const beforeA2 = new Set(findMdFiles(vaultDir));
  await chapterARow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_A2_TITLE);
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_A2_TITLE })).toBeVisible({ timeout: 6_000 });

  await waitUntil(() => findMdFiles(vaultDir).some((f) => !beforeA2.has(f)));
  const newA2 = findMdFiles(vaultDir).filter((f) => !beforeA2.has(f));
  expect(newA2.length).toBeGreaterThan(0);
  sceneA2Path = newA2[0];
  expect(fs.existsSync(sceneA2Path)).toBe(true);

  // Chapter Beta + one scene
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_B_TITLE);
  const chapterBRow = page.locator('.nav-chapter-row', { hasText: CHAPTER_B_TITLE });
  await expect(chapterBRow).toBeVisible({ timeout: 6_000 });

  const beforeB1 = new Set(findMdFiles(vaultDir));
  await chapterBRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_B1_TITLE);
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_B1_TITLE })).toBeVisible({ timeout: 6_000 });

  await waitUntil(() => findMdFiles(vaultDir).some((f) => !beforeB1.has(f)));
  const newB1 = findMdFiles(vaultDir).filter((f) => !beforeB1.has(f));
  expect(newB1.length).toBeGreaterThan(0);
  sceneB1Path = newB1[0];
  expect(fs.existsSync(sceneB1Path)).toBe(true);
});

// ─── TC-DEL-01: Delete scene… ──────────────────────────────────────────────────

test('TC-DEL-01: right-click "Delete scene…" removes the row and the .md file from disk, sibling scene survives', async () => {
  const sceneA2Row = page.locator('.nav-scene-row', { hasText: SCENE_A2_TITLE });
  await expect(sceneA2Row).toBeVisible();
  await sceneA2Row.click({ button: 'right' });

  const menu = page.locator('[data-testid="story-navigator-context-menu"]');
  await expect(menu).toBeVisible({ timeout: 4_000 });
  await menu.locator('[data-testid="menu-item-delete"]').click();

  // Real IPC round-trip: renderer → window.api.deleteVault → main →
  // vault:delete → fs.unlink. Poll disk instead of a fixed sleep.
  await expect(sceneA2Row).toHaveCount(0, { timeout: 8_000 });
  await waitUntil(() => !fs.existsSync(sceneA2Path), 8_000);
  expect(fs.existsSync(sceneA2Path)).toBe(false);

  // Sibling scene in the same chapter, and the chapter itself, are untouched.
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_A1_TITLE })).toBeVisible();
  await expect(page.locator('.nav-chapter-row', { hasText: CHAPTER_A_TITLE })).toBeVisible();
});

// ─── TC-DEL-02: Delete chapter… ─────────────────────────────────────────────────

test('TC-DEL-02: right-click "Delete chapter…" removes the chapter, its scene row, and its scene .md file from disk', async () => {
  const chapterBRow = page.locator('.nav-chapter-row', { hasText: CHAPTER_B_TITLE });
  await expect(chapterBRow).toBeVisible();
  await chapterBRow.click({ button: 'right' });

  const menu = page.locator('[data-testid="story-navigator-context-menu"]');
  await expect(menu).toBeVisible({ timeout: 4_000 });
  await menu.locator('[data-testid="menu-item-delete"]').click();

  await expect(chapterBRow).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_B1_TITLE })).toHaveCount(0);
  await waitUntil(() => !fs.existsSync(sceneB1Path), 8_000);
  expect(fs.existsSync(sceneB1Path)).toBe(false);

  // Unrelated chapter/scene from TC-DEL-01 are untouched.
  await expect(page.locator('.nav-chapter-row', { hasText: CHAPTER_A_TITLE })).toBeVisible();
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_A1_TITLE })).toBeVisible();
});
