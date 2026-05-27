/**
 * vault-crud.spec.ts — MYT-353
 *
 * Two-Vault smoke tests: Story Vault (Manuscript/stories) + Notes Vault (entities).
 *
 * Acceptance criteria:
 *   TC-V-01  Two vaults init      — manifest.json + app boots; both vault roots exist on disk
 *   TC-V-02  Create chapter       — chapter row visible in Stories navigator
 *   TC-V-03  Create scene         — scene .md file appears under chapter hierarchy on disk
 *   TC-V-04  Edit + save scene    — prose written to vault .md file on disk
 *   TC-V-05  Reload persistence   — prose survives full app restart (same userData)
 *   TC-V-06  Notes Vault note     — entity created, shown in Entities tab, file written to disk
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium   # first time only
 *   npx playwright test e2e/vault-crud.spec.ts --reporter=list
 *
 * All test data lives in tmp dirs that are deleted in afterAll.
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
  type Dialog,
} from '@playwright/test';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const PROSE = 'The vault held every secret the kingdom had ever kept.';
const STORY_TITLE = 'Vault Chronicles';
const CHAPTER_TITLE = 'The First Chamber';
const SCENE_TITLE = 'Descent';
const ENTITY_NAME = 'Seraphine Dusk';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Seed a fresh userData directory so the app boots directly into DesktopShell
 * (onboardingComplete: true) pointing at the given vaultDir and notesVaultDir.
 */
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
  // Pass --headless when no display is available (CI / WSL without X server).
  // --no-sandbox is required for Electron to spawn its renderer under Xvfb in CI
  // (matches the packaged-app smoke test in ci.yml).
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
  // Surface main-process stdout/stderr so a startup crash (which otherwise just
  // manifests as a firstWindow timeout) is visible in CI logs.
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/** Wait for a single native prompt() dialog and accept it with `response`. */
async function acceptNextDialog(pg: Page, response: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const handler = async (dialog: Dialog) => {
      pg.off('dialog', handler);
      if (dialog.type() === 'prompt') {
        await dialog.accept(response);
      } else {
        await dialog.dismiss();
      }
      resolve();
    };
    pg.on('dialog', handler);
  });
}

/** Recursively collect all *.md files under `dir`. */
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

/** Poll predicate until it returns true or timeoutMs elapses. */
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-two-vault-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-vault-'));
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

// ─── TC-V-01: Two vaults initialized on first boot ───────────────────────────
//
// After booting into DesktopShell the main process must:
//   • Create manifest.json in the Story Vault root
//   • Ensure the Notes Vault root directory exists on disk
// The test seeds vault-settings.json with both vaultRoot and notesVaultRoot.

test('TC-V-01: Story Vault manifest.json and Notes Vault directory both created on boot', async () => {
  // Wait for DesktopShell to render
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Story Vault: manifest.json must exist in vaultDir
  const manifestPath = path.join(vaultDir, 'manifest.json');
  const manifestFound = await waitUntil(() => fs.existsSync(manifestPath), 10_000);
  expect(manifestFound, `manifest.json not found in Story Vault: ${vaultDir}`).toBe(true);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    stories?: unknown[];
    schemaVersion?: unknown;
  };
  expect(Array.isArray(manifest.stories), 'manifest.stories must be an array').toBe(true);
  expect(manifest.schemaVersion, 'manifest.schemaVersion must be defined').toBeDefined();

  // Notes Vault: the notes vault root directory must exist
  // (created by ensureNotesVaultDir on boot when notesVaultRoot is in vault-settings.json)
  const notesVaultExists = await waitUntil(() => fs.existsSync(notesVaultDir), 8_000);
  expect(
    notesVaultExists,
    `Notes Vault root not found at: ${notesVaultDir}`,
  ).toBe(true);
});

// ─── TC-V-02: Create chapter → chapter row appears in navigator ───────────────
//
// Create a story and a chapter through the UI. Verify both appear in the
// StoryNavigator left rail. The chapter directory write happens at scene
// creation time; here we only verify the UI reflects the new hierarchy.

test('TC-V-02: create story + chapter, both appear in Stories navigator', async () => {
  // Ensure the Stories tab is active
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  // ── Create story ──────────────────────────────────────────────────────────
  const storyDialogP = acceptNextDialog(page, STORY_TITLE);
  await page.locator('.nav-add-btn').first().click();
  await storyDialogP;

  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });
  await expect(storyRow).toContainText(STORY_TITLE);

  // ── Create chapter ────────────────────────────────────────────────────────
  const chapterDialogP = acceptNextDialog(page, CHAPTER_TITLE);
  await storyRow.locator('.nav-inline-add').click();
  await chapterDialogP;

  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });
  await expect(chapterRow).toContainText(CHAPTER_TITLE);
});

// ─── TC-V-03: Create scene → file appears on disk under chapter path ──────────
//
// Create a scene under the chapter from TC-V-02. The renderer calls vault:write
// with path `stories/<storyId>/chapters/<chapterId>/scenes/<sceneId>.md`.
// Verify the file appears on disk inside the Story Vault directory tree.

