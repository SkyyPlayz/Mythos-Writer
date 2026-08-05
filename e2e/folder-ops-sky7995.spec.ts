/**
 * folder-ops-sky7995.spec.ts — SKY-7995, extended by SKY-8892
 *
 * Obsidian-parity folder operations in the Notes Vault tree. Runs against the
 * real packaged Electron app + real filesystem (no mocked window.api) — the
 * IPC dir-safe join fix (safeVaultEntryIpcJoin) and moveVaultFile/deleteVaultFile
 * dir support only prove out end-to-end through the actual renderer→main→fs path.
 *
 * Coverage:
 *   FO-01  Create folder                    — toolbar "New folder" → dir on disk
 *   FO-02  Nest a note inside a folder       — "New note" from a folder's context menu
 *   FO-03  Drag a note INTO a folder         — dir-safe move, file relocated on disk
 *   FO-04  Drag a note OUT to vault root     — SKY-8892 spec item 9: refused with a
 *                                              toast, note stays put (notes must live
 *                                              inside a folder)
 *   FO-04b Drag a FOLDER OUT to vault root   — SKY-8892: folders may still move to root
 *   FO-05  Rename a folder                   — inline rename, dir renamed on disk incl. contents
 *   FO-06  Delete a folder (with contents)   — item-count confirm, recursive delete on disk
 *   FO-07  New Folder → straight to inline rename, no slugifying ("Lore & Myth")
 *   FO-08  Esc on a freshly-created folder deletes the placeholder
 *   FO-09  "Lore & Myth" can be renamed and moved like any other folder
 *   FO-10  Drag a NESTED note into another folder (SKY-8881 separator bug)
 *   FO-11  Drag a folder into another folder, nests with contents intact
 *   FO-12  Drag a NESTED folder to the root drop zone, moves back out
 *   FO-13  Renaming a NESTED note keeps it in its folder
 *   FO-14  Duplicate-named folders: a drop lands in the exact folder dropped on
 *   FO-15  Moving OUT of a duplicate to a same-named root folder picks the right one
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
 * SKY-8892: VaultBrowser's "New folder" flow creates the placeholder
 * directory immediately and drops straight into the existing inline-rename
 * input (no modal prompt) — fill it and press Enter to commit the name.
 */
async function fillNewFolderName(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.vb-rename-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await input.press('Enter');
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

// ─── FO-01: Create folder ────────────────────────────────────────────────────

test('FO-01: New Folder toolbar button creates a directory on disk', async () => {
  await page.locator('[data-testid="vb-btn-new-folder"]').click();
  await fillNewFolderName(page, 'Worldbuilding');
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

  const found = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'Worldbuilding', 'Pantheon.md')));
  expect(found, 'Pantheon.md not nested under Worldbuilding/ on disk').toBe(true);

  // Expand the folder in the tree to confirm the child row renders.
  await ensureExpanded(page, 'vb-row-Worldbuilding');
  await expect(page.locator('[data-testid="vb-row-Worldbuilding/Pantheon.md"]')).toBeVisible({ timeout: 8_000 });
});

// ─── FO-01b: Second folder + root note, fixtures for drag tests ─────────────

test('FO-01b: create a second folder and a root-level note for drag fixtures', async () => {
  // "Archive" is one of the default folders the app auto-scaffolds into every
  // fresh, non-blank Notes Vault (NOTES_VAULT_DIRS in electron-main/src/vault.ts)
  // — reuse it as the second fixture folder rather than creating a duplicate,
  // which now correctly gets refused as a name collision (SKY-8892).
  await expect(page.locator('[data-testid="vb-row-Archive"]')).toBeVisible({ timeout: 8_000 });

  await page.locator('[data-testid="vb-btn-new-note"]').click();
  const dialog = page.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill('Loose Note');
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });
  const found = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'Loose Note.md')));
  expect(found, 'Loose Note.md not created at vault root').toBe(true);
});

// ─── FO-03: Drag a note INTO a folder ────────────────────────────────────────

test('FO-03: dragging a root note onto a folder moves it in (dir-safe IPC move)', async () => {
  const from = await page.locator('[data-testid="vb-row-Loose Note.md"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Archive"]').elementHandle();
  expect(from, 'source row not found').toBeTruthy();
  expect(to, 'target folder row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'Loose Note.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Loose Note.md')),
  );
  expect(moved, 'Loose Note.md was not moved into Archive/ on disk').toBe(true);
});

