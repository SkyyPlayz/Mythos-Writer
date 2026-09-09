/**
 * sky-11566-boards-chrome-fidelity.spec.ts — SKY-11566 (owner-fidelity wave 2).
 *
 * The two Boards chrome gaps left over from `docs/fidelity/SKY-11480-liquid-neon-gap-list.md`
 * after SKY-11494 closed the canvas and the tiles, measured across the real
 * process boundary (COMPANY-STANDARDS §4a) against the mockup's own
 * declarations rather than by eye:
 *
 *   BD-4  the zoom pill wore the slot-1 rim and the frozen overlay (dialog)
 *         tier. `owner-reports/2026-09-02-design-liquid-neon.dc.html:2553`
 *         gives it `--glass2` + `blur(20px)` behind a slot-2 rim.
 *   BD-5  the crumb bar rode the panel tier, which the engine drives to
 *         rgba(13,16,28,.20) + blur(1px) at the shipped defaults. The mockup
 *         leaves the crumb row unfilled (dc.html:2382) only because its center
 *         pane (dc.html:571) paints the glass behind it; we have no such pane,
 *         so the bar carries the mockup's Boards chrome fill itself.
 *
 * Both are asserted as computed values, and both are proven live against the
 * Appearance glass slider by driving `--glass2` and re-reading the paint — a
 * fill pinned to a literal would not move. Screenshots land in
 * `docs/screenshots/sky11566/`, one per gap.
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
const SHOTS = path.resolve(__dirname, '../../docs/screenshots/sky11566');

// ── Fixture ──────────────────────────────────────────────────────────────────

function makeTemp(): { tempRoot: string; userData: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11566-'));
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
  // A folder and a note, so the board has something to render behind the chrome.
  fs.mkdirSync(path.join(notesDir, 'Chronicles'), { recursive: true });
  fs.writeFileSync(path.join(notesDir, 'Chronicles', 'siege.md'), '# Siege\n\nThe wall held.\n');
  fs.writeFileSync(path.join(notesDir, 'lore.md'), '# Lore\n\nOlder than the city.\n');
  return { tempRoot, userData };
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
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
  await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.board-canvas__zoom-controls')).toBeVisible({ timeout: 10_000 });
  return page;
}

// ── Colour helpers ───────────────────────────────────────────────────────────

interface Rgba { r: number; g: number; b: number; a: number }

/** Chromium serializes rgb()/rgba() with 0–255 channels; normalize to one shape. */
function parseColor(value: string): Rgba {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value.trim());
  if (!m) throw new Error(`unparseable colour: ${value}`);
  return {
    r: Math.round(Number(m[1])),
    g: Math.round(Number(m[2])),
    b: Math.round(Number(m[3])),
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
}

/** The chrome a fidelity gap is actually about: fill, frost, rim, elevation. */
async function chromeOf(page: Page, selector: string) {
  const raw = await page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      background: cs.backgroundColor,
      backdropFilter: cs.backdropFilter,
      borderColor: cs.borderTopColor,
      borderWidth: cs.borderTopWidth,
      boxShadow: cs.boxShadow,
    };
  });
  return { ...raw, fill: parseColor(raw.background), rim: parseColor(raw.borderColor) };
}

