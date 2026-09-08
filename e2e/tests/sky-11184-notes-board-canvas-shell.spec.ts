/**
 * sky-11184-notes-board-canvas-shell.spec.ts — SKY-11335: the real Electron
 * E2E coverage the SKY-11184 Notes Board canvas shell shipped without.
 *
 * Drives the actual built app (out/main/main.js) across the process boundary
 * against a REAL notes vault fixture (Store A: on-disk folders + .md notes).
 * Per COMPANY-STANDARDS §4c the thing under test — the board canvas / its
 * Store B layout metadata (`.mythos-board.json`) — is NEVER pre-seeded: every
 * board sidecar in these tests is created by the app itself through genuine
 * drag interactions. Only the vault content the boards read is seeded.
 *
 * Coverage (SKY-11184 ACs / BOARDS-SPEC §15):
 *   1. Reachability (AC1)      — Boards tab reachable by ordinary left-nav
 *                                clicks; folders render as board tiles with
 *                                child counts, notes as cards; double-clicking
 *                                a tile enters that board and shows exactly its
 *                                immediate children (the correct board/card
 *                                tree).
 *   2. Persistence (AC2, §15.2)— drag a card inside a board, quit, relaunch →
 *                                the card is at the persisted position via the
 *                                SKY-11183 id-keyed sidecar store.
 *   3. No-cap layout (AC3,§15.4)— a board with 200+ children lays out every
 *                                item (no cap), none pushed off-canvas, canvas
 *                                grows vertically.
 *   4. Rename-follows (AC4,§15.3)— drag a folder tile, rename that folder on
 *                                disk, relaunch → the tile follows to the same
 *                                position under its new label with NO Store B
 *                                rewrite (layout keyed by stable id, not path).
 *
 * SKY-11336 — the Home/top-level board defect this coverage surfaced (absolute
 * folderPath → flattened recursive listing + Home-level drag not persisted) —
 * is now fixed, and the two tests at the bottom assert Home-board correctness
 * plus the depth-2 nesting that the vault-relative folderPath contract makes
 * possible.
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

// ── Fixture helpers ─────────────────────────────────────────────────────────

/** Write the onboarding-complete profile + vault bindings. No board metadata. */
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

function mkFolder(notesDir: string, rel: string): void {
  fs.mkdirSync(path.join(notesDir, rel), { recursive: true });
}
function mkNote(notesDir: string, rel: string, body = '# Note\n'): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11335-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  writeProfile(userData, storyDir, notesDir);
  return { tempRoot, userData, notesDir };
}

// ── App-driving helpers ──────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

/** Boot, size the window, and click the Boards tab in the left nav rail. */
async function bootToBoards(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Reachability: an ordinary click on the nav-rail Boards button (no test
  // hooks, no pre-navigation) reaches the Boards tab panel + its canvas.
  const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
  await expect(boardsBtn).toHaveCount(1);
  await boardsBtn.click();
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  return page;
}

const items = (page: Page) => page.locator('.board-canvas__item');
const folderTile = (page: Page, name: string) =>
  page.locator('.board-canvas__item--folder', { hasText: name }).first();
const card = (page: Page, name: string) =>
  page.locator('.board-canvas__item', { hasText: name }).first();

/** Double-click a folder tile to enter that board; wait for its reload. */
async function enterBoard(page: Page, folder: string): Promise<void> {
  await folderTile(page, folder).dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, {
    timeout: 8_000,
  });
}