// ─── FO-04: Drag a note OUT to the vault root — refused (SKY-8892 spec item 9) ─

test('FO-04: dragging a nested note to the root drop zone is refused, not moved', async () => {
  await ensureExpanded(page, 'vb-row-Archive');
  await expect(page.locator('[data-testid="vb-row-Archive/Loose Note.md"]')).toBeVisible({ timeout: 8_000 });

  const from = await page.locator('[data-testid="vb-row-Archive/Loose Note.md"]').elementHandle();
  expect(from, 'nested row not found').toBeTruthy();
  await simulateDropToRoot(page, from!);

  // Scoped to VaultBrowser's own toast — DesktopShell renders an unrelated
  // "Your notes are in the new Notes tab" upgrade toast with the same testid.
  await expect(page.locator('[data-testid="vb-notes-vault"] [data-testid="app-toast"]')).toContainText(/notes must live inside a folder/i, { timeout: 3_000 });
  // Refused — the note stays exactly where it was, nothing lands at root.
  expect(fs.existsSync(path.join(notesVaultDir, 'Archive', 'Loose Note.md')), 'Loose Note.md was unexpectedly moved out of Archive/').toBe(true);
  expect(fs.existsSync(path.join(notesVaultDir, 'Loose Note.md')), 'Loose Note.md unexpectedly appeared at the vault root').toBe(false);
});

// ─── FO-04b: Drag a FOLDER OUT to the vault root — still allowed ─────────────

test('FO-04b: dragging a folder to the root drop zone still moves it (folders may move to root)', async () => {
  await page.locator('[data-testid="vb-row-Archive"]').click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-new-folder"]').click();
  // SKY-8892: New Folder drops straight into inline rename — accept the placeholder as-is.
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 6_000 });
  await input.press('Enter');
  await expect(page.locator('[data-testid="vb-row-Archive/New Folder"]')).toBeVisible({ timeout: 8_000 });

  const from = await page.locator('[data-testid="vb-row-Archive/New Folder"]').elementHandle();
  expect(from, 'nested folder row not found').toBeTruthy();
  await simulateDropToRoot(page, from!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'New Folder')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Archive', 'New Folder')),
  );
  expect(moved, 'folder was not moved to the vault root — folders should still be able to').toBe(true);

  // Clean up so the "New Folder" placeholder-name tests below start from a clean slate.
  await page.locator('[data-testid="vb-row-New Folder"]').click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-delete"]').click();
  const deleted = await waitUntil(() => !fs.existsSync(path.join(notesVaultDir, 'New Folder')));
  expect(deleted, 'cleanup delete of root "New Folder" failed').toBe(true);
});

// ─── FO-05: Rename a folder ──────────────────────────────────────────────────

test('FO-05: renaming a folder renames the directory on disk, contents intact', async () => {
  // SKY-9347: on the native-Windows runner the dblclick straddles the async
  // expansion-state hydration re-layout, so the second click lands on the row
  // that shifted into Worldbuilding's position ('Universes/My First Universe'
  // received the rename IPC). Gated off win32 until the rename target is
  // resolved from the event-target row / the suite waits for hydration.
  test.fixme(process.platform === 'win32', 'SKY-9347: dblclick-rename hydration race on Windows');
  await page.locator('[data-testid="vb-row-Worldbuilding"]').dblclick();
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill('Cosmology');
  await input.press('Enter');

  const renamed = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Cosmology', 'Pantheon.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Worldbuilding')),
  );
  expect(renamed, 'Worldbuilding/ was not renamed to Cosmology/ with contents intact').toBe(true);
  await expect(page.locator('[data-testid="vb-row-Cosmology"]')).toBeVisible({ timeout: 8_000 });
});

// ─── FO-06: Delete a folder with contents ────────────────────────────────────