/** A live `:root` custom property, as the engine last stamped it. */
async function rootToken(page: Page, name: string): Promise<string> {
  return (
    await page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n), name)
  ).trim();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('SKY-11566 — Boards chrome vs the owner mockup', () => {
  let app: ElectronApplication;
  let page: Page;
  let tempRoot: string;

  test.beforeAll(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const t = makeTemp();
    tempRoot = t.tempRoot;
    app = await launchApp(t.userData);
    page = await bootToBoards(app);
  });

  test.afterAll(async () => {
    await app?.close();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('BD-4: the zoom pill is --glass2 + a 20px frost behind a slot-2 rim', async () => {
    const pill = await chromeOf(page, '.board-canvas__zoom-controls');
    const glass2 = parseColor(await rootToken(page, '--glass2'));
    const b1 = parseColor(await rootToken(page, '--b1'));
    const b2 = parseColor(await rootToken(page, '--b2'));

    // Fill: the mockup's raised-chrome tier, engine-driven, floored at 50%.
    expect(pill.fill).toEqual(glass2);
    expect(pill.fill.r).toBe(21);
    expect(pill.fill.g).toBe(26);
    expect(pill.fill.b).toBe(45);
    expect(pill.fill.a).toBeGreaterThanOrEqual(0.5);

    // Not the frozen overlay tier it shipped on — that is the dialog recipe.
    const overlay = parseColor(await rootToken(page, '--glass-fill-overlay'));
    expect(pill.fill).not.toEqual(overlay);

    // Frost: a real 20px, not the 1.25px the tier used to derive.
    expect(pill.backdropFilter).toBe('blur(20px)');

    // Rim: slot 2, and demonstrably not the slot-1 value it carried before.
    expect(pill.rim).toEqual(b2);
    expect(pill.rim).not.toEqual(b1);
    expect(pill.borderWidth).toBe('1px');

    // Elevation already matched the mockup and must stay put.
    expect(pill.boxShadow).toContain('0px 10px 30px');
  });

  test('BD-5: the crumb bar is off the 20% panel tier and onto the chrome tier', async () => {
    const bar = await chromeOf(page, '.boards-tab-panel__breadcrumb');
    const glass2 = parseColor(await rootToken(page, '--glass2'));
    const panel = parseColor(await rootToken(page, '--glass-fill'));

    expect(bar.fill).toEqual(glass2);
    expect(bar.fill.a).toBeGreaterThanOrEqual(0.5);

    // The regression: the panel tier resolves to 20% at the shipped defaults,
    // and its 1px blur is a compositing layer bought for no visible frost.
    expect(bar.fill).not.toEqual(panel);
    expect(panel.a).toBeLessThan(0.5);
    expect(bar.backdropFilter).toBe('blur(20px)');
    expect(bar.backdropFilter).not.toBe(`blur(${await rootToken(page, '--blur-panel')})`);
  });

  test('both surfaces repaint when the glass slider moves', async () => {
    // A fill pinned to a literal — the overlay tier, or the mockup's fallback —
    // would not move. Drive --glass2 the way the engine does and re-read paint.
    const before = {
      pill: (await chromeOf(page, '.board-canvas__zoom-controls')).background,
      bar: (await chromeOf(page, '.boards-tab-panel__breadcrumb')).background,
    };

    await page.evaluate(() =>
      document.documentElement.style.setProperty('--glass2', 'rgba(21,26,45,0.93)'),
    );
    const after = {
      pill: (await chromeOf(page, '.board-canvas__zoom-controls')).fill,
      bar: (await chromeOf(page, '.boards-tab-panel__breadcrumb')).fill,
    };
    expect(after.pill.a).toBeCloseTo(0.93, 2);
    expect(after.bar.a).toBeCloseTo(0.93, 2);

    await page.evaluate(() => document.documentElement.style.removeProperty('--glass2'));
    expect((await chromeOf(page, '.board-canvas__zoom-controls')).background).toBe(before.pill);
    expect((await chromeOf(page, '.boards-tab-panel__breadcrumb')).background).toBe(before.bar);
  });

  test('captures one screenshot per gap', async () => {
    // The first-run "notes moved" toast lands over the zoom pill for its 5s
    // life. Let it expire rather than photograph the chrome through it.
    await expect(page.locator('.app-toast--stacked')).toHaveCount(0, { timeout: 8_000 });

    const bar = await page.locator('.boards-tab-panel__breadcrumb').boundingBox();
    const pill = await page.locator('.board-canvas__zoom-controls').boundingBox();
    expect(bar).not.toBeNull();
    expect(pill).not.toBeNull();

    // Enough surrounding canvas to show the chrome against what it sits on.
    await page.screenshot({
      path: path.join(SHOTS, 'bd5-breadcrumb-chrome-tier.png'),
      clip: { x: 60, y: Math.max(0, bar!.y - 12), width: 900, height: bar!.height + 120 },
    });
    await page.screenshot({
      path: path.join(SHOTS, 'bd4-zoom-pill-slot2-rim.png'),
      clip: {
        x: Math.max(0, pill!.x - 160),
        y: Math.max(0, pill!.y - 90),
        width: pill!.width + 320,
        height: pill!.height + 110,
      },
    });
  });
});
