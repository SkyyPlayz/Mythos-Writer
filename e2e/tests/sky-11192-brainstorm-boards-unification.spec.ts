/**
 * sky-11192-brainstorm-boards-unification.spec.ts — SKY-11192 (Notes Board 9/9).
 *
 * Drives the real built app (out/main/main.js) against a REAL notes vault, so
 * every assertion crosses the whole boundary: Brainstorm's canvas → preload →
 * IPC → main → disk, and back out into the OTHER rendering of that same
 * filesystem, the Notes Board tab. A mocked `window.api` would prove none of
 * the ticket's central claim (COMPANY-STANDARDS §4a).
 *
 * §4c — nothing under test is pre-seeded:
 *   - the unified-board FLAG is flipped through the real Settings toggle, not
 *     written into app-settings.json, so the feature is proved reachable by a
 *     user rather than only by a fixture;
 *   - no `.mythos-board.json` sidecar and no filed note is written by the
 *     fixture; every one asserted on is created by the app itself;
 *   - the `File` click is a real Playwright click, so the DOM event is
 *     genuinely `isTrusted` — which is the whole point, since the write path
 *     refuses a synthetic one (AC 4, CEO ruling 5).
 *
 * Coverage (SKY-11192 ACs):
 *   1  A card moved on Brainstorm's Board page is in the same place in the
 *      Notes Board tab — SAME STATE, not a sync (AC1).
 *   2  And the reverse: a note created in the Notes Board tab shows up on
 *      Brainstorm's Board page (AC1, the other direction).
 *   3  `File` creates a real note in the correctly mapped folder and the board
 *      navigates to it (AC2).
 *   4  Filing the same idea twice is blocked by the existing-note-name check
 *      (AC3): the row turns into `Filed ✓` and the `File` control is gone.
 *   5  The three-pill row ships without a vault browser (CEO ruling 1), and
 *      each pill scopes the canvas to a real vault folder.
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11192-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    // NOTE: no `notesBoard.brainstormUnified` here — §4c. The flag is flipped
    // through the Settings UI by each test that needs it.
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

// ── App-driving helpers ─────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function boot(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

/**
 * Turn the unified board on the way a user would: Settings → Editor → Notes
 * Board → the toggle. Proves the flag is reachable (§4c) as a side effect of
 * every test that needs it.
 */
async function enableUnifiedBoard(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="settings-cat-editor"]').click();

  const toggle = page.locator('[data-testid="notes-board-brainstorm-unified"]');
  await expect(toggle).toBeVisible({ timeout: 8_000 });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  // Some Settings categories persist on an explicit Save; others apply live.
  const save = page.getByRole('button', { name: 'Save settings' });
  if (await save.isVisible().catch(() => false)) await save.click();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 8_000 });
}

const navBtn = (page: Page, label: string) =>
  page.locator(`nav[aria-label="Main navigation"] button[aria-label="${label}"]`);

/** Open the Brainstorm tab and land on its Board page. */
async function openBrainstormBoard(page: Page): Promise<void> {
  await navBtn(page, 'Brainstorm').click();
  // The Agent Chat | Board segment is only rendered when both pages are
  // reachable; with AI off Brainstorm opens straight onto the Board page.
  const boardSeg = page.locator('[data-testid="bsc-mode-board"]');
  if (await boardSeg.isVisible().catch(() => false)) await boardSeg.click();
  await expect(page.locator('[data-testid="brainstorm-board"]')).toBeVisible({ timeout: 12_000 });
}

/** Click one of the three folder-scope pills and wait for its canvas. */
async function pickPill(page: Page, folder: string): Promise<void> {
  const pill = page.locator('.bsb__pill', { hasText: folder }).first();
  await pill.click();
  await expect(pill).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-testid="brainstorm-board"] .board-canvas__root'))
    .toBeVisible({ timeout: 8_000 });
}

/** Open the Notes Board tab and navigate into a top-level folder. */
async function openBoardsTabFolder(page: Page, folder: string): Promise<void> {
  await navBtn(page, 'Boards').click();
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  await page.locator('.board-canvas__item--folder', { hasText: folder }).first().dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, {
    timeout: 8_000,
  });
}

