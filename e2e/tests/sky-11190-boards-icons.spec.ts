/**
 * sky-11190-boards-icons.spec.ts — SKY-11190 (Notes Board 7/9): Iconize
 * colour parity. Real Electron E2E across the process boundary against a
 * real notes-vault fixture; the icon store (`.mythos/icons.json`) is never
 * pre-seeded for the "setting an icon" coverage — it's created by the app
 * itself through a genuine right-click → picker interaction (§4c). The
 * rename and corrupt-entry cases seed the sidecar directly, since those
 * scenarios are about the store's *content*, not about reachability.
 *
 * Coverage (SKY-11190 ACs):
 *   1. Setting an icon+colour on a folder (via the Boards tile picker) shows
 *      it on the board tile, in the vault tree, and in the board breadcrumb
 *      ("board tree") simultaneously.
 *   2. Renaming a folder with a custom icon preserves the icon (rewritten to
 *      the new path, not lost) — on both surfaces.
 *   3. An icon name outside the picker's known set falls back to the default
 *      folder glyph on both surfaces, with no render error.
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
const ICONS_SIDECAR = path.join('.mythos', 'icons.json');

function writeProfile(userData: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

function mkNote(notesDir: string, rel: string, body = '# Note\n'): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11190-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  writeProfile(userData, storyDir, notesDir);
  return { tempRoot, userData, notesDir };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootToBoards(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
  await boardsBtn.click();
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  return page;
}

async function gotoNotesVaultTree(page: Page): Promise<void> {
  const notesTab = page.locator('button.nav-rail__item[aria-label="Notes Editor"]');
  await notesTab.click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
}

const folderTile = (page: Page, name: string) =>
  page.getByRole('button', { name: `Board: ${name}. Double-click to open.` });

/** Right-click a folder tile, pick a colour swatch, then a glyph — closes the picker. */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env.SKY11190_SCREENSHOTS;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  await expect(page.locator('.app-toast--stacked')).toHaveCount(0, { timeout: 8_000 });
  await page.screenshot({ path: path.join(directory, `${name}.png`) });
}

async function setTileIcon(page: Page, tileName: string, glyph: string, colorLabel: string): Promise<void> {
  await folderTile(page, tileName).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Set icon…', exact: true }).click();
  const overlay = page.locator('.board-icon-picker-overlay');
  await expect(overlay).toBeVisible({ timeout: 5_000 });
  await overlay.locator(`.board-icon-picker-swatch[aria-label="${colorLabel}"]`).click();
  if (tileName === 'Characters') await capture(page, '02-picker');
  await overlay.locator(`.board-icon-picker-cell[title="${glyph}"]`).click();
  await expect(overlay).toBeHidden({ timeout: 5_000 });
}

// ── AC1 — tri-surface: tile, vault tree, board breadcrumb ────────────────────

