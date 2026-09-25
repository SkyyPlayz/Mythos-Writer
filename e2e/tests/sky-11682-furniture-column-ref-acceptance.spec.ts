/**
 * sky-11682-furniture-column-ref-acceptance.spec.ts — SKY-11682: independent
 * acceptance-test pass for SKY-11188 (furniture + column-ref), the slice the
 * SKY-11666 pass did not cover. Written from `BOARDS-SPEC.md` v2 §4/§11/§15
 * (host path `/mnt/c/Users/SkyLo/Desktop/mythos stuff/BOARDS-SPEC.md`) and
 * SKY-11188's own stated acceptance criteria, NOT from reading
 * BoardFurniture.tsx/BoardCanvas.tsx behaviour. Only enough of the shipped
 * `e2e/tests/sky-11188-notes-board-furniture.spec.ts` was read to reuse
 * existing launch/selector scaffolding (an established UI contract other
 * specs already depend on), not to copy its assertions.
 *
 * SKY-11188's own e2e coverage (toolbar reachability, CRUD, line
 * cascade-delete, ref-renders-and-navigates, §14 placeholder labelling) is
 * solid but leaves the two most-cited "quietly skipped" claims from the
 * ticket's priority criteria untested:
 *
 *   GAP-1  spec §4/§15 test 6, first half: "A column item's `ref`
 *          participates in the rename cascade (SKY-10712)." No existing
 *          spec renames the note a column `ref` points at and checks the
 *          sidecar's `ref` field, or that the link still resolves after.
 *   GAP-2  spec §4/§15 test 6, second half: "...shows up in the Links tab."
 *          `noteBacklinks.ts` returns a `boardRefs` list and `Backlinks.tsx`
 *          renders it as a `BOARD` chip (`board-backlink-<path>` testid) —
 *          no existing spec ever opens a note that a column item references
 *          and checks its own Backlinks panel, or that clicking the chip
 *          navigates to the referencing board.
 *
 * All fixtures are real files on disk; nothing under test (board sidecars,
 * backlinks scan) is pre-seeded — every claim is produced by driving the
 * actual UI, per COMPANY-STANDARDS §4c. The column `ref` itself is created
 * via the app's own `notesBoardFurnitureCreate` IPC call rather than a
 * hand-written sidecar file or the toolbar — per SKY-11188's PR notes the
 * toolbar deliberately has no note-picker UI (out of scope for that
 * ticket), so this is the same real-app seam the shipped spec already uses
 * for the identical reason. Everything downstream of that — rename,
 * Backlinks panel, board navigation — is driven through the real UI.
 *
 * TEST-FILES-ONLY: this file does not, and must not, touch product code.
 * Any failure below is reported on SKY-11682/SKY-11188 and routed to the
 * owning slice, not fixed here.
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

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11682-${slug}-`));
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

function readSidecar(notesDir: string, folderRel = ''): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(notesDir, folderRel, SIDECAR), 'utf-8'));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootApp(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

async function gotoBoards(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
}

async function gotoNotes(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
}

/** Seed a column furniture item via the app's own IPC surface (see file header). */
async function seedColumnRef(
  page: Page,
  folderPath: string,
  opts: { title: string; itemText: string; ref: string },
): Promise<void> {
  await page.evaluate(
    async ({ folderPath, opts }) => {
      await (window as unknown as {
        api: { notesBoardFurnitureCreate: (f: string, i: unknown) => Promise<unknown> };
      }).api.notesBoardFurnitureCreate(folderPath, {
        k: 'column',
        x: 400,
        y: 44,
        title: opts.title,
        items: [{ t: opts.itemText, ref: opts.ref }],
      });
    },
    { folderPath, opts },
  );
}