const card = (page: Page, name: string) =>
  page.locator('.board-canvas__item--note', { hasText: name }).first();

/** Read a card's saved position out of the folder's REAL sidecar on disk. */
function sidecarLayout(notesDir: string, folder: string): Record<string, { x: number; y: number }> {
  const file = path.join(notesDir, folder, SIDECAR);
  if (!fs.existsSync(file)) return {};
  return (JSON.parse(fs.readFileSync(file, 'utf-8')).layout ?? {}) as Record<string, { x: number; y: number }>;
}

// ── AC1 — one state, not a sync: Brainstorm → Notes Board tab ───────────────

test('SKY-11192 AC1: a card moved on Brainstorm\'s Board page is in the same place in the Notes Board tab', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir } = makeTemp('roundtrip-fwd');
  mkNote(notesDir, 'Plot & Story/Midpoint Reversal.md', '# Midpoint Reversal\n');

  const app = await launchApp(userData);
  try {
    const page = await boot(app);
    await enableUnifiedBoard(page);
    await openBrainstormBoard(page);
    await pickPill(page, 'Plot & Story');

    // §4c: no layout exists yet — the drag below is what creates it.
    expect(sidecarLayout(notesDir, 'Plot & Story')).toEqual({});

    const target = card(page, 'Midpoint Reversal');
    await expect(target).toBeVisible({ timeout: 8_000 });
    const before = await target.boundingBox();
    if (!before) throw new Error('card not laid out');

    // Drag it somewhere unambiguous.
    await page.mouse.move(before.x + before.width / 2, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 220, before.y + 20 + 160, { steps: 12 });
    await page.mouse.up();

    // The move reached the REAL sidecar on disk, through main.
    await expect.poll(
      () => Object.keys(sidecarLayout(notesDir, 'Plot & Story')).length,
      { timeout: 10_000 },
    ).toBeGreaterThan(0);
    const saved = Object.values(sidecarLayout(notesDir, 'Plot & Story'))[0];
    expect(saved.x).toBeGreaterThan(0);

    // Where Brainstorm renders the card, in world coordinates.
    const placedHere = await target.evaluate(
      (el) => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top }),
    );
    expect(placedHere.left).toBe(`${saved.x}px`);
    expect(placedHere.top).toBe(`${saved.y}px`);

    // Now the other home. This is the AC: not "a sync has caught up", but the
    // same folder read again — the position is simply where it was left.
    await openBoardsTabFolder(page, 'Plot & Story');
    const echoed = card(page, 'Midpoint Reversal');
    await expect(echoed).toBeVisible({ timeout: 8_000 });

    // The Notes Board tab renders it at the SAME world position, having been
    // told nothing. One state, two views.
    const placedThere = await echoed.evaluate(
      (el) => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top }),
    );
    expect(placedThere).toEqual(placedHere);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC1 (reverse) — Notes Board tab → Brainstorm ────────────────────────────

