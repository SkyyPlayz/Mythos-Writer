/**
 * sky-11186-board-lod-thumbnails.spec.ts — Notes Board 3/9: viewport
 * culling, 3-tier LOD, note thumbnails and the visible zoom-out limit
 * (BOARDS-SPEC v2 §6/§9, §15 tests 5 and 12; owner rulings 4 and 5 on
 * SKY-10724).
 *
 * Drives the real built app (out/main/main.js) across the process boundary
 * against a real notes vault on disk. Per COMPANY-STANDARDS §4c nothing under
 * test is pre-seeded: no board sidecar, no thumbnail cache — the app
 * resolves every thumbnail from the note's own markdown and generates every
 * ~256px derivative itself. Only vault content (notes + image files) is seeded.
 *
 * Coverage:
 *   LOD-1   zooming out walks a card through all three tiers (§15 test 5)
 *           and the image outlives the text (owner ruling 5d).
 *   THUMB-1 frontmatter `thumb:` → first image block → none (§9), and the
 *           derivative on the card is a cached webp, not the source (§6).
 *   THUMB-2 `thumb: false` gives a text-only card despite an image (§15.12).
 *   THUMB-3 a missing / deleted source falls back to icon + title, never a
 *           broken-image glyph (owner ruling 5f) — live, via the watcher.
 *   ZOOM-1  the zoom-out cap is a visible setting: the button names it at
 *           the floor, and lowering it in Settings lets the board go further.
 *   PERF-1  2,000 cards: the mounted-node budget holds at every zoom stop
 *           and scrolling through the board stays within frame budget.
 *   BADGE-1 the editor cover beside the title reads Auto/Thumbnail (§9), its
 *           × writes `thumb: false` to the file, and the Board agrees.
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

// ── Fixture helpers ─────────────────────────────────────────────────────────

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11186-${slug}-`));
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

function mkNote(notesDir: string, rel: string, body: string): void {
  const abs = path.join(notesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/**
 * A real PNG built from scratch (IHDR + one zlib IDAT + IEND): a solid
 * colour at the requested size, so the app's decode → resize → webp
 * pipeline runs on genuine image bytes rather than a checked-in fixture.
 */
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
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

const items = (page: Page) => page.locator('.board-canvas__item');
const card = (page: Page, name: string) =>
  page.locator('.board-canvas__item--note', { has: page.locator('.board-canvas__item-name', { hasText: new RegExp(`^${name}$`) }) }).first();
const cardByLabel = (page: Page, name: string) => page.locator(`.board-canvas__item[aria-label^="Note card: ${name}"]`).first();
const zoomOut = (page: Page) => page.locator('.board-canvas__zoom-btn[aria-label="Zoom out"]');
const zoomLabel = (page: Page) => page.locator('.board-canvas__zoom-reset');

async function enterBoard(page: Page, folder: string): Promise<void> {
  await page.locator('.board-canvas__item--folder', { hasText: folder }).first().dblclick();
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(folder, { timeout: 8_000 });
}

async function zoomOutTo(page: Page, percent: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const text = (await zoomLabel(page).textContent()) ?? '';
    if (text.trim() === `${percent}%`) return;
    await zoomOut(page).click();
  }
  await expect(zoomLabel(page)).toHaveText(`${percent}%`);
}

const cardHeight = async (locator: ReturnType<Page['locator']>): Promise<number> =>
  parseFloat((await locator.getAttribute('style'))?.match(/height:\s*([\d.]+)px/)?.[1] ?? 'NaN');

// ── LOD-1 — three tiers, image outlives text (§15 test 5) ────────────────────