/** Drag a board item by (dx, dy) device px and let the debounced write flush. */
async function dragItem(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const el = card(page, name);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no bounding box for "${name}"`);
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + dx, box.y + 12 + dy, { steps: 8 });
  await page.mouse.up();
  // NOTES_BOARD_DEBOUNCE_MS is 250ms; wait past it so the sidecar is on disk
  // (belt-and-suspenders — quit also flushes via flushPendingNotesBoardWrites).
  await page.waitForTimeout(500);
}

/** Parse `left`/`top` (px) off an item's inline style. */
async function itemPos(page: Page, name: string): Promise<{ left: number; top: number }> {
  const style = (await card(page, name).getAttribute('style')) ?? '';
  const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1]);
  const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1]);
  return { left, top };
}

function readSidecar(notesDir: string, folderRel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(notesDir, folderRel, SIDECAR), 'utf-8'));
}

// ── AC1 — Reachability + correct board/card tree ─────────────────────────────

test('SKY-11184 AC1: Boards reachable; folders→tiles, notes→cards; enter shows the correct tree', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('reach');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Characters/Bob.md', '# Bob\n');
  mkNote(notesDir, 'Characters/Carol.md', '# Carol\n');
  mkNote(notesDir, 'Locations/Castle.md', '# Castle\n');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);

    // Top-level folders render as board tiles WITH child counts read from the
    // vault (spec §5), and root notes render as cards.
    await expect(folderTile(page, 'Characters')).toBeVisible({ timeout: 8_000 });
    await expect(folderTile(page, 'Characters').locator('.board-canvas__item-meta')).toHaveText(
      '0 boards, 3 cards',
    );
    await expect(folderTile(page, 'Locations').locator('.board-canvas__item-meta')).toHaveText(
      '0 boards, 1 cards',
    );
    await expect(page.locator('.board-canvas__item--note', { hasText: 'Intro' })).toBeVisible();

    // Home breadcrumb present; entering a tile navigates in and shows EXACTLY
    // that board's immediate children — the correct board/card tree.
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText('Home');
    await enterBoard(page, 'Characters');
    await expect(items(page)).toHaveCount(3);
    await expect(
      page.locator('.board-canvas__item-name', { hasText: /^(Alice|Bob|Carol)$/ }),
    ).toHaveCount(3);
    // Breadcrumb now: Home / Characters, and Home is a clickable crumb.
    await expect(page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' })).toBeVisible();

    // Navigate back Home via the breadcrumb.
    await page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' }).click();
    await expect(folderTile(page, 'Characters')).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC2 — Drag persistence across a real quit + relaunch (§15.2) ──────────────

test('SKY-11184 AC2: a dragged card keeps its position across quit + relaunch', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('persist');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Characters/Bob.md', '# Bob\n');

  // Session 1: enter the board, drag a card, verify the sidecar reached disk.
  let app = await launchApp(userData);
  let persisted = { left: 0, top: 0 };
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');
    // No board metadata exists yet — the drag is what creates it (§4c).
    expect(fs.existsSync(path.join(notesDir, 'Characters', SIDECAR))).toBe(false);

    await dragItem(page, 'Alice', 130, 90);
    persisted = await itemPos(page, 'Alice');

    // A real sidecar now exists, keyed by Alice's stable id (n:<uuid>).
    const sidecar = readSidecar(notesDir, 'Characters');
    const layout = sidecar.layout as Record<string, { x: number; y: number }>;
    const keys = Object.keys(layout);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^n:.+/);
    expect(layout[keys[0]]).toMatchObject({ x: persisted.left, y: persisted.top });
  } finally {
    await app.close().catch(() => undefined);
  }

  // Session 2: genuine relaunch — the card is back at the persisted position.
  app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');
    const after = await itemPos(page, 'Alice');
    expect(after).toEqual(persisted);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC3 — 200+ children lay out with no cap, none off-canvas (§15.4) ──────────

test('SKY-11184 AC3: a board with 200+ children lays out uncapped, nothing off-canvas', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('nocap');
  const N = 220;
  mkFolder(notesDir, 'Crowd');
  for (let i = 0; i < N; i++) {
    mkNote(notesDir, `Crowd/n${String(i).padStart(3, '0')}.md`, `# Note ${i}\n`);
  }

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Crowd');

    // No cap: every one of the 220 children is rendered.
    await expect(items(page)).toHaveCount(N);

    // Nothing pushed off-canvas, and the canvas grew vertically to fit.
    const geom = await page.locator('.board-canvas__world').evaluate((el) => {
      const world = el as HTMLElement;
      const worldW = parseFloat(world.style.width);
      const worldH = parseFloat(world.style.height);
      let minLeft = Infinity;
      let maxRight = -Infinity;
      let maxBottom = -Infinity;
      for (const node of Array.from(el.querySelectorAll('.board-canvas__item'))) {
        const it = node as HTMLElement;
        const l = parseFloat(it.style.left);
        const t = parseFloat(it.style.top);
        const w = parseFloat(it.style.width);
        const h = parseFloat(it.style.height);
        minLeft = Math.min(minLeft, l);
        maxRight = Math.max(maxRight, l + w);
        maxBottom = Math.max(maxBottom, t + h);
      }
      return { worldW, worldH, minLeft, maxRight, maxBottom };
    });

    expect(geom.minLeft).toBeGreaterThanOrEqual(0); // no item off the left/top
    expect(geom.maxRight).toBeLessThanOrEqual(geom.worldW + 1); // none off the right
    expect(geom.maxBottom).toBeLessThanOrEqual(geom.worldH + 1); // none off the bottom
    expect(geom.worldH).toBeGreaterThan(600); // canvas grew past its 600px floor
    expect(geom.maxBottom).toBeGreaterThan(900); // rows extend well below one screen
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC4 — Rename a folder → its tile follows by id, no Store B rewrite (§15.3) ─

