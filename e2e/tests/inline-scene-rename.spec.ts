/**
 * inline-scene-rename.spec.ts — SKY-115, updated for SKY-9022/M6
 *
 * E2E regression coverage for inline scene rename feature (Story Vault).
 *
 * SKY-9022/M6 removed the old panel-stack system entirely, including the
 * unlocked (Story/Notes/Both scope) VaultBrowser that used to live in the
 * Story Writer sidebar's "vault" panel. Per the M6 spec
 * (plans/fidelity-rebuild/PLAN.md §M6: "Vault Browser's function = the Notes
 * workspace sidebar, which is its one home"), that story-side tree —
 * `vb-story-vault`, `vb-scope-*`, and double-click-to-rename via
 * `.vb-rename-input` — has no replacement UI. Story/chapter/scene creation
 * now happens via StoryNavigator (`frontend/src/StoryNavigator.tsx`), and
 * renaming a scene/chapter/story now happens inside the editor itself
 * (`ManuscriptView`'s `onRenameScene`/`onRenameChapter`/`onRenameStory`,
 * wired in DesktopShell.tsx) — there is no tree-based double-click rename
 * for the Story side anymore, and currently no e2e coverage of the new
 * editor-based rename either.
 *
 * The Setup test below was rewritten to build its story/chapter/scene
 * fixture through StoryNavigator instead of the dead VaultBrowser tree. The
 * TC-ISR-* cases test a UI surface (`.vb-rename-input` on `vb-story-vault`
 * rows) that no longer exists anywhere in the app, so they're skipped rather
 * than deleted — this keeps the coverage gap visible/traceable instead of
 * silently dropping it. Follow-up: SKY-9022 M6 replacement — add e2e
 * coverage for the new editor-based rename flow.
 *
 * Original test cases (now skipped, see above):
 *   TC-ISR-01  Double-click scene → inline input appears with name pre-filled
 *   TC-ISR-02  Type new name in input → input accepts the text value
 *   TC-ISR-03  Press Escape during rename → cancels edit and reverts name
 *   TC-ISR-04  Submit empty name → shows validation error
 *   TC-ISR-05  Rename input receives autofocus when opened
 *   TC-ISR-06  Invalid characters (e.g., /) trigger validation error
 *   Setup      Create story, chapter, and scene for tests
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
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── Setup: Create story, chapter, and scene for rename tests ─────────────────

test('Setup: Create story, chapter, and scene', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Create story via StoryNavigator (replaces the dead VaultBrowser story
  // tree). M3 instant-create: no prompt — story appears immediately as
  // "Untitled Story" (single story in this vault, so match positionally).
  await page.locator('.lr-nav-add').first().click();
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Create chapter
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);
  const chapterRow = page.locator('.nav-chapter-row', { hasText: CHAPTER_TITLE });
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  // Create scene
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);

  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
});

// ─── TC-ISR-01..06: SKIPPED — SKY-9022/M6 ────────────────────────────────────
//
// These cases test the old VaultBrowser story-side tree's double-click
// inline-rename (`.vb-rename-input` on `vb-story-vault` rows), which SKY-9022
// M6 removed with no direct replacement (renaming now happens in the editor
// via onRenameScene/onRenameChapter/onRenameStory — see DesktopShell.tsx).
// Skipped rather than deleted so this coverage gap stays visible/traceable.
// Follow-up: add e2e coverage for the new editor-based rename flow.

test.skip('TC-ISR-01: double-click scene node shows inline input with name pre-filled', async () => {
  // See SKY-9022/M6 skip note above — .vb-story-vault / .vb-rename-input no longer exist.
});

test.skip('TC-ISR-02: typing in rename input updates the input value', async () => {
  // See SKY-9022/M6 skip note above.
});

test.skip('TC-ISR-03: press Escape during rename cancels edit and reverts name', async () => {
  // See SKY-9022/M6 skip note above.
});

test.skip('TC-ISR-04: submit empty name shows error message', async () => {
  // See SKY-9022/M6 skip note above.
});

test.skip('TC-ISR-05: rename input receives autofocus when opened', async () => {
  // See SKY-9022/M6 skip note above.
});

test.skip('TC-ISR-06: rename validator rejects invalid characters', async () => {
  // See SKY-9022/M6 skip note above.
});

