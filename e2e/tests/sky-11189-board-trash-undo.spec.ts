/**
 * sky-11189-board-trash-undo.spec.ts — SKY-11189 (Notes Board 6/9): trash
 * split by target type + Undo/Ctrl+Z (deferred-delete, BOARDS-SPEC v2 §7/§8).
 *
 * Drives the real built app (out/main/main.js) against a real notes vault
 * fixture — canvas UI → preload → IPC → main → disk, and (for the crash-safety
 * check) a real process kill + relaunch. A mocked `window.api` seam cannot
 * prove any of this: shell.trashItem is a real OS call, and app-quit/crash
 * timing only exists across a real process boundary (COMPANY-STANDARDS §4a).
 *
 * Furniture (columns/lines) has no canvas UI yet — SKY-11188 isn't merged —
 * so the connector test drives that half through the same real IPC channel
 * the renderer itself calls (`window.api.notesBoardFurnitureCreate`), exactly
 * as sky-10-rollback.spec.ts and others already do for data with no widget.
 *
 * Coverage (spec §15):
 *   8  Ctrl+Z before the undo window elapses restores it, no trip to the OS
 *      trash; letting the window elapse removes it from the vault for real.
 *   9  Trashing a board with cards moves the whole subtree; each surfaces
 *      individually in Recently Deleted while pending.
 *   10 Trashing a connector endpoint removes the connector immediately;
 *      restoring the card via Ctrl+Z does not resurrect it.
 *   —  Crash-safety: killing the process mid-undo-window leaves the file
 *      untouched on relaunch.
 */

import path from 'path';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
// Real UNDO_WINDOW_MS (notesTrash.ts) — kept in sync deliberately rather than
// imported (electron-main and e2e are separate TS projects); a drift here
// would show up as this spec timing out waiting for a flush that never
// crosses the assertion window, which is a loud, obvious failure.
const UNDO_WINDOW_MS = 8000;