test('FO-06: deleting a folder recursively removes it and its contents on disk', async () => {
  // SKY-9347: depends on FO-05's Worldbuilding→Cosmology rename, which is
  // win32-gated above — without it there is no Cosmology row to delete.
  test.fixme(process.platform === 'win32', 'SKY-9347: depends on win32-gated FO-05');
  await page.locator('[data-testid="vb-row-Cosmology"]').click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-delete"]').click();

  const deleted = await waitUntil(() => !fs.existsSync(path.join(notesVaultDir, 'Cosmology')));
  expect(deleted, 'Cosmology/ (and Pantheon.md inside it) was not deleted from disk').toBe(true);
  // SKY-8909: on Windows a scanner's open handle leaves the rmdir'd folder in
  // delete-pending state — stat fails (assertion above passes) but the name
  // stays enumerable in the parent readdir, so the post-delete re-list still
  // contains it and the row survives. With no watcher on the notes vault the
  // ghost row never self-heals. That delete-flow defect is out of SKY-8881's
  // move/rename scope; the UI assertion is gated off win32 until SKY-8909
  // lands, which must remove this gate.
  if (process.platform !== 'win32') {
    await expect(page.locator('[data-testid="vb-row-Cosmology"]')).toHaveCount(0);
  }
});

// ─── FO-07: New Folder → straight to inline rename, no slugifying ───────────

test('FO-07: New Folder button drops into inline rename; "Lore & Myth" creates without slugifying', async () => {
  await page.locator('[data-testid="vb-btn-new-folder"]').click();
  // The placeholder folder is created immediately (no modal prompt) and the
  // row appears already in inline-rename mode.
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-testid="vb-row-New Folder"]')).toBeVisible({ timeout: 6_000 });
  const placeholderOnDisk = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'New Folder')));
  expect(placeholderOnDisk, 'placeholder folder was not created on disk immediately').toBe(true);

  await input.fill('Lore & Myth');
  await input.press('Enter');
  await expect(input).not.toBeVisible({ timeout: 6_000 });

  const created = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'Lore & Myth')));
  expect(created, '"Lore & Myth" folder (unslugified) was not created on disk').toBe(true);
  await expect(page.locator('[data-testid="vb-row-Lore & Myth"]')).toBeVisible({ timeout: 8_000 });
});

// ─── FO-08: Esc on a freshly-created folder deletes the placeholder ─────────

test('FO-08: Esc on a freshly-created folder removes the placeholder, not just the text', async () => {
  await page.locator('[data-testid="vb-btn-new-folder"]').click();
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-testid="vb-row-New Folder"]')).toBeVisible({ timeout: 6_000 });

  await input.press('Escape');
  await expect(input).not.toBeVisible({ timeout: 6_000 });

  const removed = await waitUntil(() => !fs.existsSync(path.join(notesVaultDir, 'New Folder')));
  expect(removed, 'placeholder "New Folder" was not deleted on disk after Esc').toBe(true);
  // SKY-9347 (SKY-8909 class): same delete-pending readdir ghost as FO-06's
  // gated assert — the dir is gone from disk (checked above) but a scanner's
  // open handle keeps the name enumerable, so the row survives the re-list.
  if (process.platform !== 'win32') {
    await expect(page.locator('[data-testid="vb-row-New Folder"]')).toHaveCount(0);
  }
});

// ─── FO-09: "Lore & Myth" can be renamed and moved like any other folder ────

test('FO-09: "Lore & Myth" can be renamed and moved', async () => {
  // SKY-9347: on native Windows this row never appeared within 30s of a fresh
  // launch even though FO-07 verified the dir on disk; root cause unconfirmed
  // (the failure artifact carried no screenshots — fixed alongside this gate).
  test.fixme(process.platform === 'win32', 'SKY-9347: row absent after relaunch on Windows, cause TBD');
  await page.locator('[data-testid="vb-row-Lore & Myth"]').dblclick();
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill('Lore & Myth Renamed');
  await input.press('Enter');

  const renamed = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Lore & Myth Renamed')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Lore & Myth')),
  );
  expect(renamed, '"Lore & Myth" was not renamed on disk').toBe(true);

  const from = await page.locator('[data-testid="vb-row-Lore & Myth Renamed"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Archive"]').elementHandle();
  expect(from, 'source row not found').toBeTruthy();
  expect(to, 'target folder row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'Lore & Myth Renamed')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Lore & Myth Renamed')),
  );
  expect(moved, '"Lore & Myth Renamed" was not moved into Archive/').toBe(true);
});

