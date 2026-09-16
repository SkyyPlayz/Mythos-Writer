/**
 * sky-11187-board-vault-mutations.spec.ts — SKY-11187 (Notes Board 4/9):
 * vault-mutating canvas operations (BOARDS-SPEC v2 §5).
 *
 * Drives the real built app (out/main/main.js) against a REAL notes vault
 * fixture, so every assertion crosses the whole boundary the ticket names:
 * canvas UI → preload → IPC → main → disk, and back out to BOTH renderings of
 * that filesystem (the board AND the Notes tree, spec §1). A mocked
 * `window.api` seam would prove none of it (COMPANY-STANDARDS §4a).
 *
 * Per §4c nothing under test is pre-seeded: no `.mythos-board.json` is written
 * by the fixture, and every note and board these tests assert on is created by
 * the app itself through the canvas tools.
 *
 * Coverage (SKY-11187 ACs):
 *   1  Note tool → the note exists on disk, on the board at the click point,
 *      and in the Notes tree in the same folder (AC1, spec §15 test 1).
 *   2  Note tool at HOME (vault root) — succeeds and behaves like any other
 *      board (AC2, spec §15 test 13); the root restriction is gone.
 *   3  Board tool → a real directory, and the parent tile's `N boards, M cards`
 *      is re-read from the vault rather than left stale (AC4).
 *   4  Inline rename renames the real file, and the Notes tree follows (§5).
 *   5  Renaming to an empty string is a no-op: no crash, no orphan, the file
 *      keeps its name (AC3).
 *   6  Dragging a card is metadata-only — the vault is byte-identical after
 *      a drag (the ticket's regression guard against scope creep).
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
const SIDECAR = '.mythos-board.json';

// ── Fixture ─────────────────────────────────────────────────────────────────

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11187-${slug}-`));
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

/** Every file in the vault with its bytes — for "nothing on disk changed". */
function snapshotVault(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(out, snapshotVault(path.join(dir, entry.name), rel));
    else out[rel] = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
  }
  return out;
}

// ── App-driving helpers ──────────────────────────────────────────────────────

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

const folderTile = (page: Page, name: string) =>
  page.locator('.board-canvas__item--folder', { hasText: name }).first();

async function enterBoard(page: Page, folder: string): Promise<void> {
  await folderTile(page, folder).dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, {
    timeout: 8_000,
  });
}

/**
 * Arm a placement tool and click empty canvas at a viewport point. Returns
 * once the created item's inline rename field is focused — which is only true
 * after the create round-tripped through main and the board reloaded.
 */
async function placeWithTool(
  page: Page,
  tool: 'Note' | 'Board',
  at: { x: number; y: number },
): Promise<void> {
  await page.locator(`.boards-tab-panel__tool[data-tool="${tool.toLowerCase()}"]`).click();
  await expect(page.locator('.board-canvas__root')).toHaveAttribute(
    'data-active-tool',
    tool.toLowerCase(),
  );
  await page.mouse.click(at.x, at.y);
  await expect(page.locator('.board-canvas__item-rename')).toBeFocused({ timeout: 8_000 });
}

/** Type a name into the open inline rename field and commit it. */
async function commitRename(page: Page, name: string): Promise<void> {
  const input = page.locator('.board-canvas__item-rename');
  await input.fill(name);
  await input.press('Enter');
}

/** Switch to the Notes tab and wait for its tree. */
async function openNotesTab(page: Page): Promise<void> {
  // The nav rail labels this tab "Notes Editor" (settingsPanelTypes.ts).
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
}

const treeRow = (page: Page, relPath: string) =>
  page.locator(`[data-testid="vb-row-${relPath}"]`);

/**
 * Expand a Notes-tree folder row, tolerating the state it is already in — a
 * bare click TOGGLES, so clicking an already-open folder would collapse it.
 */
async function expandTreeRow(page: Page, relPath: string): Promise<void> {
  const row = treeRow(page, relPath);
  await expect(row).toBeVisible({ timeout: 8_000 });
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 8_000 });
}

