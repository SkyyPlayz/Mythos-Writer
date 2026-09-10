/**
 * sky-11191-board-search-links-minimap.spec.ts — SKY-11191 (Notes Board 8/9):
 * cross-board search, the wiki-link overlay and the minimap (BOARDS-SPEC v2 §11).
 *
 * Drives the real built app (out/main/main.js) against a REAL notes vault, so
 * every assertion crosses the whole boundary: canvas UI → preload → IPC → main
 * → the vault on disk, and back. The link graph in particular is the REAL
 * vaultGraph.ts index built by walking real `.md` files — the point of the
 * ticket is that the overlay reads the same graph the Vault Graph does, and a
 * mocked `window.api` would prove exactly nothing about that
 * (COMPANY-STANDARDS §4a).
 *
 * Coverage (SKY-11191 ACs):
 *   1  A search hit navigates to the board that CONTAINS it and selects the
 *      item there — including a board nested two levels down (AC2).
 *   2  The overlay toggle draws a dashed connector between two cards on the
 *      same board that link to each other, and only while it is on.
 *   3  A `column` item's `ref` (ticket 5, SKY-11188) shows its connector under
 *      the same toggle (AC1 / spec §15 test 6, overlay half), and that
 *      connector tracks the column through a live drag (SKY-11717).
 *   4  Overlay and minimap are purely derived: nothing about either is written
 *      to the board sidecar, and killing and relaunching the app reconstructs
 *      both from the vault alone (AC3).
 *
 * Per §4c nothing under test is pre-seeded. The fixture writes notes and
 * folders — the INPUT the features read — but no `.mythos-board.json`, no
 * overlay state and no minimap state, and every toggle, search and navigation
 * under test is performed through the UI.
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11191-${slug}-`));
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

/** Two notes on one board that link to each other's names, plus a nested board. */
function seedLinkedVault(notesDir: string): void {
  mkNote(notesDir, 'Characters/Aria.md', '# Aria\n\nTravels with [[Kesh]].\n');
  mkNote(notesDir, 'Characters/Kesh.md', '# Kesh\n\nA quiet one.\n');
  // Off this board — its link must NOT draw a connector here.
  mkNote(notesDir, 'Places/Harbour.md', '# Harbour\n\nHome to [[Aria]].\n');
  // Two levels down, for the nested-search criterion.
  mkNote(notesDir, 'Characters/Minor/Bramble.md', '# Bramble\n');
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
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  return page;
}

const searchField = (page: Page) => page.locator('input[aria-label="Search all boards"]');
const searchHits = (page: Page) => page.locator('#boards-search-results [role="option"]');
const linksToggle = (page: Page) => page.locator('button[data-toggle="links"]');
const minimapToggle = (page: Page) => page.locator('button[data-toggle="minimap"]');
const connectors = (page: Page) => page.locator('.board-canvas__link');
const currentBoard = (page: Page) => page.locator('.boards-tab-panel__breadcrumb-current');

async function enterBoard(page: Page, folder: string): Promise<void> {
  await page.locator('.board-canvas__item--folder', { hasText: folder }).first().dblclick();
  await expect(currentBoard(page)).toHaveText(folder, { timeout: 8_000 });
}

/** Type a query and wait for the vault name index to come back with hits. */
async function search(page: Page, query: string): Promise<void> {
  await searchField(page).fill(query);
  await expect(searchHits(page).first()).toBeVisible({ timeout: 8_000 });
}

/** Turn the overlay on and wait for the first connector the board can draw. */
async function enableOverlay(page: Page): Promise<void> {
  await linksToggle(page).click();
  await expect(linksToggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(connectors(page).first()).toBeAttached({ timeout: 8_000 });
}

// ── AC2 — a search hit navigates to the containing board and selects the item ──

test('SKY-11191 AC2: a cross-board search hit opens the board that holds it and selects the item', async () => {
  test.setTimeout(150_000);
  const { userData, notesDir } = makeTemp('search');
  seedLinkedVault(notesDir);

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    // Home shows only the two top-level folders — the hit is not on screen yet.
    await expect(currentBoard(page)).toHaveText('Home');
    await expect(page.locator('.board-canvas__item', { hasText: 'Kesh' })).toHaveCount(0);

    await search(page, 'Kesh');
    // The hit names the board it lives on, because two notes may share a name.
    await expect(searchHits(page).first()).toContainText('Characters');
    await searchHits(page).first().click();

    await expect(currentBoard(page)).toHaveText('Characters', { timeout: 8_000 });
    const selected = page.locator('.board-canvas__item[data-selected="true"]');
    await expect(selected).toHaveCount(1, { timeout: 8_000 });
    await expect(selected).toContainText('Kesh');
    // Taking a hit clears the field, so the results are not left covering the board.
    await expect(searchField(page)).toHaveValue('');

    // Nested: the same journey, two boards deep, from Home.
    await page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' }).click();
    await expect(currentBoard(page)).toHaveText('Home');
    await search(page, 'Bramble');
    await expect(searchHits(page).first()).toContainText('Characters / Minor');
    await searchHits(page).first().click();

    await expect(currentBoard(page)).toHaveText('Minor', { timeout: 8_000 });
    // The whole trail back up is there, not just the board itself.
    await expect(page.locator('.boards-tab-panel__breadcrumb-btn')).toHaveText(['Home', 'Characters']);
    await expect(page.locator('.board-canvas__item[data-selected="true"]')).toContainText('Bramble');
  } finally {
    await app.close();
  }
});

