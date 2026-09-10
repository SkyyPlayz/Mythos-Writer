/**
 * sky-11674-brainstorm-boards-unification.spec.ts — SKY-11192/SKY-11674.
 *
 * Real E2E across the process boundary (COMPANY-STANDARDS §4a): drives the
 * built app against a real notes-vault fixture, no mocked `window.api`.
 *
 * Coverage:
 *   1. A board edit made from the Notes Board tab is immediately visible
 *      from Brainstorm's Board page (flag on), and the reverse — same
 *      state, not a sync (design spec §1).
 *   2. Idea Collections' `File` action creates a real note in the correctly
 *      mapped folder and it appears in the Notes Board tab too (§3).
 *
 * Per §4c, nothing under test is pre-seeded: the notes referenced below are
 * seeded only as CONTEXT (so there is something to drag / a folder that
 * already exists), never as the position-persistence or filing behavior
 * itself — every position change and every filed note is produced by the
 * app through the real UI.
 *
 * The migration of pre-existing `Boards/brainstorm.board.json` data (a
 * MythosVault-v2-only path) is verified at the unit level against a real
 * filesystem — see electron-main/src/mythosFormat/brainstormBoardMigration.test.ts
 * — rather than duplicated here as a full Electron E2E.
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11674-${slug}-`));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      brainstormBoardsUnification: true,
      agents: {
        writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30 },
        brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001' },
        archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60 },
      },
    }, null, 2),
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

async function bootApp(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(userData);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return { app, page };
}

async function openBoardsTab(page: Page): Promise<void> {
  const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
  await boardsBtn.click();
  await expect(page.locator('[role="main"][aria-label="Boards"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
}

async function enterBoard(page: Page, folder: string): Promise<void> {
  await page.locator('.board-canvas__item--folder', { hasText: folder }).first().dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, { timeout: 8_000 });
}

/** SKY-3737/SKY-3218: Ctrl+3 opens Brainstorm regardless of nav-rail width. */
async function openBrainstorm(page: Page): Promise<void> {
  await page.keyboard.press('Control+3');
  await expect(page.locator('#app-tabpanel-brainstorm')).toBeVisible({ timeout: 6_000 });
}

// ── §1: same state in both homes, edited from either ─────────────────────────

test('SKY-11192/SKY-11674 §1: a board edit from the Notes Board tab is visible from Brainstorm\'s Board page, and the reverse', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('roundtrip');
  // Context only (§4c) — the note that gets dragged; its EXISTENCE isn't
  // what's under test, its DRAGGED POSITION crossing homes is.
  mkNote(notesDir, 'Plot & Story/Midpoint Twist.md', '# Midpoint Twist\n');

  const { app, page } = await bootApp(userData);
  try {
    // Drag the card from the Notes Board tab.
    await openBoardsTab(page);
    await enterBoard(page, 'Plot & Story');
    const noteCard = page.locator('.board-canvas__item', { hasText: 'Midpoint Twist' }).first();
    const box = await noteCard.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + 20, box!.y + 12);
    await page.mouse.down();
    await page.mouse.move(box!.x + 20 + 160, box!.y + 12 + 110, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600); // past NOTES_BOARD_DEBOUNCE_MS (notesBoard.ts)

    // The sidecar has the moved position — this is the real state both
    // homes read, not a value held only in this tab's React state.
    const sidecarPath = path.join(notesDir, 'Plot & Story', SIDECAR);
    expect(fs.existsSync(sidecarPath)).toBe(true);
    const firstSidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    const firstKey = Object.keys(firstSidecar.layout ?? {}).find((k) => k.startsWith('n:'));
    expect(firstKey).toBeTruthy();
    const movedX = firstSidecar.layout[firstKey!].x;

    // Now open Brainstorm's Board page — same folder, same state.
    await openBrainstorm(page);
    await page.locator('[data-testid="bsc-mode-board"]').click();
    await expect(page.locator('[data-testid="bbs-canvas"]')).toBeVisible({ timeout: 8_000 });
    // Plot & Story is the default pill.
    await expect(page.locator('[data-testid="bbs-pill-plot"]')).toHaveAttribute('aria-selected', 'true');
    const brainstormCard = page.locator('.board-canvas__item', { hasText: 'Midpoint Twist' }).first();
    await expect(brainstormCard).toBeVisible({ timeout: 8_000 });
    const brainstormStyle = (await brainstormCard.getAttribute('style')) ?? '';
    expect(Number(/left:\s*([\d.]+)px/.exec(brainstormStyle)?.[1])).toBe(movedX);

    // The reverse: drag it again from Brainstorm's Board page.
    const bBox = await brainstormCard.boundingBox();
    expect(bBox).toBeTruthy();
    await page.mouse.move(bBox!.x + 20, bBox!.y + 12);
    await page.mouse.down();
    await page.mouse.move(bBox!.x + 20 + 130, bBox!.y + 12 + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const secondSidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    const secondKey = Object.keys(secondSidecar.layout ?? {}).find((k) => k.startsWith('n:'));
    expect(secondKey).toBeTruthy();
    const secondMoveX = secondSidecar.layout[secondKey!].x;
    expect(secondMoveX).not.toBe(movedX);

    // Back to the Notes Board tab (its breadcrumb resets to Home on
    // remount, so re-enter Plot & Story) — it reflects the SECOND move too.
    await openBoardsTab(page);
    await enterBoard(page, 'Plot & Story');
    const finalCard = page.locator('.board-canvas__item', { hasText: 'Midpoint Twist' }).first();
    await expect(finalCard).toBeVisible({ timeout: 8_000 });
    const finalStyle = (await finalCard.getAttribute('style')) ?? '';
    expect(Number(/left:\s*([\d.]+)px/.exec(finalStyle)?.[1])).toBe(secondMoveX);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── §3: Idea Collections File → a real note, visible in the Notes Board tab ──

test('SKY-11192/SKY-11674 §3: Idea Collections File creates a real note in the mapped folder', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('filing');

  const { app, page } = await bootApp(userData);
  try {
    await openBrainstorm(page);

    // §4c: the Plot & Story folder and the note do not exist yet — the
    // File click is what creates both.
    expect(fs.existsSync(path.join(notesDir, 'Plot & Story'))).toBe(false);

    await page.locator('[data-testid="bs-coll-toggle-trope"]').click();
    const row = page.locator('.bs-coll-idea', { hasText: 'The Chosen One' }).first();
    await expect(row).toBeVisible();
    await row.getByTestId('bs-coll-file').click();

    // Filed state replaces the File button.
    await expect(row.getByText('Filed ✓')).toBeVisible({ timeout: 8_000 });
    await expect(row.getByTestId('bs-coll-open')).toBeVisible();

    // The real file, in the mapped folder.
    const created = path.join(notesDir, 'Plot & Story', 'The Chosen One.md');
    await expect.poll(() => fs.existsSync(created), { timeout: 8_000 }).toBe(true);
    expect(fs.readFileSync(created, 'utf-8')).toContain('The Chosen One');

    // The Notes Board tab shows it too — one filesystem, two renderings.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
    await page.locator('.board-canvas__item--folder', { hasText: 'Plot & Story' }).first().dblclick();
    await expect(page.locator('.board-canvas__item', { hasText: 'The Chosen One' })).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