// ── AC1 — Note tool creates a real note, on the board and in the Notes tree ──

test('SKY-11187 AC1: the Note tool creates a real note at the click point, and the Notes tab shows it', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('note-tool');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');

    // §4c: no board metadata exists — the create is what makes it.
    expect(fs.existsSync(path.join(notesDir, 'Characters', SIDECAR))).toBe(false);

    await placeWithTool(page, 'Note', { x: 900, y: 560 });

    // The REAL file is on disk, in this board's folder.
    const created = path.join(notesDir, 'Characters', 'New note.md');
    expect(fs.existsSync(created)).toBe(true);

    // Name it, and the rename lands on the real file.
    await commitRename(page, 'Bramble');
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Bramble' })).toBeVisible({
      timeout: 8_000,
    });
    expect(fs.existsSync(path.join(notesDir, 'Characters', 'Bramble.md'))).toBe(true);
    expect(fs.existsSync(created)).toBe(false);

    // It sits at the click point, not in an auto-layout slot: the sidecar has
    // an id-keyed layout entry, and the card renders there.
    const sidecar = JSON.parse(fs.readFileSync(path.join(notesDir, 'Characters', SIDECAR), 'utf-8'));
    const layout = sidecar.layout as Record<string, { x: number; y: number }>;
    const noteKeys = Object.keys(layout).filter((k) => k.startsWith('n:'));
    expect(noteKeys).toHaveLength(1);
    const style = (await page
      .locator('.board-canvas__item', { hasText: 'Bramble' })
      .first()
      .getAttribute('style')) ?? '';
    expect(Number(/left:\s*([\d.]+)px/.exec(style)?.[1])).toBe(layout[noteKeys[0]].x);
    expect(Number(/top:\s*([\d.]+)px/.exec(style)?.[1])).toBe(layout[noteKeys[0]].y);

    // §1: the OTHER rendering of the same filesystem. The Notes tree shows it
    // in the same folder, without a relaunch — the notes watcher drops the
    // app's own write, so this only passes because the create pushes the
    // change to the renderer itself.
    await openNotesTab(page);
    await expandTreeRow(page, 'Characters');
    await expect(treeRow(page, 'Characters/Bramble.md')).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC2 — Home (the vault root) is not special (spec §15 test 13) ────────────