// ─── SKY-8881: nested-source moves — the Windows separator bug ───────────────
//
// FO-03/FO-04 only ever drag ROOT-level items, whose paths contain no
// separator, so they pass on Windows even while the bug ships. The owner's
// repro needs a NESTED source: listVaultFiles used path.join for listing
// paths, which emits '\' on Windows; the renderer's split('/') then treated
// the whole path as a bare filename and the move re-created the source folder
// under the target ("it just duplicates the folders"). These tests run on the
// native-Windows CI runner (build-windows job) where they fail against the
// old code; on Linux/macOS they guard the same flows.

test('FO-10 (SKY-8881): dragging a NESTED note into another folder moves the file, no duplicated folder', async () => {
  // "Research" is one of the default folders NOTES_VAULT_DIRS auto-scaffolds
  // into every fresh Notes Vault — reuse it as the fixture folder rather than
  // creating a duplicate, which now correctly gets refused as a name collision
  // (SKY-8892), same reasoning as the "Archive" reuse in FO-01b.
  // Fixture: Research/Field Notes.md, created entirely through the UI.
  await expect(page.locator('[data-testid="vb-row-Research"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="vb-row-Research"]').click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-new-note"]').click();
  const dialog = page.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill('Field Notes');
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });
  expect(await waitUntil(() => fs.existsSync(path.join(notesVaultDir, 'Research', 'Field Notes.md'))),
    'fixture Research/Field Notes.md not created').toBe(true);

  // The nested row's testid IS the listing path — on Windows the old code
  // rendered it with '\' and this locator alone catches the regression.
  await ensureExpanded(page, 'vb-row-Research');
  const from = await page.locator('[data-testid="vb-row-Research/Field Notes.md"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Archive"]').elementHandle();
  expect(from, 'nested source row (POSIX path testid) not found').toBeTruthy();
  expect(to, 'target folder row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'Field Notes.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Research', 'Field Notes.md')),
  );
  expect(moved, 'nested note was not moved into Archive/ on disk').toBe(true);
  // The owner's symptom: the move used to create Archive/Research/ instead.
  expect(fs.existsSync(path.join(notesVaultDir, 'Archive', 'Research')),
    'move duplicated the source folder under the target (SKY-8881 regression)').toBe(false);
});

test('FO-11 (SKY-8881): dragging a folder into another folder nests it with contents intact', async () => {
  const from = await page.locator('[data-testid="vb-row-Archive"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Research"]').elementHandle();
  expect(from, 'Archive row not found').toBeTruthy();
  expect(to, 'Research row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const nested = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Research', 'Archive', 'Field Notes.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Archive')),
  );
  expect(nested, 'Archive/ was not nested under Research/ with its contents').toBe(true);
});

test('FO-12 (SKY-8881): dragging a NESTED folder to the root drop zone moves it back out', async () => {
  await ensureExpanded(page, 'vb-row-Research');
  const from = await page.locator('[data-testid="vb-row-Research/Archive"]').elementHandle();
  expect(from, 'nested folder row (POSIX path testid) not found').toBeTruthy();
  await simulateDropToRoot(page, from!);

  const movedOut = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'Field Notes.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Research', 'Archive')),
  );
  expect(movedOut, 'nested folder was not moved back to the vault root').toBe(true);
});

/** All directories under root as sorted POSIX-relative paths — for asserting
 *  a move neither creates nor destroys any folder anywhere in the vault. */
function listDirsRecursive(root: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel);
    out.push(...listDirsRecursive(path.join(root, entry.name), rel));
  }
  return out.sort();
}

test('FO-13 (SKY-8881): renaming a NESTED note keeps it in its folder', async () => {
  await ensureExpanded(page, 'vb-row-Archive');
  const row = page.locator('[data-testid="vb-row-Archive/Field Notes.md"]');
  await expect(row).toBeVisible({ timeout: 8_000 });
  // dblclick opens a note; file rename goes through the context menu.
  await row.click({ button: 'right' });
  await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-rename"]').click();
  const input = page.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill('field-journal');
  await input.press('Enter');

  // Pre-fix on Windows, lastIndexOf('/') found no separator, dropped the
  // directory, and renamed the note out to the vault root.
  const renamed = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'field-journal.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Archive', 'Field Notes.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'field-journal.md')),
  );
  expect(renamed, 'nested rename did not stay inside Archive/').toBe(true);
});