test('SKY-11191: the search field is a keyboard path — arrow keys walk the hits, Enter takes one', async () => {
  test.setTimeout(150_000);
  const { userData, notesDir } = makeTemp('search-keys');
  seedLinkedVault(notesDir);

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await searchField(page).click();
    await search(page, 'a'); // matches Aria, Bramble, Characters, Harbour…
    await expect(searchHits(page).nth(1)).toBeVisible();

    // The active option is the one Enter takes, and it is announced.
    await expect(searchHits(page).first()).toHaveAttribute('aria-selected', 'true');
    await searchField(page).press('ArrowDown');
    await expect(searchHits(page).nth(1)).toHaveAttribute('aria-selected', 'true');

    const secondHitBoard = await searchHits(page).nth(1).getAttribute('data-vault-path');
    await searchField(page).press('Enter');
    await expect(page.locator('.board-canvas__item[data-selected="true"]')).toHaveCount(1, {
      timeout: 8_000,
    });
    expect(secondHitBoard).toBeTruthy();
  } finally {
    await app.close();
  }
});

// ── Overlay — a real [[wikilink]] between two cards on one board ─────────────

test('SKY-11191: the overlay toggle draws a connector between two cards that link to each other', async () => {
  test.setTimeout(150_000);
  const { userData, notesDir } = makeTemp('overlay');
  seedLinkedVault(notesDir);

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');
    await expect(page.locator('.board-canvas__item--note')).toHaveCount(2);

    // Off by default: an unasked-for web of lines is not what opening a board means.
    await expect(linksToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.board-canvas__links')).toHaveCount(0);

    await enableOverlay(page);
    // Exactly one: Aria → Kesh. Harbour → Aria is a real link in the vault, but
    // Harbour is on another board, so this board has nothing to draw it to.
    await expect(connectors(page)).toHaveCount(1);
    await expect(connectors(page).first()).toHaveAttribute('data-link-label', 'Aria links to Kesh');

    // It is a line between the two cards, not a zero-length stub at the origin.
    const box = await connectors(page).first().evaluate((el) => {
      const line = el as unknown as SVGLineElement;
      return {
        x1: line.x1.baseVal.value,
        x2: line.x2.baseVal.value,
        dash: getComputedStyle(el).strokeDasharray,
      };
    });
    expect(box.x1).not.toBe(box.x2);
    expect(box.dash).not.toBe('none');

    // Toggling it back off removes the whole layer.
    await linksToggle(page).click();
    await expect(page.locator('.board-canvas__links')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

// ── AC1 — a column `ref` (ticket 5) is just another wikilink source ──────────

test('SKY-11191 AC1: a column item’s ref shows its connector under the overlay', async () => {
  test.setTimeout(150_000);
  const { userData, notesDir } = makeTemp('column-ref');
  seedLinkedVault(notesDir);

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');

    // The column is created through the REAL `notesBoard:furnitureCreate`
    // channel — preload → IPC → main → the sidecar on disk. That is the only
    // reachable way to make one until SKY-11188 (ticket 5) ships the column
    // tool; it is deliberately not a hand-written fixture file, so the write
    // still crosses the process boundary the same way the UI's will.
    const created = await page.evaluate(async () => {
      const res = await window.api.notesBoardFurnitureCreate('Characters', {
        k: 'column',
        x: 700,
        y: 60,
        title: 'Cast',
        items: [{ t: 'Aria', ref: 'Characters/Aria.md' }],
      });
      return res.item;
    });
    expect(created.id).toBeTruthy();

    // It really is on disk, as a column with a ref — the overlay is reading
    // Store B, not something the renderer kept in memory.
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(notesDir, 'Characters', SIDECAR), 'utf-8'),
    ) as { furniture: Array<{ k: string; items?: Array<{ ref?: string }> }> };
    expect(sidecar.furniture[0].k).toBe('column');
    expect(sidecar.furniture[0].items?.[0].ref).toBe('Characters/Aria.md');

    // Reload the board so the panel picks the new furniture up, then toggle on.
    await page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' }).click();
    await expect(currentBoard(page)).toHaveText('Home');
    await enterBoard(page, 'Characters');
    await enableOverlay(page);

    // Two connectors now: the prose link Aria → Kesh, and the column's ref.
    await expect(connectors(page)).toHaveCount(2);
    await expect(
      page.locator('.board-canvas__link[data-link-label="Cast links to Aria"]'),
    ).toHaveCount(1);
    // Anchored on the column box itself, not on some stand-in.
    const columnLink = page.locator(
      `.board-canvas__link[data-link-id="furniture:${created.id}→Aria.md"]`,
    );
    await expect(columnLink).toHaveCount(1);

    // ── SKY-11717: the connector tracks the column DURING the drag ──────────
    //
    // The panel's anchor for this box comes from Store B, so it does not move
    // until the drag commits and the row reloads. The canvas owns the live
    // rect, and this asserts the connector is reading that one — every check
    // below happens with the mouse button still down.
    const column = page.locator(`[data-testid="board-furniture-${created.id}"]`);
    const handle = column.locator('.board-canvas__furniture-title');
    const x1Of = async () => parseFloat((await columnLink.getAttribute('x1')) ?? 'NaN');
    const leftOf = async () =>
      column.evaluate((el) => parseFloat(getComputedStyle(el as HTMLElement).left));

    const grip = await handle.boundingBox();
    expect(grip).not.toBeNull();
    const x1Before = await x1Of();
    const leftBefore = await leftOf();

    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    // Two steps so the move is a real drag, not a single synthetic jump.
    await page.mouse.move(grip!.x + grip!.width / 2 + 60, grip!.y + grip!.height / 2, { steps: 4 });
    await page.mouse.move(grip!.x + grip!.width / 2 + 160, grip!.y + grip!.height / 2, { steps: 8 });

    try {
      // The box moved, and the connector moved with it — before mouseup.
      await expect.poll(leftOf).toBeGreaterThan(leftBefore + 100);
      const leftMid = await leftOf();
      const x1Mid = await x1Of();
      expect(x1Mid).toBeGreaterThan(x1Before + 100);
      // Same delta, not merely "also moved": the two are reading one rect.
      expect(Math.abs(x1Mid - x1Before - (leftMid - leftBefore))).toBeLessThan(1);
    } finally {
      await page.mouse.up();
    }

    // And the commit round-trip leaves it exactly where the drag had it —
    // no snap-back when Store B catches up.
    await expect.poll(x1Of).toBeGreaterThan(x1Before + 100);
  } finally {
    await app.close();
  }
});

// ── AC3 — both are purely derived; a relaunch reconstructs them ──────────────

test('SKY-11191 AC3: overlay and minimap persist nothing — a relaunch reconstructs both', async () => {
  test.setTimeout(180_000);
  const { userData, notesDir } = makeTemp('derived');
  seedLinkedVault(notesDir);
  const charactersSidecar = path.join(notesDir, 'Characters', SIDECAR);

  const first = await launchApp(userData);
  try {
    const page = await bootToBoards(first);
    await enterBoard(page, 'Characters');

    // The minimap is on by default and maps every item box on this board —
    // the two note cards plus the nested `Minor` board tile.
    const minimap = page.locator('[data-testid="board-minimap"]');
    await expect(minimap).toBeVisible();
    await expect(minimap).toHaveAttribute('data-box-count', '3');
    await expect(page.locator('[data-testid="board-minimap-viewport"]')).toBeVisible();

    await enableOverlay(page);
    await expect(connectors(page)).toHaveCount(1);

    // Toggling either one wrote nothing: this board has never been given any
    // metadata at all, so its sidecar still does not exist.
    await minimapToggle(page).click();
    await expect(minimap).toHaveCount(0);
    await minimapToggle(page).click();
    await expect(minimap).toBeVisible();
    expect(fs.existsSync(charactersSidecar)).toBe(false);
  } finally {
    await first.close();
  }

  // Kill the app and come back to the same vault and the same user data.
  const second = await launchApp(userData);
  try {
    const page = await bootToBoards(second);
    await enterBoard(page, 'Characters');

    // The minimap is back, derived from the item boxes alone.
    await expect(page.locator('[data-testid="board-minimap"]')).toHaveAttribute(
      'data-box-count',
      '3',
    );
    // The overlay returns to its off default — it is view state, not board
    // content — and turning it on reconstructs the same connector from the
    // vault's own links, with nothing having been stored to make that work.
    await expect(linksToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await enableOverlay(page);
    await expect(connectors(page)).toHaveCount(1);
    await expect(connectors(page).first()).toHaveAttribute('data-link-label', 'Aria links to Kesh');
    expect(fs.existsSync(charactersSidecar)).toBe(false);
  } finally {
    await second.close();
  }
});
