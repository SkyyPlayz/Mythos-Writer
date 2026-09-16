/**
 * capture-sky-11491-overlay-tier-recipe.spec.ts — SKY-11491 PR evidence (NOT part of CI)
 *
 * SKY-11133 put dialogs/popovers on an overlay tier, but the engine derived it
 * from the glass sliders (glassA × 1.25 / blur × 1.25), which at the shipped
 * defaults painted every dialog rgba(13,16,28,0.25) over blur(1.25px) — i.e.
 * see-through. This PR makes the tier the mockup's fixed recipe owned by
 * tokens.css (rgba(15,19,33,0.97) / 24px) and emits the hairline set
 * (--bwh / --grh / --bh / --glowH) the Scene Crafter panels now read.
 *
 * Shot from a fresh profile (§4c) on both sides of the change so the
 * before/after compares 1:1:
 *
 *   1-keyboard-shortcuts     KeyboardShortcutsDialog over the welcome empty
 *                            state — the readability regression itself: the
 *                            "Welcome to Mythos Writer" copy must be BEHIND
 *                            the dialog, not showing through it.
 *   2-keyboard-shortcuts-high-contrast
 *                            Same dialog at [data-contrast="high"] — the
 *                            opaque degrade must still flatten.
 *   3-settings               Settings panel — the SKY-11133 control surface.
 *   4-scene-crafter-panels   .sc-panel / .sc-sugg-card hairline chrome, now
 *                            fed by the engine's --bwh / --bh / --glowH.
 *   5-boards-zoom-toolbar    The floating Boards zoom pill (clipped), plus
 *   5b-boards-canvas         the whole canvas for context.
 *
 * Every shot also dumps the computed chrome + the root tokens, so the wiring
 * (not just the pixels) is on record. No value assertions: the same file runs
 * against the pre-change build.
 *
 * Modeled on e2e/capture-sky-11450-overlay-tier.spec.ts (same launch shape).
 *
 * Output: pr-screenshots/sky-11491-overlay-tier-recipe/<SHOT_PREFIX><name>.png
 *         pr-screenshots/sky-11491-overlay-tier-recipe/<SHOT_PREFIX>chrome.json
 *
 * Run (after `npm run build:electron`):
 *   SHOT_PREFIX=after- xvfb-run --auto-servernum npx playwright test \
 *     e2e/capture-sky-11491-overlay-tier-recipe.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11491-overlay-tier-recipe');
const PREFIX = process.env.SHOT_PREFIX ?? '';

const VIEWPORT = { width: 1440, height: 900 };

/** Tier + hairline tokens this PR owns, plus the base pair they used to derive from. */
const ROOT_TOKENS: string[] = [
  '--glass-fill-overlay',
  '--blur-panel-overlay',
  '--bwh',
  '--grh',
  '--bh',
  '--glowH',
  '--glass-fill',
  '--blur-panel',
];

/** Notes so the Boards canvas has folder tiles to lay out (shot 5). */
const SEED_NOTES: ReadonlyArray<readonly [string, string]> = [
  ['Characters/Mira Veynn.md', '# Mira Veynn\n\nShe reads the tide charts like other people read faces.\n'],
  ['Characters/Kael Thorne.md', '# Kael Thorne\n\nOwes the Gate a debt he intends to pay in salt.\n'],
  ['Locations/The Sunken Gate.md', '# The Sunken Gate\n\nA drowned arch that still keeps the hour it fell.\n'],
  ['Items & Systems/Drownlight.md', '# Drownlight\n\nCold lamp-glow that only burns where the water has been.\n'],
];

test.setTimeout(240_000);

interface ChromeEntry {
  selector: string;
  count: number;
  backgroundColor?: string;
  backdropFilter?: string;
  borderTopWidth?: string;
  borderTopColor?: string;
  boxShadow?: string;
  note?: string;
}

interface ShotReport {
  elements: ChromeEntry[];
  tokens?: Record<string, string>;
}

const report: Record<string, ShotReport> = {};

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}${name}.png`) });
  console.log(`  wrote ${PREFIX}${name}.png`);
}

async function readChrome(page: Page, selector: string): Promise<ChromeEntry> {
  return page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    const el = nodes[0];
    if (!el) return { selector: sel, count: 0, note: 'not present in the DOM' };
    const cs = getComputedStyle(el);
    return {
      selector: sel,
      count: nodes.length,
      backgroundColor: cs.backgroundColor,
      backdropFilter: cs.backdropFilter || cs.getPropertyValue('-webkit-backdrop-filter'),
      borderTopWidth: cs.borderTopWidth,
      borderTopColor: cs.borderTopColor,
      boxShadow: cs.boxShadow,
    };
  }, selector);
}

async function readRootTokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const root = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const n of names) out[n] = root.getPropertyValue(n).trim();
    return out;
  }, ROOT_TOKENS);
}

/** Record the computed chrome for a shot (and, when asked, the root tokens). */
async function dumpChrome(
  page: Page,
  name: string,
  selectors: string[],
  opts: { tokens?: boolean } = {},
): Promise<void> {
  const elements: ChromeEntry[] = [];
  for (const sel of selectors) elements.push(await readChrome(page, sel));
  const entry: ShotReport = { elements };
  if (opts.tokens) entry.tokens = await readRootTokens(page);
  report[name] = entry;
  console.log(`  [chrome] ${name}: ${JSON.stringify(entry)}`);
}

function writeReport(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${PREFIX}chrome.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  wrote ${PREFIX}chrome.json`);
}