test('SKY-11186 LOD-1: zooming out swaps a card through preview+image → image+title → coloured block', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('lod');
  mkImage(notesDir, 'Characters/portrait.png');
  mkNote(notesDir, 'Characters/Mira.md', '# Mira\n\nDread first, wonder second.\n\n![[portrait.png]]\n');
  mkNote(notesDir, 'Characters/Plain.md', '# Plain\n\nNo image in this one.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Characters');
    const mira = cardByLabel(page, 'Mira');
    const plain = cardByLabel(page, 'Plain');

    // Tier 1 at 100%: title, image block and text preview; the image is the
    // generated derivative — a webp data URL, decoded, never the source PNG.
    await expect(mira).toHaveAttribute('data-lod', '1');
    await expect(mira.locator('.board-canvas__item-excerpt')).toHaveText(/Dread first/);
    const img = mira.locator('.board-canvas__thumb img');
    await expect(img).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 15_000 });
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await cardHeight(mira)).toBe(272);
    expect(await cardHeight(plain)).toBe(154);

    // 70% is still tier 1 (165px on screen) …
    await zoomOutTo(page, 70);
    await expect(mira).toHaveAttribute('data-lod', '1');

    // … 60% is tier 2: the preview is gone, the image and the title stay
    // (owner ruling 5d — "the image should outlive the text").
    await zoomOutTo(page, 60);
    await expect(mira).toHaveAttribute('data-lod', '2');
    await expect(mira.locator('.board-canvas__item-excerpt')).toHaveCount(0);
    await expect(mira.locator('.board-canvas__item-name')).toHaveText('Mira');
    await expect(mira.locator('.board-canvas__thumb img')).toHaveAttribute('src', /^data:image\/webp/);
    await expect(plain).toHaveAttribute('data-lod', '2');

    // 40% (the spec floor) is tier 3: a coloured block — no text, no image,
    // but still the card (accessible name intact, name one hover away).
    await zoomOutTo(page, 40);
    await expect(mira).toHaveAttribute('data-lod', '3');
    await expect(mira.locator('.board-canvas__item-name')).toHaveCount(0);
    await expect(mira.locator('.board-canvas__thumb')).toHaveCount(0);
    await expect(mira).toHaveText('');
    await expect(mira).toHaveAttribute('title', 'Mira');
    await expect(mira).toHaveAttribute('aria-label', /^Note card: Mira/);
    // The block is painted in the card's accent, not left as the plate.
    const block = await mira.evaluate((el) => getComputedStyle(el).backgroundColor);
    const plate = await page.locator('.board-canvas__root').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(block).not.toBe(plate);
    expect(block).not.toBe('rgba(0, 0, 0, 0)');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── THUMB-1/2/3 — resolution order, thumb:false, missing source (§9) ─────────

