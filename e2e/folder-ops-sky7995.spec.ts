/**
 * folder-ops-sky7995.spec.ts — SKY-7995
 *
 * Obsidian-parity folder operations in the Notes Vault tree. Runs against the
 * real packaged Electron app + real filesystem (no mocked window.api) — the
 * IPC dir-safe join fix (safeVaultEntryIpcJoin) and moveVaultFile/deleteVaultFile
 * dir support only prove out end-to-end through the actual renderer→main→fs path.
 *
 * Coverage:
 *   FO-01  Create folder                — toolbar "New folder" → dir on disk
 *   FO-02  Nest a note inside a folder   — "New note" from a folder's context menu
 *   FO-03  Drag a note INTO a folder     — dir-safe move, file relocated on disk
 *   FO-04  Drag a note OUT to vault root — root drop zone, file relocated on disk
 *   FO-05  Rename a folder               — inline rename, dir renamed on disk incl. contents
 *   FO-06  Delete a folder (with contents) — item-count confirm, recursive delete on disk
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/folder-ops-sky7995.spec.ts --reporter=list
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
  type ElementHandle,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

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
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
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

// SKY-7995: useTreeState auto-expands every folder on first mount (its
// initExpand seed), so a folder row may already be expanded before a test
// ever clicks it — an unconditional click would collapse it instead.
async function ensureExpanded(pg: Page, rowTestId: string): Promise<void> {
  const row = pg.locator(`[data-testid="${rowTestId}"]`);
  const expanded = await row.getAttribute('aria-expanded');
  if (expanded !== 'true') await row.click();
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Simulate HTML5 drag-and-drop between two tree rows by dispatching the exact
 * DOM events VirtualTree's row handlers listen for (dragstart/dragover/drop),
 * with a real DataTransfer carrying the dragged row's path. This exercises the
 * real VirtualTree/NotesVault/IPC/fs code path — mouse-based Playwright dragTo()
 * is documented elsewhere in this suite (brainstorm-wave33.spec.ts) as unreliable
 * against Electron's headless renderer, since the browser never establishes
 * native OS-level drag state without a real display server driving it.
 */
async function simulateRowDrag(from: ElementHandle, to: ElementHandle): Promise<void> {
  const fromPath = await from.evaluate(
    (el) => (el as HTMLElement).dataset.testid?.replace('vb-row-', '') ?? '',
  );
  await from.evaluate((el, p) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', p);
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  }, fromPath);
  await to.evaluate((el, p) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', p);
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, fromPath);
  await from.evaluate((el) => el.dispatchEvent(new DragEvent('dragend', { bubbles: true })));
}

/** Drop a dragged row onto the root drop zone (move-to-root). */
async function simulateDropToRoot(page: Page, from: ElementHandle): Promise<void> {
  const fromPath = await from.evaluate((el) => (el as HTMLElement).dataset.testid?.replace('vb-row-', '') ?? '');
  await from.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', (el as HTMLElement).dataset.testid?.replace('vb-row-', '') ?? '');
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  });
  const rootZone = page.locator('[data-testid="vb-root-drop-zone"]');
  await rootZone.waitFor({ state: 'visible', timeout: 6_000 });
  await rootZone.evaluate((el, p) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', p);
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, fromPath);
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-folder-ops-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-vault-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Auto-accept window.confirm()/window.prompt() dialogs; each test that needs
  // a specific prompt answer overrides this handler for the duration of its call.
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  const vaultPanel = page.locator('[data-panel-id="vault"]');
  const collapsed = await vaultPanel.evaluate((el) => el.classList.contains('lr-panel--collapsed'));
  if (collapsed) await vaultPanel.locator('.lr-panel-collapse-btn').click();
  await page.locator('[data-testid="vb-scope-notes"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

/**
 * Fill and confirm the app's in-renderer text-prompt modal (useTextPrompt) —
 * VaultBrowser's "New folder" flow uses this instead of window.prompt(),
 * which Electron's renderer does not support ("prompt() is not supported").
 */
async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

// ─── FO-01: Create folder ────────────────────────────────────────────────────

test('FO-01: New Folder toolbar button creates a directory on disk', async () => {
  await page.locator('[data-testid="vb-btn-new-folder"]').click();
  await fillPrompt(page, 'Worldbuilding');
  await expect(page.locator('[data-testid="vb-row-Worldbuilding"]')).toBeVisible({ timeout: 8_000 });
  const found = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'Worldbuilding')) &&
    fs.statSync(path.join(notesVaultDir, 'Worldbuilding')).isDirectory());
  expect(found, 'Worldbuilding directory not created on disk').toBe(true);
});