async function applyTheme(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const bgApp = root.getPropertyValue('--bg-app').trim() || '#0e1116';
      const textBody = root.getPropertyValue('--text-body').trim() || '#bfd6e8';
      document.documentElement.style.backgroundColor = bgApp;
      document.body.style.backgroundColor = bgApp;
      document.body.style.color = textBody;
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Fresh profile: no story (the welcome empty state must sit behind shot 1). */
function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        onboardingComplete: true,
        theme: 'dark',
        notesTabUpgradeToastShown: true,
        gettingStartedDismissed: true,
        vaultUpgradePromptShown: true,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedNotes(notesVaultDir: string): void {
  for (const [rel, body] of SEED_NOTES) {
    const abs = path.join(notesVaultDir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

async function openKeyboardShortcuts(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Help' }).click();
  await page.getByRole('menuitem', { name: /keyboard shortcuts/i }).click();
  await expect(page.locator('.ksd-dialog')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(400);
}

/** Create + select a story the way a user does — nothing pre-seeded (§4c). */
async function createAndSelectStory(page: Page): Promise<void> {
  const rows = page.locator('.nav-story-row');
  const before = await rows.count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await expect(rows).toHaveCount(before + 1, { timeout: 15_000 });
  await page.locator('.nav-story-title').last().click();
  await page.waitForTimeout(600);
}

async function clipAround(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const padX = 60;
  const padY = 40;
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, box.width + padX * 2),
    height: Math.min(VIEWPORT.height - y, box.height + padY * 2),
  };
}

test('capture SKY-11491 overlay tier recipe + hairline token screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11491-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const vaultDir = path.join(tmpRoot, 'story-vault');
  const notesVaultDir = path.join(tmpRoot, 'notes-vault');
  seedUserData(userData, vaultDir, notesVaultDir);
  seedNotes(notesVaultDir);

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, MYTHOS_DISABLE_BOOT_MIGRATION: '1' },
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize(VIEWPORT);
    await applyTheme(page);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 30_000 });

    // 1. KeyboardShortcutsDialog over the welcome empty state. Before the fix
    //    the tier resolved to rgba(13,16,28,.25)/blur(1.25px) and the
    //    "Welcome to Mythos Writer" copy read straight through the dialog.
    await expect(page.getByText('Welcome to Mythos Writer').first()).toBeVisible({ timeout: 20_000 });
    await openKeyboardShortcuts(page);
    await shot(page, '1-keyboard-shortcuts');
    await dumpChrome(page, '1-keyboard-shortcuts', ['.ln-overlay-surface'], { tokens: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ksd-dialog')).toHaveCount(0);

    // 2. Same dialog under the app high-contrast toggle — opaque either way.
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
    await openKeyboardShortcuts(page);
    await shot(page, '2-keyboard-shortcuts-high-contrast');
    await dumpChrome(page, '2-keyboard-shortcuts-high-contrast', ['.ln-overlay-surface'], { tokens: true });
    await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
    await page.keyboard.press('Escape');
    await expect(page.locator('.ksd-dialog')).toHaveCount(0);

    // 3. Settings — the SKY-11133 control surface, on the tier since then.
    await page.locator('.app-menu-gear-btn').click();
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.settings-cat-nav__tab').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '3-settings');
    await dumpChrome(page, '3-settings', ['.settings-panel']);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toHaveCount(0);

    // 4. Scene Crafter panels — the hairline consumers (--bwh / --bh / --glowH).
    await createAndSelectStory(page);
    await clickStoryNav(page);
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await expect(page.locator('.sc-columns')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    await shot(page, '4-scene-crafter-panels');
    await dumpChrome(page, '4-scene-crafter-panels', ['.sc-panel', 'button.sc-sugg-card'], { tokens: true });

    // 5. The floating Boards zoom pill — the other overlay-tier consumer.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
    await expect(page.locator('.board-canvas__root')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(900);
    const zoom = page.locator('.board-canvas__zoom-controls');
    await expect(zoom).toBeVisible({ timeout: 10_000 });
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(OUT_DIR, `${PREFIX}5-boards-zoom-toolbar.png`),
      clip: await clipAround(page, '.board-canvas__zoom-controls'),
    });
    console.log(`  wrote ${PREFIX}5-boards-zoom-toolbar.png`);
    await shot(page, '5b-boards-canvas');
    await dumpChrome(page, '5-boards-zoom-toolbar', ['.board-canvas__zoom-controls']);
  } finally {
    writeReport();
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
