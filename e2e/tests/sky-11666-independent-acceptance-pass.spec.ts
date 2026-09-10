/**
 * sky-11666-independent-acceptance-pass.spec.ts — SKY-11666: independent
 * acceptance-test pass for Notes Board slices 1-5, written from
 * `BOARDS-SPEC.md` v2 alone (host path
 * `/mnt/c/Users/SkyLo/Desktop/mythos stuff/BOARDS-SPEC.md`), NOT from the
 * shipped implementation. This file was authored without reading the
 * BoardCanvas/notesBoard IPC source for behaviour — only enough of the
 * already-merged e2e specs' launch/selector scaffolding was read to drive
 * the real app (same class names/testids other specs already depend on as
 * a UI contract).
 *
 * Per the ticket, this targets the criteria most likely to have been
 * quietly skipped by the slice owners' own coverage:
 *   GAP-1  spec §15 test 2, second half: delete the `.mythos-board.json`
 *          sidecar and reload — the board must reconstruct from the vault
 *          (Store A), items land in an auto-layout slot, note content is
 *          untouched. Existing SKY-11184 coverage only tests the
 *          drag→quit→relaunch persistence half of test 2, never the
 *          sidecar-deleted fallback half.
 *   GAP-2  fallback behaviour on MALFORMED (not missing) Store B data — spec
 *          §1: "If Store B references something Store A no longer has, the
 *          entry is ignored." A `.mythos-board.json` that isn't even valid
 *          JSON is the harder case of this and has no existing coverage.
 *   GAP-3  spec §15 test 7 / §2-§3: a brand-new, never-arranged note has no
 *          `id:` in frontmatter; only touching it (a drag) assigns one, and
 *          only then does a `layout` entry appear. No existing spec reads
 *          the note's own frontmatter to confirm the "clean until touched"
 *          half of this claim.
 *   GAP-4  rename-preserves-state for a NOTE (file), not a folder. SKY-11184
 *          AC4 covers folder rename only; SKY-11187's rename coverage only
 *          exercises the empty-string no-op path. The success path for
 *          renaming an existing, already-positioned note card via the
 *          board's own Rename context-menu action (spec §5) is untested.
 *   GAP-5  tri-surface thumbnail consistency (SKY-11186 scope: "Same
 *          thumbnail derivative renders correctly in both the Notes Board
 *          and Scene Crafter cards", plus the Notes-editor cover badge).
 *          Existing coverage (BADGE-1) crosses editor↔board but never
 *          reaches the third surface, Scene Crafter's suggested-cards rail,
 *          which reads the identical thumbnail cache
 *          (`SceneCrafterCardThumb`/`useNoteThumbInfo`) per an explicit
 *          owner ruling on SKY-10724. SKY-7990 stayed broken for months
 *          behind mock-only green on exactly this kind of cross-surface
 *          claim — this drives all three surfaces through the real app,
 *          nothing mocked.
 *
 * All fixtures are real files on disk; nothing under test (board sidecars,
 * thumbnail cache, frontmatter ids) is pre-seeded — every claim is produced
 * by driving the actual UI, per COMPANY-STANDARDS §4c.
 *
 * TEST-FILES-ONLY: this file does not, and must not, touch product code.
 * Any failure below is reported on SKY-11666/SKY-10724 and routed to the
 * owning slice, not fixed here.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import zlib from 'zlib';
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

function makeTemp(slug: string): { tempRoot: string; userData: string; storyDir: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11666-${slug}-`));
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
  return { tempRoot, userData, storyDir, notesDir };
}

function mkNote(notesDir: string, rel: string, body: string): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

function readSidecar(notesDir: string, folderRel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(notesDir, folderRel, SIDECAR), 'utf-8'));
}

function sidecarPath(notesDir: string, folderRel: string): string {
  return path.join(notesDir, folderRel, SIDECAR);
}

/** A real PNG (IHDR + one zlib IDAT + IEND), same construction other specs use. */
function pngBytes(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf: Buffer): number => {
    let c = -1;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function mkImage(notesDir: string, rel: string, width = 640, height = 400): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, pngBytes(width, height, [200, 40, 120]));
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

async function bootToNotes(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
  return page;
}