// ─── FO-02: Nest a note inside the folder ────────────────────────────────────

test('FO-02: New Note from a folder context menu nests the note inside it', async () => {
  await page.locator('[data-testid="vb-row-Worldbuilding"]').click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-new-note"]').click();
  const dialog = page.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill('Pantheon');
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });

  const found = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'Worldbuilding', 'pantheon.md')));
  expect(found, 'pantheon.md not nested under Worldbuilding/ on disk').toBe(true);

  // Expand the folder in the tree to confirm the child row renders.
  await ensureExpanded(page, 'vb-row-Worldbuilding');
  await expect(page.locator('[data-testid="vb-row-Worldbuilding/pantheon.md"]')).toBeVisible({ timeout: 8_000 });
});

// ─── FO-01b: Second folder + root note, fixtures for drag tests ─────────────

test('FO-01b: create a second folder and a root-level note for drag fixtures', async () => {
  await page.locator('[data-testid="vb-btn-new-folder"]').click();
  await fillPrompt(page, 'Archive');
  await expect(page.locator('[data-testid="vb-row-Archive"]')).toBeVisible({ timeout: 8_000 });

  await page.locator('[data-testid="vb-btn-new-note"]').click();
  const dialog = page.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill('Loose Note');
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });
  const found = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'loose-note.md')));
  expect(found, 'loose-note.md not created at vault root').toBe(true);
});

// ─── FO-03: Drag a note INTO a folder ────────────────────────────────────────

test('FO-03: dragging a root note onto a folder moves it in (dir-safe IPC move)', async () => {
  const from = await page.locator('[data-testid="vb-row-loose-note.md"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Archive"]').elementHandle();
  expect(from, 'source row not found').toBeTruthy();
  expect(to, 'target folder row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'loose-note.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'loose-note.md')),
  );
  expect(moved, 'loose-note.md was not moved into Archive/ on disk').toBe(true);
});

// ─── FO-04: Drag a note OUT to the vault root ────────────────────────────────

test('FO-04: dragging a nested note to the root drop zone moves it back out', async () => {
  await ensureExpanded(page, 'vb-row-Archive');
  await expect(page.locator('[data-testid="vb-row-Archive/loose-note.md"]')).toBeVisible({ timeout: 8_000 });

  const from = await page.locator('[data-testid="vb-row-Archive/loose-note.md"]').elementHandle();
  expect(from, 'nested row not found').toBeTruthy();
  await simulateDropToRoot(page, from!);

  const movedOut = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'loose-note.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Archive', 'loose-note.md')),
  );
  expect(movedOut, 'loose-note.md was not moved back to vault root').toBe(true);
});

// ─── FO-05: Rename a folder ──────────────────────────────────────────────────

test('FO-05: renaming a folder renames the directory on disk, contents intact', async () => {
  await page.locator('[data-testid="vb-row-Worldbuilding"]').dblclick();
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill('Cosmology');
  await input.press('Enter');

  const renamed = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Cosmology', 'pantheon.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Worldbuilding')),
  );
  expect(renamed, 'Worldbuilding/ was not renamed to Cosmology/ with contents intact').toBe(true);
  await expect(page.locator('[data-testid="vb-row-Cosmology"]')).toBeVisible({ timeout: 8_000 });
});

// ─── FO-06: Delete a folder with contents ────────────────────────────────────

test('FO-06: deleting a folder recursively removes it and its contents on disk', async () => {
  await page.locator('[data-testid="vb-row-Cosmology"]').click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-delete"]').click();

  const deleted = await waitUntil(() => !fs.existsSync(path.join(notesVaultDir, 'Cosmology')));
  expect(deleted, 'Cosmology/ (and pantheon.md inside it) was not deleted from disk').toBe(true);
  await expect(page.locator('[data-testid="vb-row-Cosmology"]')).toHaveCount(0);
});