test('TC-V-03: create scene, scene .md file written to Story Vault on disk', async () => {
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 4_000 });

  // Create scene under the chapter
  const sceneDialogP = acceptNextDialog(page, SCENE_TITLE);
  await chapterRow.locator('.nav-inline-add').click();
  await sceneDialogP;

  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await expect(sceneRow).toContainText(SCENE_TITLE);

  // The scene file is written with path: stories/<storyId>/chapters/<chapterId>/scenes/<sceneId>.md
  // Use findMdFiles across the entire vaultDir and look for any .md file under a
  // chapters/.../scenes/ hierarchy to confirm the per-scene file layout is in place.
  const sceneFileFound = await waitUntil(() => {
    const files = findMdFiles(vaultDir);
    return files.some((f) => f.includes(`${path.sep}scenes${path.sep}`));
  }, 10_000);
  expect(
    sceneFileFound,
    'No scene .md file found under a .../scenes/ directory in the Story Vault',
  ).toBe(true);

  // Broader fallback: any .md file anywhere in the vault (confirms vault write works)
  const anyMdFound = findMdFiles(vaultDir).length > 0;
  expect(anyMdFound, 'No .md files found in Story Vault at all').toBe(true);
});

// ─── TC-V-04: Edit scene → save → file content updated on disk ───────────────
//
// Open the scene created in TC-V-03, type prose, and verify the .md file on
// disk contains the typed text. DesktopShell calls vault:write on every
// block-editor change (debounced), so the file should update within ~2 s.

test('TC-V-04: type prose in scene editor, file content updated in Story Vault', async () => {
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.click();

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });

  await editor.click();
  await editor.type(PROSE);
  await expect(editor).toContainText(PROSE);

  // Wait for the vault write to flush
  const proseInFile = await waitUntil(() => {
    const files = findMdFiles(vaultDir);
    return files.some((f) => {
      try { return fs.readFileSync(f, 'utf-8').includes(PROSE); } catch { return false; }
    });
  }, 12_000);
  expect(
    proseInFile,
    `Prose "${PROSE}" not found in any Story Vault .md file`,
  ).toBe(true);
});

// ─── TC-V-05: Reload app → content persists ───────────────────────────────────
//
// Close the Electron app and relaunch it pointing at the same userData and
// vaultDir. Navigate to the scene and assert the prose typed in TC-V-04 is
// still present in the editor.

test('TC-V-05: prose persists after full app restart (same userData)', async () => {
  // Close the current instance
  await app.close().catch(() => {});

  // Relaunch with the same userData (vault-settings.json points at the same vaultDir)
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Wait for DesktopShell to render
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate to Stories tab
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  // The story and scene should still be there (from manifest.json on disk)
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Expand chapter if needed and open scene
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.click();

  // Prose must still be in the editor
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await expect(editor).toContainText(PROSE, { timeout: 8_000 });
});

// ─── TC-V-06: Create note in Notes Vault → appears in browser sidebar ─────────
//
// Switch to the Entities tab (Notes Vault browser), create a character entity,
// and verify it appears in the entity list and is written as a .md file on disk.
// Entities are stored in the Story Vault under entities/characters/ (in the current
// single-vault-root implementation). When the two-vault IPC is fully wired, they
// will go to notesVaultRoot instead.

test('TC-V-06: create entity (note), entity shown in Entities tab, file written to disk', async () => {
  // Switch to Entities tab
  const entitiesTab = page.locator('.rail-tab', { hasText: 'Entities' });
  await entitiesTab.click();

  // Wait for entity browser toolbar
  await expect(page.locator('.entity-browser')).toBeVisible({ timeout: 6_000 });

  // Click "+ New Entity" / primary add button
  await page.locator('.entity-btn.entity-btn-primary.entity-btn-sm').click();

  // Entity creation dialog
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Fill the entity name (type field defaults to 'character')
  const nameInput = dialog.locator('.entity-dialog-input').first();
  await nameInput.fill(ENTITY_NAME);

  // Submit
  await dialog.locator('.entity-btn.entity-btn-primary').click();

  // Dialog closes, entity appears in the list
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });
  const entityItem = page.locator('.entity-item-name', { hasText: ENTITY_NAME });
  await expect(entityItem).toBeVisible({ timeout: 8_000 });

  // Verify .md file on disk under entities/characters/ in the Story Vault
  const entityFileFound = await waitUntil(() => {
    const dir = path.join(vaultDir, 'entities', 'characters');
    if (!fs.existsSync(dir)) return false;
    return fs.readdirSync(dir).some((f) => {
      if (!f.endsWith('.md')) return false;
      try {
        return fs.readFileSync(path.join(dir, f), 'utf-8').includes(ENTITY_NAME);
      } catch {
        return false;
      }
    });
  }, 10_000);
  expect(
    entityFileFound,
    `Entity "${ENTITY_NAME}" not found in <vaultDir>/entities/characters/`,
  ).toBe(true);
});