test('SKY-11192 AC1: a note created in the Notes Board tab appears on Brainstorm\'s Board page', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir } = makeTemp('roundtrip-rev');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');

  const app = await launchApp(userData);
  try {
    const page = await boot(app);
    await enableUnifiedBoard(page);

    // Create the note from the NOTES BOARD TAB, using its canvas tools.
    await openBoardsTabFolder(page, 'Characters');
    await page.locator('.boards-tab-panel__tool[data-tool="note"]').click();
    await page.mouse.click(900, 560);
    const rename = page.locator('.board-canvas__item-rename');
    await expect(rename).toBeFocused({ timeout: 8_000 });
    await rename.fill('Bramble');
    await rename.press('Enter');

    await expect.poll(
      () => fs.existsSync(path.join(notesDir, 'Characters', 'Bramble.md')),
      { timeout: 10_000 },
    ).toBe(true);

    // Brainstorm's Board page, scoped to the same folder, shows it — because
    // it is reading the same folder, not a copy that had to be told.
    await openBrainstormBoard(page);
    await pickPill(page, 'Characters');
    await expect(card(page, 'Bramble')).toBeVisible({ timeout: 10_000 });
    await expect(card(page, 'Alice')).toBeVisible();
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC2 / AC3 — Idea Collections files a real note, once ────────────────────

test('SKY-11192 AC2+AC3: File creates a real note in the mapped folder, navigates to it, and refuses a second filing', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir } = makeTemp('file-idea');

  const app = await launchApp(userData);
  try {
    const page = await boot(app);
    await enableUnifiedBoard(page);
    await openBrainstormBoard(page);

    // Open a collection group so its rows render. `Themes` maps to Plot &
    // Story, which is the interesting case — four categories share it.
    await page.locator('[data-testid="bs-coll-toggle-theme"]').click();
    const row = page
      .locator('[data-testid="bs-coll-idea-row"][data-idea-title="Found Family"]')
      .first();
    await expect(row).toBeVisible({ timeout: 8_000 });

    // §4c: the folder does not exist yet. The click is what makes it.
    expect(fs.existsSync(path.join(notesDir, 'Plot & Story'))).toBe(false);

    // A REAL user click — the write path refuses anything else (AC4).
    await row.locator('[data-testid="bs-coll-file"]').click();

    // The real note, in the correctly mapped folder, with the idea's text.
    const notePath = path.join(notesDir, 'Plot & Story', 'Found Family.md');
    await expect.poll(() => fs.existsSync(notePath), { timeout: 10_000 }).toBe(true);
    expect(fs.readFileSync(notePath, 'utf-8')).toContain('# Found Family');

    // The board navigated to that folder and shows the new card.
    await expect(page.locator('.bsb__pill', { hasText: 'Plot & Story' }).first())
      .toHaveAttribute('aria-checked', 'true', { timeout: 8_000 });
    await expect(card(page, 'Found Family')).toBeVisible({ timeout: 10_000 });

    // AC3 — the row is now `Filed ✓` with an `Open`, and there is no `File`
    // control left to press. The check is by note NAME, so this survives a
    // restart and would also block a note the user made by hand.
    await expect(row.locator('[data-testid="bs-coll-filed"]')).toHaveText('Filed ✓', {
      timeout: 10_000,
    });
    await expect(row.locator('[data-testid="bs-coll-file"]')).toHaveCount(0);
    await expect(row.locator('[data-testid="bs-coll-open"]')).toBeVisible();

    // Exactly one note exists — no second copy, no `Found Family (2)`.
    expect(fs.readdirSync(path.join(notesDir, 'Plot & Story')).filter((f) => f.endsWith('.md')))
      .toEqual(['Found Family.md']);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── AC3 — a hand-written note of the same name also blocks filing ───────────

test('SKY-11192 AC3: an idea whose note the user already wrote by hand shows Filed, never a File button', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir } = makeTemp('prefiled');
  // The user's own note, written before they ever opened Idea Collections.
  mkNote(notesDir, 'Plot & Story/Found Family.md', 'MY OWN WORDS\n');

  const app = await launchApp(userData);
  try {
    const page = await boot(app);
    await enableUnifiedBoard(page);
    await openBrainstormBoard(page);

    await page.locator('[data-testid="bs-coll-toggle-theme"]').click();
    const row = page
      .locator('[data-testid="bs-coll-idea-row"][data-idea-title="Found Family"]')
      .first();
    await expect(row.locator('[data-testid="bs-coll-filed"]')).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('[data-testid="bs-coll-file"]')).toHaveCount(0);

    // And their words are untouched.
    expect(fs.readFileSync(path.join(notesDir, 'Plot & Story', 'Found Family.md'), 'utf-8'))
      .toContain('MY OWN WORDS');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── CEO ruling 2 — the old board's ideas become real notes, once ────────────

/**
 * A v2 MythosVault, which is what the migration needs: the retired board lives
 * at `Agent Vault/Boards/brainstorm.board.json`, a sibling of the Notes Vault,
 * and that layout only exists under a `mythos.json` root.
 */
function makeV2Vault(slug: string, cards: Array<Record<string, unknown>>): {
  tempRoot: string; userData: string; notesDir: string; boardFile: string;
} {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11192-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const bundle = path.join(tempRoot, 'MythosVault');
  const storyDir = path.join(bundle, 'Story Vault');
  const notesDir = path.join(bundle, 'Notes Vault');
  const boardsDir = path.join(bundle, 'Agent Vault', 'Boards');
  for (const d of [userData, storyDir, notesDir, boardsDir]) fs.mkdirSync(d, { recursive: true });

  const now = new Date().toISOString();
  fs.writeFileSync(path.join(bundle, 'mythos.json'), JSON.stringify({
    formatVersion: 2,
    id: 'vault-sky11192',
    name: 'Unification Vault',
    createdAt: now,
    stories: [],
    // Seed marker present → the demo-content seeder must never run here.
    seed: { layout: 'veynn-v2', mode: 'blank', seededAt: now },
  }, null, 2));

  const boardFile = path.join(boardsDir, 'brainstorm.board.json');
  fs.writeFileSync(boardFile, JSON.stringify({
    version: 1, draftMigrated: false, links: [], cards,
  }, null, 2));

  fs.writeFileSync(path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2));

  return { tempRoot, userData, notesDir, boardFile };
}

test('SKY-11192 ruling 2: turning the flag on migrates the old board into real notes and parks the file', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir, boardFile } = makeV2Vault('migrate', [
    { id: 'c1', cat: 'beats', title: 'Midpoint Reversal', desc: 'The goal changes.', chips: [] },
    { id: 'c2', cat: 'rel', title: 'Mira and Vale', desc: 'Rivals.', chips: [] },
    { id: 'c3', cat: 'world', title: 'The Deep Vault', desc: 'Under the city.', chips: [] },
  ]);

  const app = await launchApp(userData);
  try {
    const page = await boot(app);
    await enableUnifiedBoard(page);
    await openBrainstormBoard(page);

    // Every card is now a real note, in the folder its category maps to.
    for (const rel of [
      'Plot & Story/Midpoint Reversal.md',
      'Characters/Mira and Vale.md',
      'Worldbuilding/The Deep Vault.md',
    ]) {
      await expect.poll(() => fs.existsSync(path.join(notesDir, rel)), { timeout: 15_000 }).toBe(true);
    }
    expect(fs.readFileSync(path.join(notesDir, 'Plot & Story/Midpoint Reversal.md'), 'utf-8'))
      .toContain('The goal changes.');

    // The user's DATA is not deleted — the source file is parked, not dropped.
    await expect.poll(() => fs.existsSync(`${boardFile}.migrated`), { timeout: 15_000 }).toBe(true);
    expect(fs.existsSync(boardFile)).toBe(false);
    expect(JSON.parse(fs.readFileSync(`${boardFile}.migrated`, 'utf-8')).cards).toHaveLength(3);

    // And the migrated ideas are on the board, reachable as ordinary notes.
    await pickPill(page, 'Characters');
    await expect(card(page, 'Mira and Vale')).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── CEO ruling 1 — three pills, no vault browser ────────────────────────────

test('SKY-11192: the Board page ships exactly three folder pills and no vault browser', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir } = makeTemp('pills');
  mkNote(notesDir, 'Characters/Alice.md');
  mkNote(notesDir, 'Worldbuilding/The Deep Vault.md');

  const app = await launchApp(userData);
  try {
    const page = await boot(app);
    await enableUnifiedBoard(page);
    await openBrainstormBoard(page);

    await expect(page.locator('.bsb__pill')).toHaveText([
      'Plot & Story', 'Characters', 'Worldbuilding',
    ]);
    await expect(page.getByText('Browse vault')).toHaveCount(0);
    await expect(page.getByText('This is your Notes Vault, viewed here.')).toBeVisible();

    // Each pill really scopes the canvas to that vault folder.
    await pickPill(page, 'Characters');
    await expect(card(page, 'Alice')).toBeVisible({ timeout: 8_000 });
    await expect(card(page, 'The Deep Vault')).toHaveCount(0);

    await pickPill(page, 'Worldbuilding');
    await expect(card(page, 'The Deep Vault')).toBeVisible({ timeout: 8_000 });
    await expect(card(page, 'Alice')).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