// ═════════════════════════════════════════════════════════════════════════
// GAP-1 — a column ref's target note rewrites through the rename cascade.
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11682 GAP-1: renaming a column ref\'s target note rewrites the sidecar ref and the link keeps resolving', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap1-rename-cascade');
  mkNote(notesDir, 'Target.md', '# Target\n\nOriginal target content.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootApp(app);
    await gotoBoards(page);

    await seedColumnRef(page, '', { title: 'Quick links', itemText: 'Target', ref: 'Target.md' });

    // Reload the board's own data (no push channel — same pattern the
    // shipped SKY-11188 spec uses for its own ref tests).
    await gotoNotes(page);
    await gotoBoards(page);

    const refLink = page.locator('.board-canvas__furniture-ref', { hasText: 'Target' });
    await expect(refLink).toBeVisible({ timeout: 10_000 });

    // Rename the target note via the Notes tree's own context menu — a real
    // vault mutation, not a hand-edited sidecar.
    await gotoNotes(page);
    const row = page.locator('[data-testid="vb-row-Target.md"]');
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.click({ button: 'right' });
    const ctxMenu = page.locator('[data-testid="vb-context-menu"]');
    await expect(ctxMenu).toBeVisible({ timeout: 8_000 });
    await ctxMenu.getByText('Rename…').click();
    const renameInput = page.locator('input[aria-label="Rename"]');
    await expect(renameInput).toBeFocused({ timeout: 8_000 });
    await renameInput.fill('Destination');
    await renameInput.press('Enter');

    await expect.poll(
      () => fs.existsSync(path.join(notesDir, 'Destination.md')),
      { timeout: 10_000 },
    ).toBe(true);
    expect(fs.existsSync(path.join(notesDir, 'Target.md'))).toBe(false);

    // The sidecar's own `ref` field — not just app-visible behaviour — has
    // to have actually been rewritten by the cascade (spec §4: "participates
    // in the rename cascade", exactly like a `[[wikilink]]`).
    await expect.poll(() => {
      const sidecar = readSidecar(notesDir);
      const furniture = sidecar.furniture as Array<{ k: string; items?: Array<{ ref?: string }> }>;
      const col = furniture.find((f) => f.k === 'column');
      return col?.items?.[0]?.ref;
    }, { timeout: 10_000 }).toBe('Destination.md');

    // The link still renders and still resolves — clicking it opens the
    // renamed note's real content, proving the rewritten ref actually
    // resolves rather than just matching a string on disk.
    await gotoBoards(page);
    const refLinkAfter = page.locator('.board-canvas__furniture-ref', { hasText: 'Target' });
    await expect(refLinkAfter).toBeVisible({ timeout: 10_000 });
    await refLinkAfter.click();
    await expect(page.locator('[role="tabpanel"][aria-labelledby="app-tab-notes"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="notes-tab-center"]').getByText('Original target content.')).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// GAP-2 — a column ref shows up in the target note's own Links (Backlinks)
// tab as a BOARD chip, and clicking it navigates to the referencing board.
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11682 GAP-2: a column ref shows up in the target note\'s Links tab as a BOARD chip and navigates to the board', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap2-links-tab');
  mkNote(notesDir, 'Locations/Cove.md', '# Cove\n\nA quiet inlet, referenced from the board.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootApp(app);
    await gotoBoards(page);

    await seedColumnRef(page, 'Locations', {
      title: 'Nearby landmarks',
      itemText: 'See the Cove',
      ref: 'Cove.md',
    });

    // Open the referenced note directly (not via the board) and inspect its
    // own Backlinks panel — the "Links tab" the ticket names.
    await gotoNotes(page);
    const row = page.locator('[data-testid="vb-row-Locations/Cove.md"]');
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.click();

    // The full Backlinks component (which includes boardRefs) lives under
    // the note's own "Properties" side-panel tab — distinct from the vault
    // tree's own "Backlinks" sidebar toggle (`vb-backlinks`), which only
    // ever reads `res.backlinks` and never surfaces `boardRefs` (§4/§11).
    await page.locator('.notes-right-tabs[aria-label="Notes side panel"] button', { hasText: 'Properties' }).click();

    const panel = page.locator('[data-testid="note-backlinks-panel"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const boardChipRow = page.locator('[data-testid="board-backlink-Locations"]');
    await expect(boardChipRow).toBeVisible({ timeout: 10_000 });
    await expect(boardChipRow).toContainText('BOARD');
    // The furniture item's own title (not just "some board") — proves this
    // is a specific, real column-ref entry, not a coincidental match.
    await expect(boardChipRow).toContainText('Nearby landmarks');
    await expect(boardChipRow).toContainText('See the Cove');

    // Clicking the BOARD chip navigates to the referencing board (spec §4:
    // this is a real cross-surface link, not a decorative label).
    await boardChipRow.click();
    await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText('Locations', { timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
