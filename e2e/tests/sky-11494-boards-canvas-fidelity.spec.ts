/**
 * sky-11494-boards-canvas-fidelity.spec.ts — SKY-11494 (owner-fidelity wave 1).
 *
 * Three named gaps from `docs/fidelity/SKY-11480-liquid-neon-gap-list.md`,
 * measured across the real process boundary (COMPANY-STANDARDS §4a) against
 * the owner mockup's own numbers rather than by eye:
 *
 *   BD-1  the canvas shipped fully opaque; `bdCanvasSt` specifies a 42% scrim
 *         over the wallpaper behind a NEUTRAL hairline.
 *   BD-2  the dot grid tracked neither pan nor zoom; `bdCanvasSt` binds
 *         background-size to `20 * scale` and background-position to the pan.
 *   BD-3  every tile wore the full-alpha slot rim at rest, which in `bdCards`
 *         is the *selection* affordance.
 *
 * Screenshots land in `docs/screenshots/sky11494/` — one per gap, plus the two
 * zoom levels and the offset pan BD-2's acceptance criteria call for.
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
const SHOTS = path.resolve(__dirname, '../../docs/screenshots/sky11494');

// ── Fixture ──────────────────────────────────────────────────────────────────

function makeTemp(slug: string): { tempRoot: string; userData: string; notesDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11494-${slug}-`));
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
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 8_000 });
  return page;
}

// ── Colour helpers ───────────────────────────────────────────────────────────

/**
 * Chromium serializes a resolved `color-mix()` as `color(srgb r g b / a)` with
 * 0–1 channels, and a plain rgb() as `rgba(r, g, b, a)` with 0–255 channels.
 * Normalize both to 0–255 + alpha so an assertion reads the same either way.
 */
function parseColor(value: string): { r: number; g: number; b: number; a: number } {
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value.trim());
  if (srgb) {
    return {
      r: Math.round(Number(srgb[1]) * 255),
      g: Math.round(Number(srgb[2]) * 255),
      b: Math.round(Number(srgb[3]) * 255),
      a: srgb[4] === undefined ? 1 : Number(srgb[4]),
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value.trim());
  if (!rgb) throw new Error(`unparseable colour: ${value}`);
  return {
    r: Math.round(Number(rgb[1])),
    g: Math.round(Number(rgb[2])),
    b: Math.round(Number(rgb[3])),
    a: rgb[4] === undefined ? 1 : Number(rgb[4]),
  };
}

/**
 * Tiles transition border-color/box-shadow over 150ms, and mid-flight Chromium
 * reports an oklab interpolation rather than either endpoint. Wait for the
 * transition to finish so the assertion measures the painted state, not a
 * frame of the animation between the two states under test.
 */
async function settled(locator: ReturnType<Page['locator']>): Promise<void> {
  await locator.evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}

/** Resolved border colour of an element, once its transition has landed. */
async function rimColor(locator: ReturnType<Page['locator']>) {
  await settled(locator);
  return parseColor(await locator.evaluate((el) => getComputedStyle(el).borderTopColor));
}

const computed = (page: Page, selector: string, prop: string): Promise<string> =>
  page.locator(selector).first().evaluate(
    (el, p) => getComputedStyle(el).getPropertyValue(p),
    prop,
  );

function shot(name: string): string {
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, `${name}.png`);
}

// ── BD-1 ─────────────────────────────────────────────────────────────────────

