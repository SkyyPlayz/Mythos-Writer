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
const STORY_TITLE = 'Two-Vault Chronicle';
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

async function openVaultTab(pg: Page): Promise<void> {
  // SKY-1694: Vault Browser is in the panel zone (collapsed by default); expand it.
  const vaultPanel = pg.locator('[data-panel-id="vault"]');
  const isCollapsed = await vaultPanel.evaluate((el) => el.classList.contains('lr-panel--collapsed')).catch(() => false);
  if (isCollapsed) await vaultPanel.locator('.lr-panel-collapse-btn').click();
  await expect(pg.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });
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

// ─── TC-VB-01: VaultBrowser renders in "Both" scope by default ───────────────

test('TC-VB-01: Vault tab shows Story Vault + Notes Vault split in Both scope', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await openVaultTab(page);

  // "Both" scope is the default — aria-pressed reflects the active state
  await expect(page.locator('[data-testid="vb-scope-both"]')).toHaveAttribute('aria-pressed', 'true');

  // Both vault sections rendered simultaneously
  await expect(page.locator('[data-testid="vb-story-vault"]')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });
});

// ─── TC-VB-02: Story scope — Notes Vault panel hidden ────────────────────────

test('TC-VB-02: switching to Story scope hides Notes Vault panel', async () => {
  await openVaultTab(page);
  await page.locator('[data-testid="vb-scope-story"]').click();

  await expect(page.locator('[data-testid="vb-scope-story"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="vb-story-vault"]')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('[data-testid="vb-notes-vault"]')).not.toBeVisible({ timeout: 4_000 });

  // Restore for subsequent tests
  await page.locator('[data-testid="vb-scope-both"]').click();
  await expect(page.locator('[data-testid="vb-scope-both"]')).toHaveAttribute('aria-pressed', 'true');
});

// ─── TC-VB-03: Notes scope — Story Vault panel hidden ────────────────────────

test('TC-VB-03: switching to Notes scope hides Story Vault panel', async () => {
  await openVaultTab(page);
  await page.locator('[data-testid="vb-scope-notes"]').click();

  await expect(page.locator('[data-testid="vb-scope-notes"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('[data-testid="vb-story-vault"]')).not.toBeVisible({ timeout: 4_000 });

  // Restore for subsequent tests
  await page.locator('[data-testid="vb-scope-both"]').click();
  await expect(page.locator('[data-testid="vb-scope-both"]')).toHaveAttribute('aria-pressed', 'true');
});

// ─── TC-VB-04: Create story via VaultBrowser Story Vault ─────────────────────

test('TC-VB-04: create story via VaultBrowser Story Vault panel, story row appears', async () => {
  await openVaultTab(page);

  // New Story button lives in the Story Vault section header
  await page.locator('[data-testid="vb-story-vault"] [aria-label="New Story"]').click();
  await fillPrompt(page, STORY_TITLE);

  // Story title appears in the Story Vault panel
  await expect(
    page.locator('[data-testid="vb-story-vault"] .vb-name', { hasText: STORY_TITLE }),
  ).toBeVisible({ timeout: 8_000 });
});

// ─── TC-VB-05: Create chapter + scene → scene file lands in Story Vault ──────

test('TC-VB-05: chapter + scene created via VaultBrowser; scene file in Story Vault, notesVaultDir untouched', async () => {
  await openVaultTab(page);

  // Capture baseline before story write operations (notesVaultDir may already hold the TC-VB-06 seed)
  const notesCountBefore = findMdFiles(notesVaultDir).length;

  // Story from TC-VB-04 must be present (single story auto-expands)
  const storyNameEl = page.locator('[data-testid="vb-story-vault"] .vb-name', { hasText: STORY_TITLE });
  await expect(storyNameEl).toBeVisible({ timeout: 6_000 });

  // Create chapter via the story's inline-add button
  await page.locator('[data-testid="vb-story-vault"]')
    .locator(`[aria-label="New chapter in ${STORY_TITLE}"]`)
    .click();
  await fillPrompt(page, CHAPTER_TITLE);

  await expect(
    page.locator('[data-testid="vb-story-vault"] .vb-name', { hasText: CHAPTER_TITLE }),
  ).toBeVisible({ timeout: 6_000 });

  // Expand chapter by clicking its toggle (contains chapter title text)
  await page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE }).click();

  // Create scene under the chapter
  await page.locator('[data-testid="vb-story-vault"]')
    .locator(`[aria-label="New scene in ${CHAPTER_TITLE}"]`)
    .click();
  await fillPrompt(page, SCENE_TITLE);

  await expect(
    page.locator('[data-testid="vb-story-vault"] .vb-scene-row .vb-name', { hasText: SCENE_TITLE }),
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

test('TC-VB-06: pre-seeded worldbuilding note visible in Notes Vault file tree', async () => {
  await openVaultTab(page);

  // Switch to Notes scope so the Notes panel fills the width
  await page.locator('[data-testid="vb-scope-notes"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 4_000 });

  // worldbuilding/ directory row — auto-expanded on first load via initExpand
  await expect(
    page.locator(`[data-testid="vb-row-${NOTE_DIR}"]`),
  ).toBeVisible({ timeout: 8_000 });

  // world-notes.md file row (react-window renders each row with its vault-relative path)
  await expect(
    page.locator(`[data-testid="vb-row-${NOTE_DIR}/${NOTE_FILE}"]`),
  ).toBeVisible({ timeout: 8_000 });

  // Restore scope
  await page.locator('[data-testid="vb-scope-both"]').click();
});

// ─── TC-VB-07: Markdown round-trip — prose survives full restart ──────────────

test('TC-VB-07: prose typed in scene editor survives full app restart (markdown round-trip)', async () => {
  await openVaultTab(page);

  // Open the scene created in TC-VB-05
  const sceneRow = page.locator('[data-testid="vb-story-vault"] .vb-scene-row').first();
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

  // Navigate to VaultBrowser; localStorage persists expanded state across restarts
  await openVaultTab(page);

  // Chapter may need expanding if localStorage did not carry the expanded state
  const chapterToggle = page.locator('[data-testid="vb-story-vault"] .vb-tree-toggle', { hasText: CHAPTER_TITLE });
  if (await chapterToggle.isVisible()) {
    const isExpanded = await chapterToggle.getAttribute('aria-expanded');
    if (isExpanded !== 'true') await chapterToggle.click();
  }

  const sceneRowAfter = page.locator('[data-testid="vb-story-vault"] .vb-scene-row').first();
  await expect(sceneRowAfter).toBeVisible({ timeout: 6_000 });
  await sceneRowAfter.click();

  // Prose must still be present — markdown serializer must not reformat content
  const editorAfter = page.locator('.ProseMirror');
  await expect(editorAfter).toBeVisible({ timeout: 8_000 });
  await expect(editorAfter).toContainText(PROSE, { timeout: 8_000 });
});
