/**
 * first-run-dead-end.spec.ts — SKY-904 (GH#300)
 *
 * Regression coverage for the bug originally reported in GitHub issue #300:
 *   "neither the new story button, or the + button worked, [and I] could only
 *    type in chat boxes, not the main writing section."
 *
 * Root cause was already fixed by:
 *   • SKY-316 — auto-open editor after scene creation so the main writing
 *     section becomes interactive on a fresh story.
 *   • SKY-317 — render a "New Story" CTA in the StoryNavigator empty state
 *     and in the DesktopShell welcome screen so the empty vault is never
 *     a dead end.
 *
 * This spec pins those fixes with first-class E2E assertions so a future
 * refactor can't silently regress the GH#300 path. It boots Electron with
 * an empty vault (`layoutMode: 'blank'`, so no `My First Story` is seeded)
 * and walks the exact controls a first-run user would touch.
 *
 * Coverage:
 *   TC-300-01  nav-empty-cta button (StoryNavigator empty state) creates story
 *   TC-300-02  shell-empty-new-story button (welcome screen) creates story
 *   TC-300-03  End-to-end: empty vault → CTA → first story → chapter → scene
 *              auto-opens the main editor → typed prose persists on reload.
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Seed userData so the app boots straight into DesktopShell with an EMPTY
 * Story Vault. `layoutMode: 'blank'` instructs the main process to skip the
 * "My First Story" scaffold, so `stories.length === 0` and the empty-state
 * CTAs are the only path to create a story.
 */
function seedEmptyVaultUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
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
    layoutMode: 'blank',
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
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

/**
 * M3 (SKY-9021): wait for the caret to land in the just-created story's
 * paragraph contenteditable — the passive signal that the instant-create
 * transaction (story + Chapter 1 + Untitled Scene) has finished. Story
 * creation no longer opens a prompt modal; every entry point runs this
 * transaction directly.
 */
async function waitForWriterCaret(pg: Page): Promise<void> {
  await pg.waitForFunction(
    () => (document.activeElement?.getAttribute('data-testid') ?? '').startsWith('msv-para-'),
    undefined,
    { timeout: 20_000 },
  );
}

/** Rename the just-created story in place via the Story Writer's scope title. */
async function renameStoryTitle(pg: Page, newTitle: string): Promise<void> {
  const scopeTitle = pg.locator('[data-testid="msv-scope-title"]');
  await expect(scopeTitle).toBeVisible({ timeout: 10_000 });
  await scopeTitle.click();
  await pg.keyboard.press('ControlOrMeta+a');
  await pg.keyboard.type(newTitle);
  await pg.keyboard.press('Enter');
}

/** Recursively collect all *.md files under `dir`. */
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

/**
 * Wait for the Stories tab to be active. Defaults boot into the Vault tab in
 * some configurations; if the rail tab labeled "Stories" is visible, click it
 * before exercising the StoryNavigator empty state.
 */
async function ensureStoriesTab(pg: Page): Promise<void> {
  // SKY-1694: Story Navigator is now a panel in the left sidebar panel zone.
  // If the panel is collapsed, expand it. No-op if already expanded.
  const storiesPanel = pg.locator('[data-panel-id="stories"]');
  if (await storiesPanel.isVisible().catch(() => false)) {
    const isCollapsed = await storiesPanel.evaluate((el) => el.classList.contains('lr-panel--collapsed')).catch(() => false);
    if (isCollapsed) await storiesPanel.locator('.lr-panel-collapse-btn').click();
  }
  // Legacy guard: old .rail-tab click (no-op if element absent)
  const storiesTab = pg.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible().catch(() => false)) await storiesTab.click();
}

// ─── Suite state ──────────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-firstrun-deadend-ud-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-firstrun-deadend-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-firstrun-deadend-notes-'));
  seedEmptyVaultUserData(userData, vaultDir, notesVaultDir);
});

test.afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-300-01: nav-empty-cta unblocks the empty StoryNavigator ──────────────

test('TC-300-01: clicking nav-empty-cta in empty StoryNavigator creates a story instantly', async () => {
  app = await launchApp(userData);
  const page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await ensureStoriesTab(page);

  // SKY-317: empty-state CTA must be present and clickable.
  const cta = page.locator('[data-testid="nav-empty-cta"]');
  await expect(cta).toBeVisible({ timeout: 6_000 });
  await cta.click();

  // M3 (SKY-9021): the CTA now runs the instant-create transaction directly —
  // no prompt modal interposes. Wait for the caret, then inline-rename the
  // auto-created story so the navigator assertion below has a known title.
  await waitForWriterCaret(page);
  await renameStoryTitle(page, 'CTA First Story');

  // Story row appears in the navigator → CTA is no longer a dead end.
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });
  await expect(storyRow).toContainText('CTA First Story');

  // Once at least one story exists the empty-state CTA must disappear so the
  // navigator does not show a stale "No stories yet" panel.
  await expect(cta).toHaveCount(0);
});