test('SKY-11184 AC4: renaming a folder moves its board tile by id with no metadata rewrite', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('rename');
  mkNote(notesDir, 'Series/BookOne/Ch1.md', '# Ch1\n'); // BookOne is a subfolder tile inside Series

  // Session 1: enter Series, drag the BookOne folder tile to a known position.
  let app = await launchApp(userData);
  let target = { left: 0, top: 0 };
  let folderId = '';
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Series');
    await dragItem(page, 'BookOne', 210, 170);
    target = await itemPos(page, 'BookOne');

    // Parent (Series) layout is keyed by the folder's stable id (v:<uuid>),
    // which lives in BookOne's OWN sidecar so it travels on rename.
    const seriesLayout = readSidecar(notesDir, 'Series').layout as Record<string, unknown>;
    const key = Object.keys(seriesLayout)[0];
    expect(key).toMatch(/^v:.+/);
    folderId = key.slice(2);
    expect(readSidecar(notesDir, 'Series/BookOne').id).toBe(folderId);
  } finally {
    await app.close().catch(() => undefined);
  }

  // Rename the folder on disk while the app is closed (a real vault rename —
  // the id-bearing sidecar moves inside the folder, untouched).
  const seriesSidecarBefore = fs.readFileSync(path.join(notesDir, 'Series', SIDECAR), 'utf-8');
  fs.renameSync(path.join(notesDir, 'Series', 'BookOne'), path.join(notesDir, 'Series', 'Vol1'));

  // Session 2: relaunch — the tile follows to the SAME position under its new
  // label, and the parent's Store B metadata was NOT rewritten.
  app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Series');

    await expect(folderTile(page, 'Vol1')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.board-canvas__item--folder', { hasText: 'BookOne' })).toHaveCount(0);
    const after = await itemPos(page, 'Vol1');
    expect(after).toEqual(target);

    // "Without a metadata rewrite": the parent sidecar is byte-identical and
    // still keyed by the same id — path never entered Store B.
    const seriesSidecarAfter = fs.readFileSync(path.join(notesDir, 'Series', SIDECAR), 'utf-8');
    expect(seriesSidecarAfter).toBe(seriesSidecarBefore);
    expect(seriesSidecarAfter).toContain(folderId);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── SKY-11336 — the Home / top-level board ───────────────────────────────────
//
// SKY-11184 seeded the Home breadcrumb with the ABSOLUTE notes-vault path where
// every notesBoard IPC handler expects a vault-RELATIVE one, which produced two
// user-visible defects at Home (and only at Home — a subfolder's breadcrumb path
// was already relative):
//   (a) Home rendered a FLATTENED recursive listing, because listNotesVault is
//       recursive but was consumed as if it were an immediate listing;
//   (b) a Home-level drag was not persisted — the absolute path resolved to a
//       doubled, non-existent folder, so patchLayout threw item-not-found into
//       an empty catch and no sidecar was ever written.
// The fix normalises folderPath to vault-relative in the renderer (Home = '')
// and derives each board's items from the immediate children only.

test('SKY-11336 (a+b): Home shows only immediate children and persists a Home-level drag', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('home-board');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Characters/Bob.md', '# Bob\n');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  // Session 1: Home renders the right tree, and a drag there reaches disk.
  let app = await launchApp(userData);
  let persisted = { left: 0, top: 0 };
  try {
    const page = await bootToBoards(app);
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText('Home');

    // (a) Exactly the two immediate children — the nested Alice/Bob notes are
    // the Characters board's contents, never Home's.
    await expect(items(page)).toHaveCount(2);
    await expect(folderTile(page, 'Characters')).toBeVisible();
    await expect(page.locator('.board-canvas__item--note', { hasText: 'Intro' })).toBeVisible();
    await expect(page.locator('.board-canvas__item-name', { hasText: /^(Alice|Bob)$/ })).toHaveCount(0);
    // Counts on the Home tile are still the folder's DIRECT children (spec §5).
    await expect(folderTile(page, 'Characters').locator('.board-canvas__item-meta')).toHaveText(
      '0 boards, 2 cards',
    );

    // (b) QA's repro: drag the Characters tile on the Home board. No board
    // metadata exists anywhere yet — the drag is what creates it (§4c).
    expect(fs.existsSync(path.join(notesDir, SIDECAR))).toBe(false);
    await dragItem(page, 'Characters', 192, 156);
    persisted = await itemPos(page, 'Characters');

    // A real sidecar now exists at the VAULT ROOT — the Home board's own
    // folder — keyed by the folder's stable id (v:<uuid>).
    const layout = readSidecar(notesDir, '.').layout as Record<string, { x: number; y: number }>;
    const keys = Object.keys(layout);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^v:.+/);
    expect(layout[keys[0]]).toMatchObject({ x: persisted.left, y: persisted.top });
  } finally {
    await app.close().catch(() => undefined);
  }

  // Session 2: genuine relaunch — the Home tile is back where it was left.
  app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(folderTile(page, 'Characters')).toBeVisible({ timeout: 8_000 });
    expect(await itemPos(page, 'Characters')).toEqual(persisted);
    await expect(items(page)).toHaveCount(2); // still not flattened after reload
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── SKY-11336 — boards below the first level must not regress ────────────────
//
// With folderPath vault-relative everywhere, entering a board has to JOIN the
// tile's (board-relative) path onto the current folder. A bare item path was
// only ever correct one level below Home, so depth 2 is the guard that keeps
// the contract honest.

test('SKY-11336: nested boards address correctly at depth 2 and persist there', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('home-nested');
  mkNote(notesDir, 'Series/BookOne/Ch1.md', '# Ch1\n');
  mkNote(notesDir, 'Series/Notes.md', '# Notes\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);

    // Home: one tile, whose counts describe its DIRECT children only.
    await expect(items(page)).toHaveCount(1);
    await expect(folderTile(page, 'Series').locator('.board-canvas__item-meta')).toHaveText(
      '1 boards, 1 cards',
    );

    // Depth 1 — Home / Series.
    await enterBoard(page, 'Series');
    await expect(items(page)).toHaveCount(2);
    await expect(folderTile(page, 'BookOne')).toBeVisible();

    // Depth 2 — Home / Series / BookOne. Before the fix this addressed
    // `<root>/BookOne`, which does not exist.
    await enterBoard(page, 'BookOne');
    await expect(items(page)).toHaveCount(1);
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Ch1' })).toBeVisible();
    await expect(page.locator('.boards-tab-panel__breadcrumb-btn')).toHaveCount(2); // Home, Series

    // A drag at depth 2 writes to the nested board's own folder, not the root.
    await dragItem(page, 'Ch1', 140, 100);
    expect(fs.existsSync(path.join(notesDir, 'Series', 'BookOne', SIDECAR))).toBe(true);
    expect(fs.existsSync(path.join(notesDir, SIDECAR))).toBe(false);

    // Breadcrumb walks all the way back out.
    await page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' }).click();
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText('Home');
    await expect(items(page)).toHaveCount(1);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
