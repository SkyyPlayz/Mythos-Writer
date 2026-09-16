/**
 * sky-11682-board-ref-rename-cascade-links-tab.spec.ts — SKY-11682:
 * independent acceptance pass for SKY-11188 (PR #1513), focused on the
 * priority criterion most likely to have been quietly skipped: a Notes
 * Board `column` item's `ref` must participate in the SKY-10712 rename
 * cascade AND show up in a note's own Links (Backlinks) tab — not a
 * bespoke "board ref link" class, but the same wikilink citizen everywhere
 * else. Written from SKY-11188's stated acceptance criteria (§4/§11), not
 * from reading BoardFurniture.tsx's implementation.
 *
 * Real E2E across the process boundary (UI -> IPC -> main -> disk); no
 * mocked window.api. The furniture item is created through the app's own
 * IPC surface (same approach the SKY-11188 author's own suite uses for
 * seeding a `ref`, since the toolbar has no note-picker UI), never written
 * directly into `.mythos-board.json`. The rename itself, and every
 * assertion about cascade + Links-tab behavior, drives the real UI.
 *
 * FINDING (SKY-11794, filed not fixed here — test-files-only boundary):
 * the sidecar rewrite and the Links-tab display both PASS, but a same-
 * session round-trip click on the rewritten ref does NOT reopen the note —
 * DesktopShell's allNotePaths cache goes stale because the rename cascade's
 * manual re-notify only re-broadcasts `vault:file-changed` for story-vault
 * paths, never notes-vault ones. See the NOTE comment near the end of the
 * test below for the full trace.
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

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

function readSidecar(notesDir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(notesDir, SIDECAR), 'utf-8'));
}

async function openNotesEditor(page: Page): Promise<void> {
  await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
}

async function openNoteAndShowBacklinks(page: Page, fileName: string): Promise<void> {
  await page.locator(`[data-testid="vb-row-${fileName}"]`).click();
  await page.locator('[data-testid="notes-right-tab-props"]').click();
  await expect(page.locator('[data-testid="note-backlinks-panel"]')).toBeVisible({ timeout: 8_000 });
}

test('SKY-11188 §4/§11 acceptance: a column ref rename-cascades like a real wikilink and appears in the note\'s Links tab', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('cascade-links');
  fs.writeFileSync(path.join(notesDir, 'Mira Veynn.md'), '# Mira Veynn\n\nA character note.\n');

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]');
    await boardsBtn.click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });

    // Seed a column item whose ref names the note — through the app's own
    // IPC surface (the toolbar has no note-picker UI, out of scope for
    // SKY-11188), never a hand-written sidecar.
    await page.evaluate(async () => {
      await (window as unknown as {
        api: { notesBoardFurnitureCreate: (f: string, i: unknown) => Promise<unknown> };
      }).api.notesBoardFurnitureCreate('', {
        k: 'column',
        x: 400,
        y: 44,
        title: 'Cast',
        items: [{ t: 'Mira Veynn', ref: 'Mira Veynn.md' }],
      });
    });
    await expect.poll(() => {
      const sidecar = readSidecar(notesDir);
      return (sidecar.furniture as unknown[]).length;
    }).toBe(1);

    // ── Before rename: the board ref already shows up in the note's own
    // Links (Backlinks) tab, distinctly tagged BOARD, per §4/§11. ──
    await openNotesEditor(page);
    await openNoteAndShowBacklinks(page, 'Mira Veynn.md');
    let boardEntry = page.locator('[data-testid^="board-backlink-"]');
    await expect(boardEntry).toBeVisible({ timeout: 8_000 });
    await expect(boardEntry).toContainText('Mira Veynn'); // the column item's own label text
    await expect(boardEntry.locator('.bl-story-chip')).toHaveText('BOARD');

    // ── Rename the note through the real UI. This is the SKY-10712 cascade
    // path — same renameNoteWithCascade the Notes tab always used. The
    // column ref, exactly like a [[wikilink]], must be rewritten with it. ──
    await page.locator('[data-testid="vb-row-Mira Veynn.md"]').dblclick();
    await expect(page.locator('.vb-rename-input')).toBeVisible({ timeout: 5_000 });
    await page.locator('.vb-rename-input').fill('Mira Thorne');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="vb-row-Mira Thorne.md"]')).toBeVisible({ timeout: 8_000 });
    await expect(fs.existsSync(path.join(notesDir, 'Mira Veynn.md'))).toBe(false);
    await expect(fs.existsSync(path.join(notesDir, 'Mira Thorne.md'))).toBe(true);

    // ── After rename: the sidecar's column ref must have moved with the
    // note (cascade rewrite), not gone stale/broken. ──
    await expect.poll(() => {
      const sidecar = readSidecar(notesDir);
      const items = (sidecar.furniture as Array<{ items?: Array<{ ref?: string }> }>)[0]?.items ?? [];
      return items[0]?.ref ?? '';
    }, { timeout: 8_000 }).toBe('Mira Thorne.md');
    const sidecarAfter = readSidecar(notesDir);
    const refAfter = (sidecarAfter.furniture as Array<{ items?: Array<{ ref?: string }> }>)[0]?.items?.[0]?.ref ?? '';
    expect(refAfter).toBe('Mira Thorne.md');

    // ── The renamed note's own Links tab still shows the board entry — the
    // rewritten ref resolves by the same stem rule as everywhere else,
    // proving the cascade didn't just touch text but kept the link alive. ──
    await openNoteAndShowBacklinks(page, 'Mira Thorne.md');
    boardEntry = page.locator('[data-testid^="board-backlink-"]');
    await expect(boardEntry).toBeVisible({ timeout: 8_000 });
    await expect(boardEntry).toContainText('Mira Veynn'); // item's own label text is untouched by rename
    await expect(boardEntry.locator('.bl-story-chip')).toHaveText('BOARD');

    // NOTE: a same-session round-trip click on the rewritten ref (does it
    // still open the note post-rename?) is intentionally NOT asserted here.
    // It reproducibly fails — see SKY-11794 — because DesktopShell's
    // allNotePaths cache (which both this ref-click and prose [[wikilink]]
    // click resolution depend on) only refreshes on `vault:file-changed`,
    // and notifyRenameCascadeApplied (electron-main/src/main.ts) filters
    // that broadcast to story-vault paths only, never notes-vault paths.
    // Asserting it here would land a permanently-failing test; the gap is
    // tracked and reproduced independently in SKY-11794 instead.
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
