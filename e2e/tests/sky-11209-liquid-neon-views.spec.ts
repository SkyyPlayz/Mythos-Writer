/**
 * sky-11209-liquid-neon-views.spec.ts — SKY-11209
 *
 * Vault Graph (.vgv-root/.vgv-canvas/.vgv-state) and Manuscript Structure
 * (.msv) painted a flat opaque --bg-base fill directly over the shell
 * wallpaper, so the Liquid Neon background a user picked was invisible in
 * these views — a computed-style check alone can't catch this class of bug
 * (the bug IS that the computed value looked fine while the pixels didn't).
 * This asserts real rendered pixel luminance: with a bright custom
 * wallpaper set, each view's own canvas region must read meaningfully
 * lighter than with wp:'deep'.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/sky-11209-liquid-neon-views.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { PNG } from 'pngjs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const now = '2026-06-17T00:00:00.000Z';

// Deliberately bright and busy — AC #3 calls for legibility proof against a
// bright wallpaper, not just a dark one.
const BRIGHT_WALLPAPER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'>
  <rect width='400' height='400' fill='#fff04d'/>
  <rect x='0' y='0' width='200' height='200' fill='#ff2fd8'/>
  <rect x='200' y='200' width='200' height='200' fill='#2fe6ff'/>
  <circle cx='100' cy='300' r='70' fill='#39ff8c'/>
  <circle cx='300' cy='100' r='70' fill='#ff6a2f'/>
</svg>`;
const BRIGHT_WALLPAPER_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(BRIGHT_WALLPAPER_SVG).toString('base64')}`;

interface SeedOptions {
  /**
   * Mount the Continuity panel with its scan toolbar (SKY-11492): the Archive
   * Agent on and the right sidebar explicitly visible, as continuity-panel.spec seeds.
   */
  continuityPanel?: boolean;
}

function seedProject(
  userData: string,
  storyVaultDir: string,
  notesVaultDir: string,
  wp: 'custom' | 'deep',
  opts: SeedOptions = {},
): void {
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      archive: { enabled: opts.continuityPanel ?? false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    ...(opts.continuityPanel ? { rightSidebarVisible: true } : {}),
    // SKY-11209: liquidNeonV2 drives BackgroundStack's --wp (the live
    // wallpaper layer painted at z-index:0 inside .desktop-shell).
    liquidNeonV2: wp === 'custom'
      ? { wp: 'custom', customWp: BRIGHT_WALLPAPER_DATA_URL }
      // SKY-11589: `none` was removed (normalizes to Theme match); `deep` is the
      // plain-dark baseline (linear-gradient(#07080d,#07080d)) the old `none` gave.
      : { wp: 'deep' },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const scene = {
    id: 'scene-1', title: 'Opening Scene', path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
    order: 1, blocks: [{ id: 'block-1', type: 'prose', content: 'Meet Elara.', order: 1, updatedAt: now }],
    createdAt: now, updatedAt: now,
  };
  const chapter = {
    id: 'chapter-1', title: 'Chapter One', path: 'Test Story/Manuscript/Chapter One',
    order: 1, scenes: [scene], createdAt: now, updatedAt: now,
  };
  const story = {
    id: 'story-1', title: 'Test Story', path: 'Test Story',
    chapters: [chapter], createdAt: now, updatedAt: now,
  };
  fs.writeFileSync(path.join(storyVaultDir, 'manifest.json'), JSON.stringify({
    version: '1.0.0', vaultRoot: storyVaultDir, stories: [story], chapters: [chapter],
    scenes: [scene], entities: [], suggestions: [],
  }, null, 2));
  fs.writeFileSync(path.join(storyVaultDir, scene.path), 'Meet Elara.');
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Elara.md'), '# Elara\n\nA note about the vault.');
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/** Mean luminance (Rec. 601) over a screenshot buffer, cropped to `box`. */
function meanLuma(pngBuffer: Buffer, box: { x: number; y: number; width: number; height: number }): number {
  const png = PNG.sync.read(pngBuffer);
  const x0 = Math.max(0, Math.round(box.x));
  const y0 = Math.max(0, Math.round(box.y));
  const x1 = Math.min(png.width, Math.round(box.x + box.width));
  const y1 = Math.min(png.height, Math.round(box.y + box.height));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      n++;
    }
  }
  return n ? sum / n : NaN;
}