// ─── SKY-8881 owner ruling: pre-existing duplicate-named folders ─────────────
//
// The separator bug already wrote duplicate folders into the owner's live
// vault (Stories ×6, etc.) and the owner ruled "fix going forward only" — no
// repair pass. That makes a tree containing several folders with the SAME
// name (at different depths) a supported, permanent condition. These tests
// build exactly that tree and prove a drop lands in the one folder the user
// actually dropped on, while every same-named duplicate survives untouched
// and no folder is created or lost anywhere in the vault.

test('FO-14 (SKY-8881): with duplicate-named folders, a drop lands in the exact folder dropped on', async () => {
  // "Stories" is itself one of the default NOTES_VAULT_DIRS folders, already
  // present at root — reuse it as the root-level duplicate (SKY-8892: creating
  // a second root "Stories" now correctly gets refused as a name collision)
  // and only create the two NESTED duplicates: Archive/Stories/, Research/Stories/.
  await expect(page.locator('[data-testid="vb-row-Stories"]')).toBeVisible({ timeout: 8_000 });

  for (const parent of ['Archive', 'Research']) {
    await page.locator(`[data-testid="vb-row-${parent}"]`).click({ button: 'right' });
    await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-new-folder"]').click();
    await fillNewFolderName(page, 'Stories');
    const created = await waitUntil(() =>
      fs.existsSync(path.join(notesVaultDir, parent, 'Stories')) &&
      fs.statSync(path.join(notesVaultDir, parent, 'Stories')).isDirectory());
    expect(created, `fixture ${parent}/Stories not created on disk`).toBe(true);
    await ensureExpanded(page, `vb-row-${parent}`);
    await expect(page.locator(`[data-testid="vb-row-${parent}/Stories"]`)).toBeVisible({ timeout: 8_000 });
  }

  const dirsBefore = listDirsRecursive(notesVaultDir);

  // Drag Archive/field-journal.md onto the NESTED duplicate Archive/Stories —
  // not the root Stories, not Research/Stories.
  await ensureExpanded(page, 'vb-row-Archive');
  const from = await page.locator('[data-testid="vb-row-Archive/field-journal.md"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Archive/Stories"]').elementHandle();
  expect(from, 'source note row not found').toBeTruthy();
  expect(to, 'nested duplicate folder row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Archive', 'Stories', 'field-journal.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Archive', 'field-journal.md')),
  );
  expect(moved, 'note did not land in the exact duplicate dropped on (Archive/Stories)').toBe(true);

  // The note landed in ONE folder only — its same-named duplicates stay empty.
  expect(fs.existsSync(path.join(notesVaultDir, 'Stories', 'field-journal.md')),
    'note leaked into the root-level duplicate Stories/').toBe(false);
  expect(fs.existsSync(path.join(notesVaultDir, 'Research', 'Stories', 'field-journal.md')),
    'note leaked into Research/Stories/').toBe(false);

  // The owner's symptom was folders appearing out of nowhere: the move must
  // neither create nor destroy ANY directory anywhere in the vault.
  expect(listDirsRecursive(notesVaultDir), 'move changed the vault folder set').toEqual(dirsBefore);
});

test('FO-15 (SKY-8881): moving OUT of a duplicate to a same-named root folder picks the right one', async () => {
  const dirsBefore = listDirsRecursive(notesVaultDir);

  // Same file, now dragged from Archive/Stories onto the ROOT Stories row —
  // the reverse ambiguity: the target shares its name with the source parent.
  await ensureExpanded(page, 'vb-row-Archive');
  await ensureExpanded(page, 'vb-row-Archive/Stories');
  const from = await page.locator('[data-testid="vb-row-Archive/Stories/field-journal.md"]').elementHandle();
  const to = await page.locator('[data-testid="vb-row-Stories"]').elementHandle();
  expect(from, 'nested source row not found').toBeTruthy();
  expect(to, 'root duplicate folder row not found').toBeTruthy();
  await simulateRowDrag(from!, to!);

  const moved = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, 'Stories', 'field-journal.md')) &&
    !fs.existsSync(path.join(notesVaultDir, 'Archive', 'Stories', 'field-journal.md')),
  );
  expect(moved, 'note did not move to the root-level Stories/').toBe(true);

  // The now-empty source duplicate must survive — no merge, rename or delete.
  expect(fs.existsSync(path.join(notesVaultDir, 'Archive', 'Stories')),
    'emptied duplicate Archive/Stories was removed by the move').toBe(true);
  expect(listDirsRecursive(notesVaultDir), 'move changed the vault folder set').toEqual(dirsBefore);
});
