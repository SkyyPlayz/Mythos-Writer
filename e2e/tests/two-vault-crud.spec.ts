/**
 * two-vault-crud.spec.ts — MYT-769
 *
 * Phase 2 two-vault layout E2E: VaultBrowser sidebar split panel.
 *
 * Acceptance criteria:
 *   TC-VB-01  Both scope default   — Vault tab shows Story + Notes panels side-by-side
 *   TC-VB-02  Scope → Story        — Notes panel hidden; Story panel visible
 *   TC-VB-03  Scope → Notes        — Story panel hidden; Notes panel visible
 *   TC-VB-04  Create in Story Vault — story created via VaultBrowser, appears in story section
 *   TC-VB-05  Scene → disk path    — chapter + scene file written under Story Vault; notesVaultDir untouched
 *   TC-VB-06  Notes Vault tree     — pre-seeded worldbuilding note visible in Notes panel tree
 *   TC-VB-07  Markdown round-trip  — prose typed in scene survives full app restart without lossy reformat
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
const CHAPTER_TITLE = 'Opening Rift';
const SCENE_TITLE = 'Split Horizon';
const PROSE = 'The vault split in two: manuscript and memory, story and lore.';
const NOTE_DIR = 'worldbuilding';
const NOTE_FILE = 'world-notes.md';

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

function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
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

// SKY-9022/M6: the old unlocked (Story/Notes/Both scope) VaultBrowser panel
// this suite exercised no longer exists. Per the M6 spec
// (plans/fidelity-rebuild/PLAN.md §M6: "Vault Browser's function = the Notes
// workspace sidebar, which is its one home"), VaultBrowser is reachable only
// via the Notes Editor rail tab, always locked to notes scope — no scope
// bar, no Story-side split. openNotesVaultTab replaces openVaultTab for the
// Notes-only cases (TC-VB-06); the Story-side cases were rewritten to use
// StoryNavigator or skipped where they test scope-switching itself — see
// each test below.
async function openNotesVaultTab(pg: Page): Promise<void> {
  await pg.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(pg.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vb-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vb-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vb-notes-'));

  // Pre-seed a worldbuilding note in notesVaultDir so the Notes Vault tree has content on boot.
  const noteSubDir = path.join(notesVaultDir, NOTE_DIR);
  fs.mkdirSync(noteSubDir, { recursive: true });
  fs.writeFileSync(
    path.join(noteSubDir, NOTE_FILE),
    `---\ntitle: "World Notes"\ncreatedAt: ${new Date().toISOString()}\n---\n\nWorldbuilding notes for the two-vault chronicle.\n`,
  );

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

// ─── TC-VB-01..03: SKIPPED — SKY-9022/M6 ─────────────────────────────────────
//
// These cases test the Story/Notes/Both scope-switching UI itself
// (`vb-scope-*`, the side-by-side split). M6 removed scope-switching
// entirely — VaultBrowser is now always locked to notes scope, so there is
// no "Both" or "Story" scope to switch to anymore. This isn't a locator
// fixup; the feature under test no longer exists. Skipped rather than
// deleted so the gap stays visible/traceable.

test.skip('TC-VB-01: Vault tab shows Story Vault + Notes Vault split in Both scope', async () => {
  // See SKY-9022/M6 skip note above — scope-switching UI no longer exists.
});

test.skip('TC-VB-02: switching to Story scope hides Notes Vault panel', async () => {
  // See SKY-9022/M6 skip note above.
});

test.skip('TC-VB-03: switching to Notes scope hides Story Vault panel', async () => {
  // See SKY-9022/M6 skip note above.
});

// ─── TC-VB-04: Create story via StoryNavigator ───────────────────────────────
// SKY-9022/M6: story creation now happens via StoryNavigator, not the dead
// VaultBrowser "vault" panel's Story Vault section.

test('TC-VB-04: create story via StoryNavigator, story row appears', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // M3 instant-create: no prompt — story appears immediately as "Untitled
  // Story" (single story in this fixture vault, so match positionally
  // rather than by a title no create flow ever sets).
  await page.locator('.lr-nav-add').first().click();

  await expect(
    page.locator('.nav-story-row').first(),
  ).toBeVisible({ timeout: 8_000 });
});

// ─── TC-VB-05: Create chapter + scene → scene file lands in Story Vault ──────

test('TC-VB-05: chapter + scene created via StoryNavigator; scene file in Story Vault, notesVaultDir untouched', async () => {
  // Capture baseline before story write operations (notesVaultDir may already hold the TC-VB-06 seed)
  const notesCountBefore = findMdFiles(notesVaultDir).length;

  // Story from TC-VB-04 must be present (single story auto-expands).
  // M3 instant-create leaves it named "Untitled Story" — match positionally
  // rather than by a title no create flow ever sets.
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 6_000 });

  // Create chapter via the story's inline-add button
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);

  const chapterRow = page.locator('.nav-chapter-row', { hasText: CHAPTER_TITLE });
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  // Create scene under the chapter
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);

  await expect(
    page.locator('.nav-scene-row', { hasText: SCENE_TITLE }),
  ).toBeVisible({ timeout: 6_000 });

  // Scene .md file written under Story Vault path (stories/.../scenes/...)
  const sceneOnDisk = await waitUntil(() => {
    const files = findMdFiles(vaultDir);
    return files.some((f) => f.includes(`${path.sep}scenes${path.sep}`));
  }, 10_000);
  expect(sceneOnDisk, 'Scene .md file not found under .../scenes/ in Story Vault').toBe(true);

  // Notes Vault directory (separate path) must not grow — story writes go to vaultDir only
  expect(
    findMdFiles(notesVaultDir).length,
    'notesVaultDir must not contain files created by Story Vault operations',
  ).toBe(notesCountBefore);
});

// ─── TC-VB-06: Pre-seeded worldbuilding note appears in Notes Vault tree ─────
// SKY-9022/M6: VaultBrowser's one home is the Notes Editor rail tab.

test('TC-VB-06: pre-seeded worldbuilding note visible in Notes Vault file tree', async () => {
  await openNotesVaultTab(page);

  // worldbuilding/ directory row — auto-expanded on first load via initExpand
  await expect(
    page.locator(`[data-testid="vb-row-${NOTE_DIR}"]`),
  ).toBeVisible({ timeout: 8_000 });

  // world-notes.md file row (react-window renders each row with its vault-relative path)
  await expect(
    page.locator(`[data-testid="vb-row-${NOTE_DIR}/${NOTE_FILE}"]`),
  ).toBeVisible({ timeout: 8_000 });
});

// ─── TC-VB-07: Markdown round-trip — prose survives full restart ──────────────
// SKY-9022/M6: navigate scenes via StoryNavigator, not the dead VaultBrowser
// Story Vault tree.

test('TC-VB-07: prose typed in scene editor survives full app restart (markdown round-trip)', async () => {
  // TC-VB-06 (above) leaves the app on the Notes Editor tab; navigate back
  // to Story Writer so StoryNavigator (and the scene from TC-VB-05) is visible.
  await page.locator('button.nav-rail__item[aria-label="Story Writer"]').click();

  // Open the scene created in TC-VB-05
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.click();

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await editor.click();
  await editor.type(PROSE);
  await expect(editor).toContainText(PROSE);

  // Wait for vault write to flush to disk
  const proseOnDisk = await waitUntil(() => {
    return findMdFiles(vaultDir).some((f) => {
      try { return fs.readFileSync(f, 'utf-8').includes(PROSE); } catch { return false; }
    });
  }, 12_000);
  expect(proseOnDisk, `Prose not flushed to Story Vault within timeout`).toBe(true);

  // Full restart with same userData/vaultDir
  await app.close().catch(() => {});
  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate to the scene via StoryNavigator; localStorage persists expanded state across restarts
  const sceneRowAfter = page.locator('.nav-scene-row').first();
  await expect(sceneRowAfter).toBeVisible({ timeout: 8_000 });
  await sceneRowAfter.click();

  // Prose must still be present — markdown serializer must not reformat content
  const editorAfter = page.locator('.ProseMirror');
  await expect(editorAfter).toBeVisible({ timeout: 8_000 });
  await expect(editorAfter).toContainText(PROSE, { timeout: 8_000 });
});