async function withApp(
  wp: 'custom' | 'deep',
  fn: (page: Page) => Promise<void>,
  opts: SeedOptions = {},
): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11209-${wp}-`));
  const storyVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11209-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11209-notes-'));
  seedProject(userData, storyVaultDir, notesVaultDir, wp, opts);

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(1000);
    await fn(page);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(storyVaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  }
}

test('SKY-11209: Vault Graph canvas shows the wallpaper behind it, not a flat fill', async () => {
  let brightLuma = NaN;
  let deepLuma = NaN;

  await withApp('custom', async (page) => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
    await page.waitForSelector('#app-tabpanel-vault-graph', { timeout: 8000 });
    await page.waitForTimeout(1200);
    const box = await page.locator('.vgv-canvas').boundingBox();
    expect(box).not.toBeNull();
    const buf = await page.screenshot();
    brightLuma = meanLuma(buf, box!);
  });

  await withApp('deep', async (page) => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
    await page.waitForSelector('#app-tabpanel-vault-graph', { timeout: 8000 });
    await page.waitForTimeout(1200);
    const box = await page.locator('.vgv-canvas').boundingBox();
    expect(box).not.toBeNull();
    const buf = await page.screenshot();
    deepLuma = meanLuma(buf, box!);
  });

  // wp:'deep' stays dark (no regression from the pre-fix flat --bg-base look).
  expect(deepLuma).toBeLessThan(30);
  // A bright, busy wallpaper must visibly lighten the canvas region — this
  // is the actual bug: the old opaque fill kept this flat regardless of the
  // wallpaper setting.
  expect(brightLuma).toBeGreaterThan(50);
  expect(brightLuma - deepLuma).toBeGreaterThan(30);
});

test('SKY-11209: Manuscript Structure view shows the wallpaper behind it, not a flat fill', async () => {
  let brightLuma = NaN;
  let deepLuma = NaN;

  await withApp('custom', async (page) => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    // A fresh vault has no active story, so Story Writer opens the Stories
    // popover instead of a tabpanel — pick the seeded story to close it and
    // populate .msv (also exercises the populated view, not just msv--no-story).
    const storyPick = page.locator('[data-testid="nav-rail-story-story-1"]');
    if (await storyPick.count()) await storyPick.click();
    await page.waitForSelector('#app-tabpanel-story', { timeout: 8000 });
    await page.locator('[data-testid="story-subview-structure"]').click();
    await page.waitForTimeout(1000);
    const box = await page.locator('.msv').boundingBox();
    expect(box).not.toBeNull();
    const buf = await page.screenshot();
    brightLuma = meanLuma(buf, box!);
  });

  await withApp('deep', async (page) => {
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    // A fresh vault has no active story, so Story Writer opens the Stories
    // popover instead of a tabpanel — pick the seeded story to close it and
    // populate .msv (also exercises the populated view, not just msv--no-story).
    const storyPick = page.locator('[data-testid="nav-rail-story-story-1"]');
    if (await storyPick.count()) await storyPick.click();
    await page.waitForSelector('#app-tabpanel-story', { timeout: 8000 });
    await page.locator('[data-testid="story-subview-structure"]').click();
    await page.waitForTimeout(1000);
    const box = await page.locator('.msv').boundingBox();
    expect(box).not.toBeNull();
    const buf = await page.screenshot();
    deepLuma = meanLuma(buf, box!);
  });

  expect(deepLuma).toBeLessThan(30);
  expect(brightLuma).toBeGreaterThan(50);
  expect(brightLuma - deepLuma).toBeGreaterThan(30);
});

// ─── SKY-11492: shared popup primitives on the overlay tier ──────────────────
//
// `.ln-menu` (ui/Menu — every context/action menu in the app) and
// `.ln-select-listbox` (ui/DropdownSelect) painted a flat `--bg-elevated` fill
// with a neutral hairline and no blur, while every dialog sat on the Liquid
// Neon overlay tier. Both now carry `.ln-overlay-surface`. This opens real
// consumers through the UI and asserts each popup's computed fill / blur / rim
// is *identical* to a bare `.ln-overlay-surface` probe read in the same tick —
// so a primitive can't quietly drift off the tier again — and that the tier
// itself is the owner mockup's recipe (rgba(15,19,33,.97) over blur(24px)),
// not two broken values agreeing with each other. The shadow is asserted on
// its own: the mockup paints menus and dropdowns with the depth layer only,
// no neon glow (dc.html 83; prototype navCtxSt / treeCtxSt).

interface PopupChrome {
  backgroundColor: string;
  backdropFilter: string;
  borderTopWidth: string;
  borderTopColor: string;
  boxShadow: string;
}

/** The popup's computed chrome and a throwaway `.ln-overlay-surface` probe's, read together. */
async function popupVsTier(page: Page, selector: string): Promise<{ popup: PopupChrome; tier: PopupChrome }> {
  return page.evaluate((sel) => {
    const read = (el: Element): PopupChrome => {
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        backdropFilter: cs.backdropFilter,
        borderTopWidth: cs.borderTopWidth,
        borderTopColor: cs.borderTopColor,
        boxShadow: cs.boxShadow,
      };
    };
    const el = document.querySelector(sel);
    if (!el) throw new Error(`popupVsTier: ${sel} not in the DOM`);
    const probe = document.createElement('div');
    probe.className = 'ln-overlay-surface';
    probe.style.position = 'fixed';
    probe.style.left = '-9999px';
    document.body.appendChild(probe);
    try {
      return { popup: read(el), tier: read(probe) };
    } finally {
      probe.remove();
    }
  }, selector);
}

// The tier's depth layer, optionally followed by the transparent glow slot
// (`--ln-overlay-glow: transparent`) — never a visible glow colour.
const MENU_SHADOW = /^rgba\(3, 5, 12, 0\.6\) 0px 14px 40px 0px(, rgba\(0, 0, 0, 0\) 0px 0px 22px -6px)?$/;

function expectPopupOnTier({ popup, tier }: { popup: PopupChrome; tier: PopupChrome }): void {
  // Guard the target first: the tier is the mockup's fixed recipe (SKY-11491).
  expect(tier.backgroundColor).toBe('rgba(15, 19, 33, 0.97)');
  expect(tier.backdropFilter).toBe('blur(24px)');
  const { boxShadow: popupShadow, ...popupGlass } = popup;
  const { boxShadow: tierShadow, ...tierGlass } = tier;
  expect(popupGlass).toEqual(tierGlass);
  expect(tierShadow).toMatch(/^rgba\(3, 5, 12, 0\.6\) 0px 14px 40px 0px, /);
  expect(popupShadow).toMatch(MENU_SHADOW);
}

/** Menus dismiss on any outside mousedown — the corner is always outside a popup. */
async function clickOutsidePopups(page: Page): Promise<void> {
  const [w, h] = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  await page.mouse.click(w - 2, h - 2);
}

test('SKY-11492: .ln-menu and .ln-select-listbox popups render on the overlay tier', async () => {
  await withApp('deep', async (page) => {
    // 1. `.ln-menu` — the Story Navigator context menu, via a real right-click.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    const storyPick = page.locator('[data-testid="nav-rail-story-story-1"]');
    if (await storyPick.count()) await storyPick.click();
    const storyRow = page.locator('.nav-story-row').first();
    await expect(storyRow).toBeVisible({ timeout: 15_000 });
    await storyRow.click({ button: 'right' });
    const menu = page.locator('[data-testid="story-navigator-context-menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu).toHaveClass(/\bln-overlay-surface\b/);
    expectPopupOnTier(await popupVsTier(page, '[data-testid="story-navigator-context-menu"]'));
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // 2. `.ln-menu.vb-ctx-menu` — the notes-tree context menu. It hand-rolled
    //    this exact recipe before SKY-11492, so it is the regression control:
    //    on the primitive now, and still measuring the same.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    const notesRow = page.locator('[data-testid="vb-row-Characters"]');
    await expect(notesRow).toBeVisible({ timeout: 15_000 });
    await notesRow.click({ button: 'right' });
    const treeMenu = page.locator('[data-testid="vb-context-menu"]');
    await expect(treeMenu).toBeVisible({ timeout: 5_000 });
    expectPopupOnTier(await popupVsTier(page, '[data-testid="vb-context-menu"]'));
    await clickOutsidePopups(page);
    await expect(treeMenu).toHaveCount(0);

    // 3. `.ln-select-listbox` — the Continuity scan-scope picker in the right sidebar.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]').click();
    if (await storyPick.count()) await storyPick.click();
    const picker = page.getByTestId('global-right-sidebar').getByRole('combobox', { name: /scan scope/i });
    await expect(picker).toBeVisible({ timeout: 12_000 });
    await picker.click();
    const listbox = page.locator('[data-testid="ln-select-listbox"]');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await expect(listbox).toHaveClass(/\bln-overlay-surface\b/);
    expectPopupOnTier(await popupVsTier(page, '[data-testid="ln-select-listbox"]'));
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
  }, { continuityPanel: true });
});
