/**
 * sky-11566-boards-chrome-fidelity.spec.ts — SKY-11566 (owner-fidelity wave 2)
 * + 0.5.2 residual BD-7.
 *
 * Boards chrome gaps from `docs/fidelity/SKY-11480-liquid-neon-gap-list.md`,
 * measured across the real process boundary (COMPANY-STANDARDS §4a):
 *
 *   BD-4  zoom pill on slot-2 rim + `--glass2` + `blur(20px)` (dc.html:2553).
 *   BD-5  crumb must not ride the 20% panel tier. With BD-7 the crumb is
 *         transparent; the center pane owns the glass (mockup dc.html ~495).
 *   BD-7  `.boards-tab-panel` is the center pane: 18px, slot-2 rim,
 *         `--glass2` pane fill (no live blur-panel — #1598 contract).
 *
 * Screenshots land in `docs/screenshots/sky11566/`.
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

  test('BD-5 + BD-7: crumb is transparent; the center pane owns the glass (not panel tier)', async () => {
    const bar = await chromeOf(page, '.boards-tab-panel__breadcrumb');
    const pane = await chromeOf(page, '.boards-tab-panel');
    const b2 = parseColor(await rootToken(page, '--b2'));
    const panel = parseColor(await rootToken(page, '--glass-fill'));

    // Mockup crumb has no fill once the center pane exists (BD-7).
    expect(bar.fill.a).toBe(0);
    expect(bar.backdropFilter === 'none' || bar.backdropFilter === '').toBe(true);

    // Pane: slot-2 rim + halo (mockup center pane). Fill is denser --glass2
    // (raised chrome), not the thin panel-tier --glass-fill / --glass-panel-bg.
    expect(pane.rim).toEqual(b2);
    expect(pane.boxShadow).toMatch(/inset/);
    expect(panel.a).toBeLessThan(0.5);
    // Must not paint the thin panel-tier solid as the pane background.
    expect(pane.fill).not.toEqual(panel);
    const paneToken = await page.locator('.boards-tab-panel').evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--boards-pane-fill').trim(),
    );
    expect(paneToken.length).toBeGreaterThan(0);
    expect(paneToken).not.toMatch(/rgba\(\s*13\s*,\s*16\s*,\s*28\s*,\s*0\.2/);
  });

  test('zoom pill repaints when the glass slider moves', async () => {
    // A fill pinned to a literal — the overlay tier, or the mockup's fallback —
    // would not move. Drive --glass2 the way the engine does and re-read paint.
    const before = (await chromeOf(page, '.board-canvas__zoom-controls')).background;

    await page.evaluate(() =>
      document.documentElement.style.setProperty('--glass2', 'rgba(21,26,45,0.93)'),
    );
    const after = (await chromeOf(page, '.board-canvas__zoom-controls')).fill;
    expect(after.a).toBeCloseTo(0.93, 2);

    await page.evaluate(() => document.documentElement.style.removeProperty('--glass2'));
    expect((await chromeOf(page, '.board-canvas__zoom-controls')).background).toBe(before);
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
