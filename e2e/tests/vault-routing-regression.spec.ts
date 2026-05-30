/**
 * vault-routing-regression.spec.ts — SKY-84
 *
 * Regression suite: verifies that the SKY-72 fix correctly separates
 * Story Vault and Notes Vault listings and write-paths, and doesn't
 * reintroduce the SKY-75 Notes-routing bug.
 *
 * TC-SKY84-01  Listing separation   — NotesVault panel shows files from notesVaultDir
 *                                     only, not from storyVaultDir. StoryVault panel
 *                                     shows manifest-driven story items only.
 * TC-SKY84-02  Empty Notes Vault    — when notesVaultDir is empty, NotesVault renders
 *                                     the expected empty-state placeholder.
 * TC-SKY84-03  Write isolation: note — creating a note via NotesVault panel writes the
 *                                     file to notesVaultDir, not storyVaultDir.
 * TC-SKY84-04  Write isolation: story — creating a story+scene via StoryVault panel
 *                                      writes to storyVaultDir; notesVaultDir is untouched.
 *
 * Discrimination strategy for TC-01:
 *   We seed storyVaultDir with lore/world-notes.md (a non-story file that would
 *   appear in the Notes panel if it incorrectly reads from storyVaultDir), and
 *   notesVaultDir with characters/alice.md.  After the fix, the Notes panel
 *   must show alice but NOT world-notes.
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

// Discrimination seeds — only one should be visible in the Notes panel.
const STORY_SEED_DIR = 'lore';
const STORY_SEED_FILE = 'world-notes.md';     // seeded in storyVaultDir
const NOTES_SEED_DIR = 'characters';
const NOTES_SEED_FILE = 'alice.md';           // seeded in notesVaultDir

const NEW_NOTE_NAME = 'my-regression-note';  // TC-03
const STORY_TITLE = 'SKY84 Chronicle';        // TC-04
const CHAPTER_TITLE = 'Routing Chapter';
const SCENE_TITLE = 'Separation Scene';

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

function findAllFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findAllFiles(full));
    else results.push(full);
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

// ─── Suite A: Empty Notes Vault (TC-SKY84-02) ────────────────────────────────

test.describe('TC-SKY84-02: Empty Notes Vault', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky84-empty-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky84-story-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky84-notes-'));
    // notesVaultDir left empty intentionally — the app must initialise it on boot.
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

  test('TC-SKY84-02: empty notesVaultDir → Notes panel shows empty-state placeholder', async () => {
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await openVaultTab(page);

    // Switch to Notes scope to isolate the Notes panel.
    await page.locator('[data-testid="vb-scope-notes"]').click();
    await expect(page.locator('[data-testid="vb-scope-notes"]')).toHaveAttribute('aria-pressed', 'true');

    const notesPanel = page.locator('[data-testid="vb-notes-vault"]');
    await expect(notesPanel).toBeVisible({ timeout: 6_000 });

    // Wait for loading indicator to clear.
    await expect(page.locator('.vb-loading')).not.toBeVisible({ timeout: 8_000 });

    // Empty-state placeholder must be present.
    // SKY-72 adds data-testid="vb-notes-substate" to the element; fall back to
    // the class selector to keep the assertion readable regardless of merge order.
    const emptyState = notesPanel.locator('[data-testid="vb-notes-substate"], .vb-empty');
    await expect(emptyState.first()).toBeVisible({ timeout: 6_000 });
    await expect(emptyState.first()).toContainText('No notes yet');
  });
});

// ─── Suite B: Populated Vaults (TC-01, TC-03, TC-04) ─────────────────────────

test.describe('populated vaults: routing regression', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky84-pop-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky84-story2-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky84-notes2-'));

    // Seed storyVaultDir with a notes-looking file (lore/world-notes.md).
    // Pre-SKY-72: this file would appear in the Notes panel (wrong root).
    // Post-SKY-72: this file must NOT appear in the Notes panel.
    const loreDir = path.join(vaultDir, STORY_SEED_DIR);
    fs.mkdirSync(loreDir, { recursive: true });
    fs.writeFileSync(
      path.join(loreDir, STORY_SEED_FILE),
      `---\ntitle: "World Notes"\ncreatedAt: ${new Date().toISOString()}\n---\n\nWorld lore seeded in storyVaultDir.\n`,
    );

    // Seed notesVaultDir with characters/alice.md.
    // Post-SKY-72: this file must appear in the Notes panel.
    const charDir = path.join(notesVaultDir, NOTES_SEED_DIR);
    fs.mkdirSync(charDir, { recursive: true });
    fs.writeFileSync(
      path.join(charDir, NOTES_SEED_FILE),
      `---\ntitle: "Alice"\ncreatedAt: ${new Date().toISOString()}\n---\n\nCharacter note seeded in notesVaultDir.\n`,
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

  // ─── TC-SKY84-01: Listing separation ──────────────────────────────────────

  test('TC-SKY84-01: Notes panel shows characters/alice from notesVaultDir, not lore/world from storyVaultDir', async () => {
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await openVaultTab(page);

    // Switch to Notes scope for a clean view of the Notes panel.
    await page.locator('[data-testid="vb-scope-notes"]').click();
    await expect(page.locator('[data-testid="vb-scope-notes"]')).toHaveAttribute('aria-pressed', 'true');

    const notesPanel = page.locator('[data-testid="vb-notes-vault"]');
    await expect(notesPanel).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('.vb-loading')).not.toBeVisible({ timeout: 8_000 });

    // Post-SKY-72: characters/alice.md (from notesVaultDir) must be visible.
    await expect(
      notesPanel.locator(`[data-testid="vb-row-${NOTES_SEED_DIR}/${NOTES_SEED_FILE}"]`),
    ).toBeVisible({ timeout: 8_000 });

    // Post-SKY-72: lore/world-notes.md (from storyVaultDir) must NOT be visible.
    // Its presence would indicate the Notes panel is incorrectly reading storyVaultDir.
    await expect(
      notesPanel.locator(`[data-testid="vb-row-${STORY_SEED_DIR}/${STORY_SEED_FILE}"]`),
    ).not.toBeVisible({ timeout: 4_000 });

    // StoryVault panel in Story scope should not expose notesVaultDir content.
    await page.locator('[data-testid="vb-scope-story"]').click();
    await expect(page.locator('[data-testid="vb-scope-story"]')).toHaveAttribute('aria-pressed', 'true');

    const storyPanel = page.locator('[data-testid="vb-story-vault"]');
    await expect(storyPanel).toBeVisible({ timeout: 4_000 });

    // Characters/alice is from notesVaultDir — must not appear in Story panel.
    await expect(
      storyPanel.locator('[data-testid^="vb-row-"]', { hasText: 'alice' }),
    ).not.toBeVisible({ timeout: 4_000 });

    // Restore scope.
    await page.locator('[data-testid="vb-scope-both"]').click();
  });

  // ─── TC-SKY84-04: Story write isolation ───────────────────────────────────

  test('TC-SKY84-04: creating a story+scene writes to storyVaultDir; notesVaultDir not touched', async () => {
    await openVaultTab(page);

    // Create story via Story Vault panel.
    const storyPanel = page.locator('[data-testid="vb-story-vault"]');
    await expect(storyPanel).toBeVisible({ timeout: 6_000 });

    await storyPanel.locator('[aria-label="New Story"]').click();
    await fillPrompt(page, STORY_TITLE);

    await expect(
      storyPanel.locator('.vb-name', { hasText: STORY_TITLE }),
    ).toBeVisible({ timeout: 8_000 });

    // Expand the story and create a chapter.
    await storyPanel.locator('.vb-tree-toggle', { hasText: STORY_TITLE }).click();
    await storyPanel.locator(`[aria-label="New chapter in ${STORY_TITLE}"]`).click();
    await fillPrompt(page, CHAPTER_TITLE);

    await expect(
      storyPanel.locator('.vb-name', { hasText: CHAPTER_TITLE }),
    ).toBeVisible({ timeout: 6_000 });

    // Expand the chapter and create a scene.
    await storyPanel.locator('.vb-tree-toggle', { hasText: CHAPTER_TITLE }).click();
    await storyPanel.locator(`[aria-label="New scene in ${CHAPTER_TITLE}"]`).click();
    await fillPrompt(page, SCENE_TITLE);

    await expect(
      storyPanel.locator('.vb-scene-row .vb-name', { hasText: SCENE_TITLE }),
    ).toBeVisible({ timeout: 6_000 });

    // Scene .md file must land under storyVaultDir/stories/.../scenes/.
    const sceneInStoryVault = await waitUntil(() => {
      const files = findAllFiles(vaultDir);
      return files.some((f) => f.includes(`${path.sep}scenes${path.sep}`) && f.endsWith('.md'));
    }, 10_000);
    expect(
      sceneInStoryVault,
      'Scene .md file not found under .../scenes/ in storyVaultDir',
    ).toBe(true);

    // notesVaultDir must have only what was seeded (characters/alice.md).
    // A scene ending up in notesVaultDir would indicate an SKY-75-style routing bug.
    const notesFiles = findAllFiles(notesVaultDir);
    const unexpectedInNotes = notesFiles.filter(
      (f) => !f.includes(path.join(NOTES_SEED_DIR, NOTES_SEED_FILE)),
    );
    expect(
      unexpectedInNotes,
      `Unexpected files written to notesVaultDir by story creation: ${unexpectedInNotes.join(', ')}`,
    ).toHaveLength(0);
  });

  // ─── TC-SKY84-03: Note write isolation ────────────────────────────────────

  test('TC-SKY84-03: creating a note via NotesVault panel writes to notesVaultDir, not storyVaultDir', async () => {
    await openVaultTab(page);

    // Switch to Notes scope to use only the Notes panel.
    await page.locator('[data-testid="vb-scope-notes"]').click();
    await expect(page.locator('[data-testid="vb-scope-notes"]')).toHaveAttribute('aria-pressed', 'true');

    const notesPanel = page.locator('[data-testid="vb-notes-vault"]');
    await expect(notesPanel).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('.vb-loading')).not.toBeVisible({ timeout: 8_000 });

    // Record storyVaultDir file count before the note creation.
    const storyFilesBefore = findAllFiles(vaultDir).filter((f) => f.endsWith('.md')).length;

    // Click "New Note" — triggers window.prompt() (native dialog).
    const dialogPromise = page.waitForEvent('dialog', { timeout: 6_000 });
    await notesPanel.locator('[aria-label="New Note"]').click();
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe('prompt');
    await dialog.accept(NEW_NOTE_NAME);

    // Wait for the new note file to appear in notesVaultDir.
    const noteInNotesVault = await waitUntil(() => {
      return findAllFiles(notesVaultDir).some(
        (f) => f.endsWith('.md') && path.basename(f).startsWith(NEW_NOTE_NAME),
      );
    }, 10_000);
    expect(
      noteInNotesVault,
      `Note "${NEW_NOTE_NAME}.md" not found in notesVaultDir — was it routed to storyVaultDir instead?`,
    ).toBe(true);

    // storyVaultDir must NOT have gained a new .md file for this note.
    const storyFilesAfter = findAllFiles(vaultDir).filter((f) => f.endsWith('.md')).length;
    const noteAlsoInStoryVault = findAllFiles(vaultDir).some(
      (f) => f.endsWith('.md') && path.basename(f).startsWith(NEW_NOTE_NAME),
    );
    expect(
      noteAlsoInStoryVault,
      `Note "${NEW_NOTE_NAME}.md" was incorrectly written to storyVaultDir (SKY-75 regression)`,
    ).toBe(false);
    // Sanity: story file count should be unchanged (no extra .md files created).
    expect(
      storyFilesAfter,
      `storyVaultDir gained unexpected .md files during note creation (before: ${storyFilesBefore}, after: ${storyFilesAfter})`,
    ).toBe(storyFilesBefore);

    // Restore scope.
    await page.locator('[data-testid="vb-scope-both"]').click();
  });
});