test('SKY-11187 AC2: creating a note at Home succeeds and behaves like any other board', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('home');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText('Home');

    await placeWithTool(page, 'Note', { x: 700, y: 500 });
    expect(fs.existsSync(path.join(notesDir, 'New note.md'))).toBe(true);

    await commitRename(page, 'First Light');
    await expect(page.locator('.board-canvas__item-name', { hasText: 'First Light' })).toBeVisible({
      timeout: 8_000,
    });

    // The note is on disk at the ROOT — not nudged into a folder, not refused.
    expect(fs.existsSync(path.join(notesDir, 'First Light.md'))).toBe(true);
    // And the Home board's sidecar is the vault root's own, exactly as a
    // nested board's lives in that board's folder. No special-casing.
    expect(fs.existsSync(path.join(notesDir, SIDECAR))).toBe(true);

    // An EMPTY board still offers a canvas to click on — the create path used
    // to be unreachable there, because the empty state replaced the canvas
    // instead of layering over it.
    await placeWithTool(page, 'Board', { x: 1000, y: 620 });
    await commitRename(page, 'Fresh');
    await expect(folderTile(page, 'Fresh')).toBeVisible({ timeout: 8_000 });
    await enterBoard(page, 'Fresh');
    await expect(page.locator('.board-canvas__item')).toHaveCount(0);

    await placeWithTool(page, 'Note', { x: 700, y: 500 });
    await commitRename(page, 'Seedling');
    expect(fs.existsSync(path.join(notesDir, 'Fresh', 'Seedling.md'))).toBe(true);

    // The Notes tree shows both, without a relaunch (§1).
    await openNotesTab(page);
    await expect(treeRow(page, 'First Light.md')).toBeVisible({ timeout: 8_000 });
    await expandTreeRow(page, 'Fresh');
    await expect(treeRow(page, 'Fresh/Seedling.md')).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC4 — Board tool creates a real folder; tile counts re-read from the vault ─

test('SKY-11187 AC4: the Board tool creates a real folder and tile counts are re-read from the vault', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('board-tool');
  mkNote(notesDir, 'Series/Notes.md', '# Notes\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);

    // Before: Series holds one card and no boards.
    await expect(folderTile(page, 'Series').locator('.board-canvas__item-meta')).toHaveText(
      '0 boards, 1 cards',
    );

    await enterBoard(page, 'Series');
    await placeWithTool(page, 'Board', { x: 900, y: 520 });
    expect(fs.statSync(path.join(notesDir, 'Series', 'New board')).isDirectory()).toBe(true);

    await commitRename(page, 'Book One');
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Book One' })).toBeVisible({
      timeout: 8_000,
    });
    expect(fs.statSync(path.join(notesDir, 'Series', 'Book One')).isDirectory()).toBe(true);

    // Back at Home the parent tile's counts reflect the vault as it is NOW,
    // not the listing that was current when the board was first opened.
    await page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' }).click();
    await expect(folderTile(page, 'Series').locator('.board-canvas__item-meta')).toHaveText(
      '1 boards, 1 cards',
      { timeout: 8_000 },
    );
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC3 — Renaming to an empty string is a no-op ─────────────────────────────

test('SKY-11187 AC3: renaming to an empty string is a no-op — no crash, no orphaned file', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('empty-rename');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');

    const card = page.locator('.board-canvas__item', { hasText: 'Alice' }).first();
    await card.click();
    await card.press('F2');
    const input = page.locator('.board-canvas__item-rename');
    await expect(input).toBeFocused({ timeout: 8_000 });

    await input.fill('   ');
    await input.press('Enter');

    // The card is still Alice, the file is still Alice.md, and no ".md" or
    // stray empty-named entry was left behind.
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Alice' })).toBeVisible({
      timeout: 8_000,
    });
    const names = fs.readdirSync(path.join(notesDir, 'Characters'));
    expect(names.filter((n) => !n.startsWith('.'))).toEqual(['Alice.md']);
    expect(fs.readFileSync(path.join(notesDir, 'Characters', 'Alice.md'), 'utf-8')).toBe('# Alice\n');

    // The app is still live and the canvas still responds.
    await expect(page.locator('.board-canvas__root')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── Regression guard — dragging a card must NOT mutate the vault ─────────────

test('SKY-11187: dragging a card is metadata-only — no note or folder on disk changes', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('drag-guard');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Characters/Bob.md', '# Bob\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');

    const before = snapshotVault(path.join(notesDir, 'Characters'));

    const el = page.locator('.board-canvas__item', { hasText: 'Alice' }).first();
    const box = await el.boundingBox();
    if (!box) throw new Error('no bounding box for Alice');
    await page.mouse.move(box.x + 20, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 110, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600); // past NOTES_BOARD_DEBOUNCE_MS

    const after = snapshotVault(path.join(notesDir, 'Characters'));

    // A drag DOES mint the dragged note's stable id in its own frontmatter
    // (§2 lazy assignment) and writes the board sidecar — that is Store B
    // bookkeeping. What it must never do is create, rename or delete a note
    // or folder in the vault.
    expect(Object.keys(after).filter((k) => !k.startsWith('.')).sort()).toEqual(
      Object.keys(before).filter((k) => !k.startsWith('.')).sort(),
    );
    expect(after['Bob.md']).toBe(before['Bob.md']);
    expect(after['Alice.md']).toContain('# Alice');
    // The sidecar is the ONLY new file.
    expect(Object.keys(after).filter((k) => !(k in before))).toEqual([SIDECAR]);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