test('SKY-11190 AC1: setting icon+colour on a folder shows on the tile, vault tree, and board breadcrumb', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('tri-surface');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(folderTile(page, 'Characters')).toBeVisible({ timeout: 8_000 });

    await capture(page, '01-before-icon');
    await setTileIcon(page, 'Characters', 'sword', 'Blue');

    // The store now exists on disk, keyed by the vault-relative path.
    const sidecarPath = path.join(notesDir, ICONS_SIDECAR);
    await expect.poll(() => fs.existsSync(sidecarPath), { timeout: 5_000 }).toBe(true);
    const stored = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    expect(stored['Characters']).toEqual({ icon: 'pack:lucide/sword', color: '#61afef' });

    // Surface 1 — the board tile itself: a lucide <svg> tinted with the chosen colour.
    const tileIconSvg = folderTile(page, 'Characters').locator('.board-canvas__item-icon svg');
    await expect(tileIconSvg).toHaveAttribute('stroke', '#61afef');
    await capture(page, '03-board-tile');

    // The rebased icon layer follows the three LOD tiers without reviving hidden detail.
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(folderTile(page, 'Characters')).toHaveAttribute('data-lod', '2');
    await expect(tileIconSvg).toHaveAttribute('stroke', '#61afef');
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(folderTile(page, 'Characters')).toHaveAttribute('data-lod', '3');
    await expect(folderTile(page, 'Characters').locator('.board-canvas__item-icon')).toHaveCount(0);
    await capture(page, '04-lod-block');
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(tileIconSvg).toHaveAttribute('stroke', '#61afef');

    // Surface 2 — the vault tree (same .mythos/icons.json, read by SKY-9310's tree).
    await gotoNotesVaultTree(page);
    const treeRow = page.locator('[data-testid="vb-row-Characters"]');
    await expect(treeRow).toBeVisible({ timeout: 8_000 });
    await expect(treeRow.locator('.vb-icon svg')).toHaveAttribute('stroke', '#61afef');
    await capture(page, '05-vault-tree');

    // Surface 3 — the board breadcrumb ("board tree") after entering the board.
    await bootToBoards(app); // re-click Boards nav (no reload needed, same window)
    await folderTile(page, 'Characters').dblclick();
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toContainText('Characters', { timeout: 8_000 });
    const crumbIconSvg = page.locator('.boards-tab-panel__breadcrumb-current .boards-tab-panel__breadcrumb-icon svg');
    await expect(crumbIconSvg).toHaveAttribute('stroke', '#61afef');
    await capture(page, '06-board-breadcrumb');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC2 — rename preserves the icon ───────────────────────────────────────────

test('SKY-11190 AC2: renaming a folder with a custom icon preserves it (path rewritten, not lost)', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('rename');
  mkNote(notesDir, 'Locations/Castle.md', '# Castle\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(folderTile(page, 'Locations')).toBeVisible({ timeout: 8_000 });
    await setTileIcon(page, 'Locations', 'castle', 'Purple');
    await expect.poll(() => fs.existsSync(path.join(notesDir, ICONS_SIDECAR)), { timeout: 5_000 }).toBe(true);

    // A real in-app rename (right-click → Rename… → commit) — the same
    // path FO-05 (folder-ops-sky7995.spec.ts) uses — drives the app's own
    // move/rename IPC, which is what rewrites the path-keyed icon-map key
    // (rewriteIconsOnMove in vaultIcons.ts, wired in main.ts's
    // NOTES_VAULT_MOVE handler). An out-of-band OS-level rename made while
    // the app isn't running has no move event to key off and is out of
    // scope for this path-keyed (not id-keyed) store.
    await gotoNotesVaultTree(page);
    await page.locator('[data-testid="vb-row-Locations"]').click({ button: 'right' });
    await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-rename"]').click();
    const input = page.locator('.vb-rename-input');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill('Realms');
    await input.press('Enter');
    await expect(page.locator('[data-testid="vb-row-Realms"]')).toBeVisible({ timeout: 8_000 });

    // The icon-map key followed the rename — no dangling "Locations" entry,
    // and no lost assignment.
    await expect.poll(() => {
      const stored = JSON.parse(fs.readFileSync(path.join(notesDir, ICONS_SIDECAR), 'utf-8'));
      return stored['Locations'] === undefined && stored['Realms']?.icon === 'pack:lucide/castle';
    }, { timeout: 5_000 }).toBe(true);
    const stored = JSON.parse(fs.readFileSync(path.join(notesDir, ICONS_SIDECAR), 'utf-8'));
    expect(stored['Locations']).toBeUndefined();
    expect(stored['Realms']).toEqual({ icon: 'pack:lucide/castle', color: '#c678dd' });

    const treeRow = page.locator('[data-testid="vb-row-Realms"]');
    await expect(treeRow.locator('.vb-icon svg')).toHaveAttribute('stroke', '#c678dd');

    await bootToBoards(app);
    await expect(folderTile(page, 'Realms')).toBeVisible({ timeout: 8_000 });
    await expect(folderTile(page, 'Realms').locator('.board-canvas__item-icon svg')).toHaveAttribute(
      'stroke',
      '#c678dd',
    );

    // Rebase integration: the same tile menu must still reach main's inline
    // rename, and that real IPC path must preserve the icon as well.
    await folderTile(page, 'Realms').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Set icon…', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const boardName = page.getByRole('textbox', { name: 'Board name', exact: true });
    await boardName.fill('Kingdoms');
    await boardName.press('Enter');
    await expect(folderTile(page, 'Kingdoms').locator('.board-canvas__item-icon svg')).toHaveAttribute('stroke', '#c678dd');
    const afterBoardRename = JSON.parse(fs.readFileSync(path.join(notesDir, ICONS_SIDECAR), 'utf-8'));
    expect(afterBoardRename['Realms']).toBeUndefined();
    expect(afterBoardRename['Kingdoms']).toEqual({ icon: 'pack:lucide/castle', color: '#c678dd' });
    expect(fs.existsSync(path.join(notesDir, 'Kingdoms', 'Castle.md'))).toBe(true);
    expect(fs.existsSync(path.join(notesDir, 'Realms'))).toBe(false);
    await gotoNotesVaultTree(page);
    await expect(page.locator('[data-testid="vb-row-Kingdoms"] .vb-icon svg')).toHaveAttribute('stroke', '#c678dd');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC3 — unknown/corrupted icon name falls back, never a blank/broken render ─

test('SKY-11190 AC3: an icon name outside the known set falls back to the default glyph, no render error', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('fallback');
  mkNote(notesDir, 'Ruins/Note.md', '# Note\n');
  fs.mkdirSync(path.join(notesDir, '.mythos'), { recursive: true });
  fs.writeFileSync(
    path.join(notesDir, ICONS_SIDECAR),
    JSON.stringify({ Ruins: { icon: 'pack:lucide/not-a-real-glyph', color: '#e06c75' } }, null, 2),
  );

  const app = await launchApp(userData);
  const pageErrors: string[] = [];
  try {
    const page = await bootToBoards(app);
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // The tile still renders — with the default folder glyph, not a blank slot.
    await expect(folderTile(page, 'Ruins')).toBeVisible({ timeout: 8_000 });
    await expect(folderTile(page, 'Ruins').locator('.board-canvas__item-icon')).not.toBeEmpty();
    await expect(folderTile(page, 'Ruins').locator('.board-canvas__item-icon svg')).toHaveCount(0);

    await gotoNotesVaultTree(page);
    const treeRow = page.locator('[data-testid="vb-row-Ruins"]');
    await expect(treeRow).toBeVisible({ timeout: 8_000 });
    // Playwright's toBeEmpty() checks textContent, which is always "" for an
    // svg-only fallback glyph — assert the fallback svg renders instead.
    await expect(treeRow.locator('.vb-icon svg')).toBeVisible();

    expect(pageErrors).toEqual([]);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