const card = (page: Page, name: string) =>
  page.locator('.board-canvas__item', { hasText: name }).first();
const folderTile = (page: Page, name: string) =>
  page.locator('.board-canvas__item--folder', { hasText: name }).first();

async function enterBoard(page: Page, folder: string): Promise<void> {
  await folderTile(page, folder).dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, { timeout: 8_000 });
}

async function dragItem(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const el = card(page, name);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no bounding box for "${name}"`);
  await page.mouse.move(box.x + 20, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + dx, box.y + 12 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500); // NOTES_BOARD_DEBOUNCE_MS = 250ms; give it margin
}

async function itemPos(page: Page, name: string): Promise<{ left: number; top: number }> {
  const style = (await card(page, name).getAttribute('style')) ?? '';
  const left = Number(/left:\s*([\d.]+)px/.exec(style)?.[1]);
  const top = Number(/top:\s*([\d.]+)px/.exec(style)?.[1]);
  return { left, top };
}

// ═════════════════════════════════════════════════════════════════════════
// GAP-1 — spec §15 test 2 (second half): delete the sidecar, reload.
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11666 GAP-1: deleting the board sidecar reconstructs the board — auto-layout slot, note intact', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap1-sidecar-gc');
  mkNote(notesDir, 'Locations/Gate.md', '# Gate\n\nThe sunken gate at low tide.\n');
  mkNote(notesDir, 'Locations/Cove.md', '# Cove\n\nA quiet inlet.\n');

  let app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Locations');
    await dragItem(page, 'Gate', 260, 190);
    await expect.poll(() => fs.existsSync(sidecarPath(notesDir, 'Locations')), { timeout: 10_000 }).toBe(true);
    const before = readSidecar(notesDir, 'Locations');
    expect(Object.keys(before.layout as object).length).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => undefined);
  }

  // Delete the sidecar entirely — this is the fallback path spec §1 promises:
  // "Store B is never allowed to hide a note", i.e. Store A is authoritative.
  fs.rmSync(sidecarPath(notesDir, 'Locations'));
  expect(fs.readFileSync(path.join(notesDir, 'Locations', 'Gate.md'), 'utf-8')).toContain('sunken gate');

  app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Locations');
    // Both notes still render — Store A content survives the metadata loss.
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Gate' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Cove' })).toBeVisible({ timeout: 10_000 });
    // Neither card sits at NaN/undefined — both got a real auto-layout slot.
    const gatePos = await itemPos(page, 'Gate');
    const covePos = await itemPos(page, 'Cove');
    expect(Number.isFinite(gatePos.left)).toBe(true);
    expect(Number.isFinite(gatePos.top)).toBe(true);
    expect(Number.isFinite(covePos.left)).toBe(true);
    expect(Number.isFinite(covePos.top)).toBe(true);
    // The note file itself was never touched by the metadata-loss path.
    expect(fs.readFileSync(path.join(notesDir, 'Locations', 'Gate.md'), 'utf-8')).toContain('sunken gate');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// GAP-2 — fallback on a MALFORMED (not missing) sidecar.
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11666 GAP-2: a corrupt (invalid-JSON) board sidecar does not crash the board — vault content still renders', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap2-malformed');
  mkNote(notesDir, 'Worldbuilding/Map.md', '# Map\n\nThe continent, roughly.\n');
  mkNote(notesDir, 'Worldbuilding/Timeline.md', '# Timeline\n\nEvents, roughly ordered.\n');
  // A sidecar that exists but is not valid JSON — e.g. a partial/interrupted
  // write, or hand-editing gone wrong (this file is meant to be
  // git/Dropbox-mergeable per spec §3, so a bad merge is a realistic cause).
  fs.mkdirSync(path.join(notesDir, 'Worldbuilding'), { recursive: true });
  fs.writeFileSync(sidecarPath(notesDir, 'Worldbuilding'), '{ "version": 2, "id": "01J9BROKEN, "layout": {');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    // The app must not be stuck on a crash screen / blank canvas — the
    // Boards view itself has to still come up.
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 10_000 });
    await enterBoard(page, 'Worldbuilding');
    // Store A is authoritative: both real notes still render despite the
    // sidecar being unreadable.
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Map' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Timeline' })).toBeVisible({ timeout: 10_000 });
    // No uncaught renderer exception reached the page (no devtools error
    // overlay / white screen — the canvas root is still the visible root).
    await expect(page.locator('.board-canvas__root')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// GAP-3 — spec §15 test 7 / §2-§3: lazy id assignment, read from the note's
// OWN frontmatter file, not just inferred from sidecar presence.
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11666 GAP-3: a never-arranged note has no id: in frontmatter; only a drag assigns one + a layout entry', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap3-lazy-id');
  const noteFile = path.join(notesDir, 'Characters', 'Mira.md');
  mkNote(notesDir, 'Characters/Mira.md', '# Mira\n\nDread first, wonder second.\n');
  mkNote(notesDir, 'Characters/Bram.md', '# Bram\n\nStays out of it, mostly.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Mira' })).toBeVisible({ timeout: 10_000 });

    // Untouched: no sidecar at all yet, and critically the note's own
    // frontmatter carries no id: field — an Obsidian user editing this file
    // right now would see nothing the board added.
    expect(fs.existsSync(sidecarPath(notesDir, 'Characters'))).toBe(false);
    expect(fs.readFileSync(noteFile, 'utf-8')).not.toMatch(/^---[\s\S]*id:/);

    await dragItem(page, 'Mira', 240, 160);

    await expect.poll(() => fs.existsSync(sidecarPath(notesDir, 'Characters')), { timeout: 10_000 }).toBe(true);

    // The id has to actually land in Mira's OWN frontmatter (spec §2-§3:
    // lazy assignment on first touch writes `id:` to the note file itself,
    // not just to the sidecar) — read it back from disk rather than trusting
    // any key the sidecar happens to expose.
    const miraIdMatch = /^---[\s\S]*?^id:\s*(\S+)\s*$[\s\S]*?^---/m.exec(fs.readFileSync(noteFile, 'utf-8'));
    expect(miraIdMatch).toBeTruthy();
    const miraId = miraIdMatch![1];

    const sidecar = readSidecar(notesDir, 'Characters');
    const layout = sidecar.layout as Record<string, unknown>;
    const noteKeys = Object.keys(layout).filter((k) => k.startsWith('n:'));
    // Exactly one note-keyed layout entry, and it is keyed by Mira's own
    // frontmatter id — not Bram's (never touched), and not some other `n:`
    // entry that happens to be truthy. This is the assertion GAP-3 named:
    // "any `n:` key is truthy" passes even if the entry belongs to Bram or
    // nothing was actually touched.
    expect(noteKeys).toEqual([`n:${miraId}`]);

    // Bram was never touched: still no layout entry for it, and — since the
    // id lives in frontmatter rather than only in the sidecar — Bram's own
    // file must still be clean too.
    const bramFile = path.join(notesDir, 'Characters', 'Bram.md');
    expect(fs.readFileSync(bramFile, 'utf-8')).not.toMatch(/^---[\s\S]*id:/);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// GAP-4 — rename-preserves-state for a NOTE (file), via the board's own
// Rename context-menu action, spec §5.
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11666 GAP-4: renaming an already-positioned NOTE card via the board keeps its position and updates the Notes tree', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap4-note-rename');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n\nThe protagonist.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');
    await dragItem(page, 'Alice', 220, 150);
    const before = await itemPos(page, 'Alice');

    // Rename via the board's own context menu (spec §5: "Rename via
    // inspector or context menu → renames the actual file/folder").
    const target = card(page, 'Alice');
    await target.click({ button: 'right' });
    await expect(page.locator('.board-canvas__menu[role="menu"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('.board-canvas__menu-item', { hasText: 'Rename' }).click();
    const input = page.locator('.board-canvas__item-rename');
    await expect(input).toBeFocused({ timeout: 8_000 });
    await input.fill('Alicia');
    await input.press('Enter');

    // File renamed on disk — this is a real vault mutation, not metadata.
    await expect.poll(
      () => fs.existsSync(path.join(notesDir, 'Characters', 'Alicia.md')),
      { timeout: 10_000 },
    ).toBe(true);
    expect(fs.existsSync(path.join(notesDir, 'Characters', 'Alice.md'))).toBe(false);
    expect(fs.readFileSync(path.join(notesDir, 'Characters', 'Alicia.md'), 'utf-8')).toContain('protagonist');

    // The card kept its position under the new label — id-keyed layout, no
    // reflow to a fresh auto-layout slot.
    await expect(page.locator('.board-canvas__item-name', { hasText: 'Alicia' })).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.board-canvas__item-name', { hasText: /^Alice$/ })).toHaveCount(0);
    const after = await itemPos(page, 'Alicia');
    expect(after).toEqual(before);

    // The Notes tab (the other rendering of the same filesystem, spec §1)
    // reflects the rename too.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="vb-row-Characters/Alicia.md"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="vb-row-Characters/Alice.md"]')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// GAP-5 — tri-surface thumbnail consistency: Notes editor cover badge,
// Board card, AND Scene Crafter's suggested-cards rail (owner ruling on
// SKY-10724, explicit SKY-11186 scope line: "Same thumbnail derivative
// renders correctly in both the Notes Board and Scene Crafter cards").
// ═════════════════════════════════════════════════════════════════════════

test('SKY-11666 GAP-5: the same thumbnail derivative renders in the Notes editor, the Board, AND Scene Crafter', async () => {
  test.setTimeout(180_000);
  const { tempRoot, userData, notesDir } = makeTemp('gap5-tri-surface');
  mkImage(notesDir, 'portrait.png');
  mkNote(notesDir, 'Mira.md', '# Mira\n\nDread first, wonder second.\n\n![[portrait.png]]\n');

  const app = await launchApp(userData);
  try {
    // Surface 1 — Notes editor cover badge: no explicit thumb: frontmatter,
    // so this must resolve via the first-image-block fallback (spec §9) and
    // show "Auto", not merely be absent.
    const page = await bootToNotes(app);
    const row = page.locator('[data-testid="vb-row-Mira.md"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await expect(page.locator('[data-testid="note-title"]')).toHaveText('Mira', { timeout: 10_000 });
    const cover = page.locator('[data-testid="note-cover"]');
    await expect(cover).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="note-cover-badge"]')).toHaveText('Auto');
    const coverImg = cover.locator('.note-thumb img');
    await expect(coverImg).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 15_000 });
    // Captured while surface 1 is still mounted — the actual bytes, not just
    // "some webp", so it can be compared against the other two surfaces below.
    const notesSrc = await coverImg.getAttribute('src');

    // Surface 2 — the Board card, same note, no re-seed of any kind.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
    const boardCard = page.locator('.board-canvas__item[aria-label^="Note card: Mira"]').first();
    await expect(boardCard).toBeVisible({ timeout: 10_000 });
    const boardImg = boardCard.locator('.board-canvas__thumb img');
    await expect(boardImg).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 15_000 });
    const boardSrc = await boardImg.getAttribute('src');

    // Surface 3 — Scene Crafter's suggested-cards rail. Every markdown note
    // outside `boards/`/`scenes/` is auto-listed here with no linking step
    // required (crafterState.suggestedFromVault) — reachable via ordinary
    // clicks: File → New story, then the Scene Crafter nav button.
    await page.locator('.wc-menu', { hasText: 'File' }).click();
    await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('.nav-story-title').first().click();
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await expect(page.locator('aside[aria-label="Suggested cards"]')).toBeVisible({ timeout: 10_000 });

    const suggestedCard = page.locator('.sc-sugg-card', { hasText: 'Mira' }).first();
    await expect(suggestedCard).toBeVisible({ timeout: 10_000 });
    // The claim under test: the avatar slot paints the SAME cached
    // derivative, not the initials fallback it shows before the cache
    // resolves (or when it can't).
    const craftImg = suggestedCard.locator('.sc-sugg-av img');
    await expect(craftImg).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 15_000 });
    const craftSrc = await craftImg.getAttribute('src');

    // GAP-5's actual claim is cross-surface consistency, not "each surface
    // independently renders some webp" — three surfaces rendering three
    // different derivatives would still pass the per-surface regex checks
    // above. Compare the captured bytes directly.
    expect(boardSrc).toBe(notesSrc);
    expect(craftSrc).toBe(notesSrc);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