// ─── TC-300-02: shell-empty-new-story unblocks the welcome screen ────────────

test('TC-300-02: clicking shell-empty-new-story in welcome screen creates a story instantly', async () => {
  app = await launchApp(userData);
  const page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // The welcome screen renders in the editor pane whenever no scene is selected
  // and there are zero stories — i.e. the exact first-run state from GH#300.
  await expect(page.locator('.shell-editor-empty')).toBeVisible({ timeout: 8_000 });

  const welcomeCta = page.locator('[data-testid="shell-empty-new-story"]');
  await expect(welcomeCta).toBeVisible({ timeout: 6_000 });
  await welcomeCta.click();

  // M3 (SKY-9021): instant-create — no prompt modal. Wait for the caret, then
  // inline-rename the auto-created story.
  await waitForWriterCaret(page);
  await renameStoryTitle(page, 'Welcome CTA Story');

  // Story appears in the navigator and the welcome empty state is replaced.
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });
  await expect(storyRow).toContainText('Welcome CTA Story');
});

// ─── TC-300-03: End-to-end first-run path is fully unblocked ─────────────────

test('TC-300-03: first-run CTA → instant scaffold auto-opens editor → typed prose persists on reload', async () => {
  const PROSE = 'The dead end gave way; the page accepted ink at last.';

  // ── First boot — empty vault → CTA → instant story+chapter+scene → type ──
  app = await launchApp(userData);
  let page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await ensureStoriesTab(page);

  // Use the StoryNavigator empty-state CTA as the entry point. The welcome
  // screen CTA is covered separately by TC-300-02; sharing all three controls
  // in a single chain would not add coverage beyond the standalone test.
  await page.locator('[data-testid="nav-empty-cta"]').click();

  // M3 (SKY-9021): the CTA instantly scaffolds story + Chapter 1 + Untitled
  // Scene in one transaction and auto-opens the editor with the caret placed
  // — this is the SKY-316 "auto-open" fix, now exercised by every entry point.
  // The "main writing section" must accept input with zero extra clicks, so
  // type immediately while the caret from waitForWriterCaret is still live —
  // same order create-story-instant.spec.ts (AC1) uses.
  await waitForWriterCaret(page);
  await page.keyboard.type(PROSE);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // Vault write is debounced; confirm prose reaches disk.
  const proseInFile = await waitUntil(() => {
    const files = findMdFiles(vaultDir);
    return files.some((f) => {
      try { return fs.readFileSync(f, 'utf-8').includes(PROSE); } catch { return false; }
    });
  }, 12_000);
  expect(proseInFile, `Prose "${PROSE}" not found in any Story Vault .md file`).toBe(true);

  // Rename after the prose commit lands (matches create-story-instant.spec.ts's
  // Row-3 rename test, which also renames only after the scene write settles).
  await renameStoryTitle(page, 'GH300 Story');

  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });
  await expect(storyRow).toContainText('GH300 Story');

  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });

  // The rename's own manifest write is debounced too; poll disk so the reload
  // below never races a manifest snapshot that predates it.
  const manifestPath = path.join(vaultDir, 'manifest.json');
  const renameFlushed = await waitUntil(() => {
    try {
      return fs.readFileSync(manifestPath, 'utf-8').includes('GH300 Story');
    } catch {
      return false;
    }
  }, 10_000);
  expect(renameFlushed, 'manifest.json on disk never picked up "GH300 Story"').toBe(true);

  // ── Second boot — same userData → prose persists ──────────────────────────
  await app.close().catch(() => {});
  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await ensureStoriesTab(page);

  // Reopen the scene from disk-backed manifest. Selecting a scene row sets
  // viewDepth to 'scene', which renders the single-scene BlockEditor
  // (tiptap/.ProseMirror) rather than ManuscriptView's inline msv-para
  // paragraphs (Full Book/Part/Chapter depth only) — unaffected by M3.
  const reloadedScene = page.locator('.nav-scene-row').first();
  await expect(reloadedScene).toBeVisible({ timeout: 8_000 });
  await reloadedScene.click();

  const reloadedEditor = page.locator('.ProseMirror');
  await expect(reloadedEditor).toBeVisible({ timeout: 8_000 });
  await expect(reloadedEditor).toContainText(PROSE, { timeout: 8_000 });
});