test('SKY-11186 THUMB-1/2: explicit thumb → first image → none; thumb:false is text-only despite an image', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('thumb');
  mkImage(notesDir, 'attachments/cover.png');
  mkImage(notesDir, 'attachments/inline.png', 300, 300);
  mkNote(notesDir, 'Explicit.md', '---\nthumb: attachments/cover.png\n---\n# Explicit\n\nBody with an inline image below.\n\n![inline](attachments/inline.png)\n');
  mkNote(notesDir, 'Auto.md', '# Auto\n\nFirst image wins.\n\n![Inline art](attachments/inline.png)\n\n![[cover.png]]\n');
  mkNote(notesDir, 'Off.md', '---\nthumb: false\n---\n# Off\n\nHas an image, but the author turned the thumbnail off.\n\n![inline](attachments/inline.png)\n');
  mkNote(notesDir, 'Plain.md', '# Plain\n\nJust text.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    const explicit = cardByLabel(page, 'Explicit');
    const auto = cardByLabel(page, 'Auto');
    const off = cardByLabel(page, 'Off');
    const plain = cardByLabel(page, 'Plain');

    await expect(explicit).toBeVisible();
    // Explicit and auto both carry the image block at the 272px card size.
    expect(await cardHeight(explicit)).toBe(272);
    expect(await cardHeight(auto)).toBe(272);
    await expect(explicit.locator('.board-canvas__thumb img')).toHaveAttribute('src', /^data:image\/webp/, { timeout: 15_000 });
    await expect(auto.locator('.board-canvas__thumb img')).toHaveAttribute('src', /^data:image\/webp/, { timeout: 15_000 });
    // The auto caption is the FIRST image's alt text.
    await expect(auto.locator('.note-thumb__caption')).toHaveText('Inline art');

    // §15 test 12: `thumb: false` → text-only card even though the note has an image.
    await expect(off).toBeVisible();
    expect(await cardHeight(off)).toBe(154);
    await expect(off.locator('.board-canvas__thumb')).toHaveCount(0);
    await expect(off.locator('.board-canvas__item-excerpt')).toHaveText(/turned the thumbnail off/);
    expect(await cardHeight(plain)).toBe(154);
    await expect(plain.locator('.board-canvas__thumb')).toHaveCount(0);

    // Derivatives are cached OUTSIDE the vault (owner ruling 5c): under
    // userData, keyed by vault — never inside the notes folder.
    const cacheRoot = path.join(userData, 'note-thumb-cache');
    await expect.poll(() => {
      if (!fs.existsSync(cacheRoot)) return 0;
      let n = 0;
      for (const vault of fs.readdirSync(cacheRoot)) {
        n += fs.readdirSync(path.join(cacheRoot, vault)).filter((f) => f.endsWith('.webp')).length;
      }
      return n;
    }, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const vaultFiles = fs.readdirSync(notesDir);
    expect(vaultFiles.some((f) => /thumb|cache/i.test(f))).toBe(false);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('SKY-11186 THUMB-3: a missing or deleted source falls back to icon + title, never a broken image', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('missing');
  mkImage(notesDir, 'Locations/gate.png');
  mkNote(notesDir, 'Locations/Gone.md', '---\nthumb: attachments/never-existed.png\n---\n# Gone\n\nThe file this points at is not in the vault.\n');
  mkNote(notesDir, 'Locations/Gate.md', '# Gate\n\nThe sunken gate at low tide.\n\n![[gate.png]]\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Locations');
    const gone = cardByLabel(page, 'Gone');
    const gate = cardByLabel(page, 'Gate');

    // Missing from the start: the image block is there (layout stays
    // stable), it shows the fallback glyph, and there is NO <img> to break.
    await expect(gone).toBeVisible();
    expect(await cardHeight(gone)).toBe(272);
    await expect(gone.locator('.note-thumb[data-thumb-state="unavailable"]')).toHaveCount(1);
    await expect(gone.locator('.note-thumb__glyph')).toHaveCount(1);
    await expect(gone.locator('img')).toHaveCount(0);
    await expect(gone.locator('.board-canvas__item-name')).toHaveText('Gone');

    // Present, then deleted while the board is open: the vault watcher
    // reloads the board and the card degrades to the same fallback.
    await expect(gate.locator('.board-canvas__thumb img')).toHaveAttribute('src', /^data:image\/webp/, { timeout: 15_000 });
    fs.rmSync(path.join(notesDir, 'Locations', 'gate.png'));
    await expect(gate.locator('.note-thumb[data-thumb-state="unavailable"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(gate.locator('img')).toHaveCount(0);
    await expect(gate.locator('.board-canvas__item-name')).toHaveText('Gate');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── ZOOM-1 — the zoom-out cap is a visible setting (owner ruling 4) ──────────

test('SKY-11186 ZOOM-1: the zoom-out limit is named on the button and adjustable in Settings', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('zoomcap');
  mkNote(notesDir, 'One.md', '# One\n\nA note.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(items(page)).toHaveCount(1);

    // Default floor is the spec's 40%: the button stops there and says so.
    await expect(zoomOut(page)).not.toHaveAttribute('aria-disabled', 'true');
    await zoomOutTo(page, 40);
    // At the floor the button is aria-disabled (Playwright's actionability
    // check would refuse it) — force the click to prove it is a no-op.
    await zoomOut(page).click({ force: true });
    await expect(zoomLabel(page)).toHaveText('40%');
    await expect(zoomOut(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(zoomOut(page)).toHaveAttribute('title', /40%.*Settings/);
    await expect(page.locator('.board-canvas__root')).toHaveAttribute('data-min-zoom', '40');

    // Lower it in Settings → Editor → Notes Board, then save — the same
    // clicks a user makes (gear → category tab → segmented stop → Save).
    await page.locator('.app-menu-gear-btn').click();
    await expect(page.locator('.settings-title')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="settings-cat-editor"]').click();
    const stop20 = page.locator('[data-testid="notes-board-min-zoom-20"]');
    await expect(stop20).toBeVisible({ timeout: 8_000 });
    await stop20.click();
    await expect(stop20).toHaveAttribute('aria-checked', 'true');
    await page.locator('button[aria-label="Save settings"]').click();
    await expect.poll(() => {
      const settings = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8'));
      return settings.notesBoard?.minZoom;
    }, { timeout: 10_000 }).toBe(20);
    const closeSettings = page.locator('button[aria-label="Close settings"]');
    if (await closeSettings.isVisible().catch(() => false)) await closeSettings.click();

    // Back on the board the floor moved: 40% is no longer the stop.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
    await expect(page.locator('.board-canvas__root')).toHaveAttribute('data-min-zoom', '20', { timeout: 8_000 });
    await zoomOutTo(page, 20);
    await expect(zoomOut(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(zoomOut(page)).toHaveAttribute('title', /20%/);
    await expect(cardByLabel(page, 'One')).toHaveAttribute('data-lod', '3');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── PERF-1 — 2,000 cards: mounted-node budget, no gaps, scroll frame budget ──
//
// The budget, named (COMPANY-STANDARDS craft bar — a regression here blocks).
// Culling mounts the cells inside the viewport plus one 268×216 cell of margin
// on every side and one 64px scroll bucket, so with `cols` auto-layout columns
// the mounted `.board-canvas__item` count is bounded, at any zoom, by
//
//     cols × (ceil(((clientHeight + 64) / scale + 2 × 216) / 216) + 2)
//
// — derived in-page from the real scroll-area geometry so the bound holds on
// any screen — plus a hard ceiling of 400 at every stop (a culling regression
// mounts all 2,000). Measured on this fixture under Xvfb (1440×900 window →
// 1015×773 scroll area, 3 columns): 12 mounted at 100% (bound 24), 27 at 40%
// (bound 42), 102 at 10% (bound 129); scroll p95 16.8 ms.
//
// Correctness rides along with the budget: at each stop every auto-layout
// column must be continuous across the visible window, so no card that should
// be on screen is left unmounted — a gap between consecutive mounted cards in a
// column can only ever be a row gutter (≤ 334 − 154 = 180 world px).
//
// The scroll extent must follow the zoom too: at 10% the panel scrolls over
// the world's painted footprint, not over 100%-sized emptiness.
//
// Scrolling 60 frames through the board: p95 frame ≤ 100 ms, mean ≤ 50 ms.
// Measured 16.8 / 16.7 ms under Xvfb (rAF-locked); the bounds leave room for
// a slow CI runner while a linear render of 2,000 cards — hundreds of ms per
// frame — still fails either one by a wide margin.

const PERF_N = 2000;
const MOUNT_HARD_CEILING = 400;
const FRAME_P95_MAX_MS = 100;
const FRAME_MEAN_MAX_MS = 50;
const CELL_H = 216;
const CULL_MARGIN_Y = CELL_H;
const SCROLL_BUCKET_PX = 64;
/** A row holding a thumbnail card is 216 + 118 tall. */
const MAX_ROW_PITCH = 334;
/** A text card (154) in a thumbnail row (334) leaves the largest gutter a column can have. */
const MAX_COLUMN_GUTTER = MAX_ROW_PITCH - 154;

interface BoardGeometry {
  clientW: number;
  clientH: number;
  scale: number;
  cols: number;
  worldW: number;
  worldH: number;
  /** The visible window, in world px (scroll and pan inverted through the zoom). */
  visibleY0: number;
  visibleY1: number;
  scrollHeight: number;
  mounted: Array<{ left: number; top: number; h: number }>;
}

async function boardGeometry(page: Page): Promise<BoardGeometry> {
  return page.locator('.board-canvas__scroll-area').evaluate((el) => {
    const scroller = el as HTMLElement;
    const world = scroller.querySelector('.board-canvas__world') as HTMLElement;
    const m = world.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/);
    const panY = m ? parseFloat(m[2]) : 0;
    const scale = m ? parseFloat(m[3]) : 1;
    const worldW = parseFloat(world.style.width);
    const worldH = parseFloat(world.style.height);
    const visibleY0 = (scroller.scrollTop - panY) / scale;
    return {
      clientW: scroller.clientWidth,
      clientH: scroller.clientHeight,
      scale,
      cols: Math.max(1, Math.floor((worldW - 48) / 268)),
      worldW,
      worldH,
      visibleY0,
      visibleY1: visibleY0 + scroller.clientHeight / scale,
      scrollHeight: scroller.scrollHeight,
      mounted: Array.from(world.querySelectorAll('.board-canvas__item')).map((node) => {
        const s = (node as HTMLElement).style;
        return { left: parseFloat(s.left), top: parseFloat(s.top), h: parseFloat(s.height) };
      }),
    };
  });
}

function mountBudget(g: BoardGeometry): number {
  const windowH = (g.clientH + SCROLL_BUCKET_PX) / g.scale + 2 * CULL_MARGIN_Y;
  return g.cols * (Math.ceil(windowH / CELL_H) + 2);
}

/** Every column is continuous across the visible window — nothing that should be on screen is unmounted. */
function expectNoGaps(g: BoardGeometry, label: string): void {
  const byColumn = new Map<number, Array<{ top: number; h: number }>>();
  for (const c of g.mounted) byColumn.set(c.left, [...(byColumn.get(c.left) ?? []), c]);
  expect(byColumn.size, `${label}: every auto-layout column has mounted cards`).toBe(g.cols);
  // The last auto-layout row may be partial, so a column is only required to
  // reach one row above the board's end (AC3 in the SKY-11184 spec covers the
  // last card itself).
  const columnEnd = g.worldH - 44 - MAX_ROW_PITCH;
  for (const [left, cards] of byColumn) {
    cards.sort((a, b) => a.top - b.top);
    const first = cards[0];
    const last = cards[cards.length - 1];
    expect(first.top, `${label}: column at x=${left} starts by the top of the window`)
      .toBeLessThanOrEqual(Math.max(44, g.visibleY0) + MAX_COLUMN_GUTTER);
    expect(last.top + last.h, `${label}: column at x=${left} reaches the bottom of the window`)
      .toBeGreaterThanOrEqual(Math.min(g.visibleY1, columnEnd) - MAX_COLUMN_GUTTER);
    for (let i = 1; i < cards.length; i++) {
      const gap = cards[i].top - (cards[i - 1].top + cards[i - 1].h);
      expect(gap, `${label}: hole in column at x=${left} below y=${cards[i - 1].top}`).toBeLessThanOrEqual(MAX_COLUMN_GUTTER);
    }
  }
}

test('SKY-11186 PERF-1: a 2,000-card board keeps the mounted set bounded and scrolls within frame budget', async () => {
  test.setTimeout(240_000);
  const { tempRoot, userData, notesDir } = makeTemp('perf');
  fs.mkdirSync(path.join(userData), { recursive: true });
  // The lowest stop is opt-in; seed it so the 10% budget is measurable too.
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark', notesBoard: { minZoom: 10 } }, null, 2),
  );
  mkImage(notesDir, 'Crowd/hero.png');
  for (let i = 0; i < PERF_N; i++) {
    // Every tenth note carries a thumbnail so thumbnail rows are in the mix.
    const img = i % 10 === 0 ? '\n\n![[hero.png]]\n' : '';
    mkNote(notesDir, `Crowd/n${String(i).padStart(4, '0')}.md`, `# Note ${i}\n\nBody line for note ${i}.${img}`);
  }

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await enterBoard(page, 'Crowd');
    await expect(cardByLabel(page, 'n0000')).toBeVisible({ timeout: 30_000 });

    const report: Record<string, number> = {};

    for (const stop of [100, 40, 10]) {
      await zoomOutTo(page, stop);
      await expect(zoomLabel(page)).toHaveText(`${stop}%`);
      // Let the bucketed cull settle after the zoom change.
      await page.waitForTimeout(150);
      const g = await boardGeometry(page);
      const n = g.mounted.length;
      const budget = mountBudget(g);
      report[`mounted@${stop}%`] = n;
      report[`budget@${stop}%`] = budget;
      expect(n, `mounted cards at ${stop}%`).toBeLessThanOrEqual(Math.min(budget, MOUNT_HARD_CEILING));
      expect(n, `something must be mounted at ${stop}%`).toBeGreaterThan(0);
      expectNoGaps(g, `${stop}%`);
      // The panel scrolls over what is painted at this zoom, nothing more.
      expect(g.scrollHeight, `scroll extent at ${stop}%`)
        .toBeLessThanOrEqual(Math.max(g.clientH, Math.ceil(g.worldH * g.scale)) + 1);
      if (stop === 100) {
        report['viewport.w'] = g.clientW;
        report['viewport.h'] = g.clientH;
        report.cols = g.cols;
      }
    }

    // Back to 100% and scroll the whole board over 60 real animation frames,
    // sampling rAF deltas — the culling re-render is what's being timed.
    await page.locator('.board-canvas__zoom-reset').click();
    await expect(zoomLabel(page)).toHaveText('100%');
    const frames = await page.locator('.board-canvas__scroll-area').evaluate(async (el) => {
      const scroller = el as HTMLElement;
      const step = Math.max(1, Math.floor((scroller.scrollHeight - scroller.clientHeight) / 60));
      const deltas: number[] = [];
      let last = performance.now();
      await new Promise<void>((resolve) => {
        let i = 0;
        const tick = (t: number) => {
          deltas.push(t - last);
          last = t;
          scroller.scrollTop += step;
          if (++i < 60) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return deltas.slice(1);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
    report['scroll.p95.ms'] = Math.round(p95 * 10) / 10;
    report['scroll.mean.ms'] = Math.round(mean * 10) / 10;
    report['scroll.frames'] = frames.length;
    // Let the last scroll bucket's render land, then read the end state.
    await page.waitForTimeout(150);
    const end = await boardGeometry(page);
    report['mounted@end'] = end.mounted.length;

    console.log(`[SKY-11186 PERF-1] ${PERF_N} cards: ${JSON.stringify(report)}`);

    expect(frames.length).toBeGreaterThanOrEqual(30);
    expect(p95, 'p95 scroll frame (ms)').toBeLessThanOrEqual(FRAME_P95_MAX_MS);
    expect(mean, 'mean scroll frame (ms)').toBeLessThanOrEqual(FRAME_MEAN_MAX_MS);
    expect(end.mounted.length, 'mounted cards after the scroll').toBeLessThanOrEqual(mountBudget(end));
    expectNoGaps(end, 'after scroll');
    // The scroll really traversed the board: the last card is mounted now.
    await expect(cardByLabel(page, `n${PERF_N - 1}`)).toBeVisible({ timeout: 8_000 });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── BADGE-1 — the editor cover: badge + × (§9 "also renders in the Notes editor") ──

async function bootToNotes(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-tab-panel"]')).toBeVisible({ timeout: 8_000 });
  return page;
}

test('SKY-11186 BADGE-1: the editor cover badge reads Auto/Thumbnail and × writes thumb: false', async () => {
  test.setTimeout(150_000);
  const { tempRoot, userData, notesDir } = makeTemp('badge');
  mkImage(notesDir, 'portrait.png');
  const noteFile = path.join(notesDir, 'Mira.md');
  mkNote(notesDir, 'Mira.md', '# Mira\n\nDread first, wonder second.\n\n![[portrait.png]]\n');

  const app = await launchApp(userData);
  try {
    // Open the note from the Notes tab's vault tree.
    const page = await bootToNotes(app);
    const row = page.locator('[data-testid="vb-row-Mira.md"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await expect(page.locator('[data-testid="note-title"]')).toHaveText('Mira', { timeout: 10_000 });

    // The cover sits in the header beside the title. No frontmatter `thumb:`
    // → derived from the first image → the badge reads exactly "Auto", and
    // the slot paints the generated webp derivative, not the source PNG.
    const cover = page.locator('[data-testid="note-cover"]');
    await expect(cover).toBeVisible({ timeout: 10_000 });
    await expect(cover).toHaveAttribute('data-thumb-mode', 'auto');
    await expect(page.locator('[data-testid="note-cover-badge"]')).toHaveText('Auto');
    await expect(page.locator('[data-testid="note-header"] [data-testid="note-cover"]')).toHaveCount(1);
    await expect(cover.locator('.note-thumb img')).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 15_000 });
    const box = await cover.boundingBox();
    expect(box?.width).toBe(176);
    expect(box?.height).toBe(104);

    // × is a real button with the spec label; pressing it writes `thumb: false`
    // into the note's frontmatter on disk (bare YAML boolean, body untouched)
    // and the cover leaves the editor.
    const remove = page.locator('[data-testid="note-cover-remove"]');
    await expect(remove).toHaveAttribute('aria-label', 'Remove thumbnail');
    await remove.click();
    await expect.poll(() => fs.readFileSync(noteFile, 'utf-8'), { timeout: 10_000 }).toMatch(/^---\nthumb: false\n---\n/);
    expect(fs.readFileSync(noteFile, 'utf-8')).toContain('![[portrait.png]]');
    await expect(cover).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('[data-testid="note-cover-badge"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="note-title"]')).toHaveText('Mira');

    // The Board agrees: the same note is now a text-only card (§15 test 12).
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
    const mira = cardByLabel(page, 'Mira');
    await expect(mira).toBeVisible({ timeout: 10_000 });
    await expect(mira.locator('.board-canvas__thumb')).toHaveCount(0);
    expect(await cardHeight(mira)).toBe(154);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