// NOT os.tmpdir(): on several Linux setups (this sandbox included) /tmp is a
// tmpfs mount, and gio's freedesktop-trash-spec implementation flatly refuses
// to trash anything on a "system internal mount" (tmpfs/proc/sysfs) — every
// shell.trashItem call below would fail silently into the module's
// best-effort .catch(), and this suite would hang waiting for a flush that
// can never succeed. `.tmp/` (repo-root, already gitignored) sits on the
// same real disk-backed filesystem as the checkout, so trashing actually works.
const TMP_BASE = path.resolve(__dirname, '../../.tmp');

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  fs.mkdirSync(TMP_BASE, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(TMP_BASE, `mythos-sky11189-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
  return { tempRoot, userData, notesDir };
}

function mkNote(notesDir: string, rel: string, body = '# Note\n'): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
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
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  return page;
}

const cardByName = (page: Page, name: string) =>
  page.locator('.board-canvas__item', { hasText: name }).first();
const folderTile = (page: Page, name: string) =>
  page.locator('.board-canvas__item--folder', { hasText: name }).first();

async function enterBoard(page: Page, folder: string): Promise<void> {
  await folderTile(page, folder).dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, { timeout: 8_000 });
}

/** Select a card by clicking it, then delete the current selection via the keyboard. */
async function selectAndDelete(page: Page, name: string): Promise<void> {
  await cardByName(page, name).click();
  await page.keyboard.press('Delete');
}

async function openRecentlyDeleted(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Recently Deleted' }).click();
  await expect(page.locator('.recently-deleted-panel')).toBeVisible({ timeout: 4_000 });
}

// ── §15 test 8: Ctrl+Z before the window elapses; a real OS-trash flush after ──

test('SKY-11189 §15 test 8: Ctrl+Z restores before the undo window elapses; letting it elapse removes the file for real', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('undo-window');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await page.locator('.boards-tab-panel__tool[data-tool="note"]').click();
    await page.mouse.click(700, 500);
    await expect(page.locator('.board-canvas__item-rename')).toBeFocused({ timeout: 8_000 });
    await page.locator('.board-canvas__item-rename').fill('Keepsake');
    await page.keyboard.press('Enter');
    await expect(cardByName(page, 'Keepsake')).toBeVisible({ timeout: 8_000 });

    const notePath = path.join(notesDir, 'Keepsake.md');
    expect(fs.existsSync(notePath)).toBe(true);

    // Trash it, undo it immediately — back on the board, never touched on disk.
    await selectAndDelete(page, 'Keepsake');
    await expect(cardByName(page, 'Keepsake')).toHaveCount(0);
    expect(fs.existsSync(notePath)).toBe(true); // deferred — nothing moved yet

    await page.keyboard.press('Control+z');
    await expect(cardByName(page, 'Keepsake')).toBeVisible({ timeout: 4_000 });
    expect(fs.existsSync(notePath)).toBe(true);

    // Trash it again and let the window elapse (no undo this time) — it
    // leaves the vault for real, via the actual shell.trashItem call.
    await selectAndDelete(page, 'Keepsake');
    await expect(cardByName(page, 'Keepsake')).toHaveCount(0);
    await expect
      .poll(() => fs.existsSync(notePath), { timeout: UNDO_WINDOW_MS + 5_000, intervals: [250] })
      .toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── §15 test 9: trashing a board cascades to its cards, each individually listed ──

test('SKY-11189 §15 test 9: trashing a board moves cards with it; each surfaces individually in Recently Deleted, both reach the OS trash on flush', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('board-cascade');
  mkNote(notesDir, 'Lore/Origins.md');
  mkNote(notesDir, 'Lore/Timeline.md');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);

    await folderTile(page, 'Lore').click();
    await page.keyboard.press('Delete');
    await expect(folderTile(page, 'Lore')).toHaveCount(0);

    await openRecentlyDeleted(page);
    await expect(page.getByText('Lore', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Origins.md', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Timeline.md', { exact: true }).first()).toBeVisible();

    const folderPath = path.join(notesDir, 'Lore');
    await expect
      .poll(() => fs.existsSync(folderPath), { timeout: UNDO_WINDOW_MS + 5_000, intervals: [250] })
      .toBe(false);
    // The cards went WITH the folder — not left behind as orphans.
    expect(fs.existsSync(path.join(notesDir, 'Lore', 'Origins.md'))).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── §15 test 10: connector cascade is immediate and NOT undone by restore ──

test('SKY-11189 §15 test 10: trashing a connector endpoint removes the connector immediately; Ctrl+Z restores the card but not the connector', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('connector');
  mkNote(notesDir, 'Anchor.md');
  mkNote(notesDir, 'Endpoint.md');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);

    // Furniture has no canvas UI yet (SKY-11188 unmerged) — wire the
    // connector through the same real IPC channel the renderer would use.
    const { fromKey, toKey } = await page.evaluate(async () => {
      const a = await window.api.notesBoardPatchLayout('', 'Anchor.md', { x: 0, y: 0 });
      const b = await window.api.notesBoardPatchLayout('', 'Endpoint.md', { x: 300, y: 0 });
      return { fromKey: a.key, toKey: b.key };
    });
    await page.evaluate(
      async ({ fromKey, toKey }) => {
        await window.api.notesBoardFurnitureCreate('', { k: 'line', x: 0, y: 0, from: fromKey, to: toKey });
      },
      { fromKey, toKey },
    );

    const hasLine = (p: Page) => p.evaluate(async () => {
      const board = await window.api.notesBoardGet('');
      return board.furniture.some((f) => f.k === 'line');
    });

    // The IPC calls above wrote straight to the sidecar, bypassing React
    // state — reload so BoardsTabPanel mounts fresh and actually reads it.
    await page.reload();
    const reloaded = await bootToBoards(app);
    await expect(cardByName(reloaded, 'Anchor')).toBeVisible({ timeout: 8_000 });
    expect(await hasLine(reloaded)).toBe(true);

    await selectAndDelete(reloaded, 'Anchor');
    await expect(cardByName(reloaded, 'Anchor')).toHaveCount(0);
    // Cascade is immediate — not deferred to flush.
    expect(await hasLine(reloaded)).toBe(false);

    await reloaded.keyboard.press('Control+z');
    await expect(cardByName(reloaded, 'Anchor')).toBeVisible({ timeout: 4_000 });
    // Documented behaviour (§15 test 10): restoring the card does not bring
    // the connector back.
    expect(await hasLine(reloaded)).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── Crash-safety: a process death mid-window leaves the file untouched ──

test('SKY-11189 crash-safety: killing the process mid-undo-window never moves the file — it survives untouched on relaunch', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('crash-safety');
  mkNote(notesDir, 'Survivor.md', '# Survivor\n\nStill here.\n');

  const app = await launchApp(userData);
  const notePath = path.join(notesDir, 'Survivor.md');
  try {
    const page = await bootToBoards(app);
    await selectAndDelete(page, 'Survivor');
    await expect(cardByName(page, 'Survivor')).toHaveCount(0);
    expect(fs.existsSync(notePath)).toBe(true); // still pending, nothing moved

    // Kill the process directly — no graceful quit, no flush-before-quit
    // handshake. This is the scenario §8 is written against: "if the app
    // dies mid-window, the file was never moved."
    const proc = app.process();
    proc.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));

    expect(fs.existsSync(notePath)).toBe(true);
    // Real time has elapsed well past what would have been the undo window,
    // but there was no live process to run the setTimeout that would have
    // flushed it — pending state was in-memory only and died with the process.
    await new Promise((r) => setTimeout(r, UNDO_WINDOW_MS));
    expect(fs.existsSync(notePath)).toBe(true);
  } finally {
    try { if (!app.process().killed) app.process().kill('SIGKILL'); } catch { /* already exited */ }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKY-11189 crash-safety (relaunch): the survived file reappears as a normal, live card — not stuck in Recently Deleted', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('crash-safety-relaunch');
  mkNote(notesDir, 'Survivor.md', '# Survivor\n\nStill here.\n');

  let app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await selectAndDelete(page, 'Survivor');
    await expect(cardByName(page, 'Survivor')).toHaveCount(0);

    const proc = app.process();
    proc.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));

    // Relaunch against the SAME userData/vault — a fresh process has no
    // memory of the old pending-delete registry (it was never persisted).
    app = await launchApp(userData);
    const page2 = await bootToBoards(app);
    await expect(cardByName(page2, 'Survivor')).toBeVisible({ timeout: 8_000 });

    await openRecentlyDeleted(page2);
    await expect(page2.locator('.recently-deleted-panel__empty-msg')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