test('SKY-11494 BD-1: canvas fill is the mockup 42% scrim behind a neutral hairline', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('bd1');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Locations/Castle.md', '# Castle\n');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(page.locator('.board-canvas__item').first()).toBeVisible({ timeout: 8_000 });

    // Fill: mockup `bdCanvasSt` → rgba(8,10,18,.42). Measured, not eyeballed.
    const fill = parseColor(await computed(page, '.board-canvas__root', 'background-color'));
    expect(fill).toMatchObject({ r: 8, g: 10, b: 18 });
    expect(fill.a).toBeCloseTo(0.42, 2);

    // Rim: the mockup's neutral hairline, NOT a slot colour. Cyan/violet here
    // was the BD-1 regression — in this region the neon lives on the cards.
    const rim = parseColor(await computed(page, '.board-canvas__root', 'border-top-color'));
    expect(rim).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(rim.a).toBeCloseTo(0.07, 2);

    expect(await computed(page, '.board-canvas__root', 'border-top-left-radius')).toBe('16px');

    await page.locator('.board-canvas__root').screenshot({ path: shot('bd1-canvas-42pct-scrim') });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── BD-2 ─────────────────────────────────────────────────────────────────────

test('SKY-11494 BD-2: the dot grid scales with zoom and translates with pan', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('bd2');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Intro.md', '# Intro\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    await expect(page.locator('.board-canvas__item').first()).toBeVisible({ timeout: 8_000 });

    // At rest: the world's own 20px snap grid, unshifted.
    expect(await computed(page, '.board-canvas__root', 'background-size')).toBe('20px 20px');
    expect(await computed(page, '.board-canvas__root', 'background-position')).toBe('0px 0px');
    await page.locator('.board-canvas__root').screenshot({ path: shot('bd2-grid-zoom-100') });

    // Zoom in 3 × 10% → 130%: the grid must scale with the world (26px), which
    // it did not before — it was pinned at a decorative 26px at every zoom.
    const zoomIn = page.locator('.board-canvas__zoom-btn[aria-label="Zoom in"]');
    for (let i = 0; i < 3; i += 1) await zoomIn.click();
    await expect(page.locator('.board-canvas__zoom-reset')).toHaveText('130%');
    expect(await computed(page, '.board-canvas__root', 'background-size')).toBe('26px 26px');
    await page.locator('.board-canvas__root').screenshot({ path: shot('bd2-grid-zoom-130') });

    // Zoom out to 70% → 14px, proving it tracks in both directions.
    const zoomOut = page.locator('.board-canvas__zoom-btn[aria-label="Zoom out"]');
    for (let i = 0; i < 6; i += 1) await zoomOut.click();
    await expect(page.locator('.board-canvas__zoom-reset')).toHaveText('70%');
    expect(await computed(page, '.board-canvas__root', 'background-size')).toBe('14px 14px');
    await page.locator('.board-canvas__root').screenshot({ path: shot('bd2-grid-zoom-70') });

    // Back to 100%, then pan with the middle button. Pan clamps at 0, so drag
    // up-and-left; the grid origin must follow the world by the same offset.
    await page.locator('.board-canvas__zoom-reset').click();
    await expect(page.locator('.board-canvas__zoom-reset')).toHaveText('100%');

    const box = await page.locator('.board-canvas__root').boundingBox();
    if (!box) throw new Error('no canvas bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(startX - 120, startY - 80, { steps: 8 });
    await page.mouse.up({ button: 'middle' });

    expect(await computed(page, '.board-canvas__root', 'background-position')).toBe('-120px -80px');
    expect(await computed(page, '.board-canvas__root', 'background-size')).toBe('20px 20px');
    await page.locator('.board-canvas__root').screenshot({ path: shot('bd2-grid-panned') });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ── BD-3 ─────────────────────────────────────────────────────────────────────

test('SKY-11494 BD-3: the slot rim marks selection; tiles rest on a neutral hairline', async () => {
  test.setTimeout(120_000);
  const { tempRoot, userData, notesDir } = makeTemp('bd3');
  mkNote(notesDir, 'Characters/Alice.md', '# Alice\n');
  mkNote(notesDir, 'Intro.md', '# Intro — the opening beat of the story.\n');
  mkNote(notesDir, 'Outline.md', '# Outline — three acts, eight beats.\n');

  const app = await launchApp(userData);
  try {
    const page = await bootToBoards(app);
    const intro = page.locator('.board-canvas__item--note', { hasText: 'Intro' }).first();
    await expect(intro).toBeVisible({ timeout: 8_000 });

    // Rest: the mockup's neutral hairline over a depth shadow. Nothing is
    // selected, so no tile may wear a slot colour.
    const rest = await rimColor(intro);
    expect(rest).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(rest.a).toBeCloseTo(0.1, 2);
    const restShadow = await intro.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(restShadow).toContain('rgba(3, 5, 12, 0.45)');
    await page.locator('.board-canvas__root').screenshot({ path: shot('bd3-tiles-at-rest') });

    // Selected: slot 1 (notes) at the mockup's .95, plus the 1px halo + glow.
    await intro.click();
    await expect(intro).toHaveClass(/board-canvas__item--selected/);
    const selected = await rimColor(intro);
    expect(selected).toMatchObject({ r: 0, g: 240, b: 255 });
    expect(selected.a).toBeCloseTo(0.95, 2);

    // The point of the gap: rest and selected must not be the same rim.
    expect(selected.a).toBeGreaterThan(rest.a);
    const selShadow = await intro.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(selShadow).not.toContain('rgba(3, 5, 12, 0.45)');
    await page.locator('.board-canvas__root').screenshot({ path: shot('bd3-tile-selected') });

    // Board tiles select on slot 2, so the mockup's per-category colouring is
    // preserved by the selection rim rather than spent at rest.
    const characters = page.locator('.board-canvas__item--folder', { hasText: 'Characters' }).first();
    await characters.click();
    await expect(intro).not.toHaveClass(/board-canvas__item--selected/);
    const folderSel = await rimColor(characters);
    expect(folderSel).toMatchObject({ r: 155, g: 95, b: 255 });
    expect(folderSel.a).toBeCloseTo(0.95, 2);

    // Clicking empty canvas clears the selection — the rim goes back to rest.
    const box = await page.locator('.board-canvas__root').boundingBox();
    if (!box) throw new Error('no canvas bounding box');
    await page.mouse.click(box.x + box.width - 60, box.y + box.height - 40);
    await expect(characters).not.toHaveClass(/board-canvas__item--selected/);
    const cleared = await rimColor(characters);
    expect(cleared).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(cleared.a).toBeCloseTo(0.1, 2);
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
