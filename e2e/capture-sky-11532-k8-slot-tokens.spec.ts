/**
 * capture-sky-11532-k8-slot-tokens.spec.ts — SKY-11532 PR evidence (NOT part of CI)
 *
 * The K8 high-contrast block in tokens.css ([data-contrast="high"]) flattened
 * the glass tokens (--glass-fill*, --blur-*) but never touched the v2 slot
 * tokens the theme engine writes inline on <html> (--b1..--b6, --g1..--g6,
 * --gs1..--gs6, --bh, --glowH, --bwh). Every consumer of those tokens kept a
 * tinted neon rim and glow under high contrast instead of the K8 contract's
 * "neon -> solid strokes, glows removed". This PR floors them to
 * var(--border-strong) / none / transparent in the K8 block (and its
 * prefers-contrast: more mirror), and retires the local .ln-overlay-surface
 * patch in overlay-tier.css that only existed to paper over the gap.
 *
 * Shot from a fresh profile (§4c) on both sides of the change so the
 * before/after compares 1:1:
 *
 *   1-keyboard-shortcuts-high-contrast   KeyboardShortcutsDialog (.ln-overlay-
 *                                        surface) at [data-contrast="high"] —
 *                                        before: tinted cyan rim + glow;
 *                                        after: solid white rim, no glow.
 *   2-scene-crafter-high-contrast        .sc-panel / .sc-sugg-card hairline
 *                                        chrome (--bh/--bwh/--glowH) at K8.
 *
 * Every shot also dumps the computed chrome + the root tokens, so the wiring
 * (not just the pixels) is on record. No value assertions: the same file runs
 * against the pre-change build.
 *
 * Modeled on e2e/capture-sky-11491-overlay-tier-recipe.spec.ts (same launch shape).
 *
 * Output: pr-screenshots/sky-11532-k8-slot-tokens/<SHOT_PREFIX><name>.png
 *         pr-screenshots/sky-11532-k8-slot-tokens/<SHOT_PREFIX>chrome.json
 *
 * Run (after `npm run build:electron`):
 *   SHOT_PREFIX=after- xvfb-run --auto-servernum npx playwright test \
 *     e2e/capture-sky-11532-k8-slot-tokens.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11532-k8-slot-tokens');
const PREFIX = process.env.SHOT_PREFIX ?? '';

const VIEWPORT = { width: 1440, height: 900 };

/** Slot tokens this PR floors at K8, plus the base pair for context. */
const ROOT_TOKENS: string[] = [
  '--b1', '--g1', '--gs1', '--bh', '--glowH', '--bwh',
  '--glass-fill-overlay', '--blur-panel-overlay',
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

/** Fresh profile (§4c): nothing pre-seeded. */
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

test('capture SKY-11532 K8 slot-token flatten screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11532-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const vaultDir = path.join(tmpRoot, 'story-vault');
  const notesVaultDir = path.join(tmpRoot, 'notes-vault');
  seedUserData(userData, vaultDir, notesVaultDir);

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

    // 1. KeyboardShortcutsDialog (.ln-overlay-surface) under the app
    //    high-contrast toggle. Before this PR the rim/glow read the untouched
    //    v2 slot tokens (tinted cyan); after, they read --border-strong / none.
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
    await openKeyboardShortcuts(page);
    await shot(page, '1-keyboard-shortcuts-high-contrast');
    await dumpChrome(page, '1-keyboard-shortcuts-high-contrast', ['.ln-overlay-surface'], { tokens: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('.ksd-dialog')).toHaveCount(0);

    // 2. Scene Crafter panels — the hairline consumers (--bh/--bwh/--glowH).
    await createAndSelectStory(page);
    await clickStoryNav(page);
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await expect(page.locator('.sc-columns')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(900);
    await shot(page, '2-scene-crafter-high-contrast');
    await dumpChrome(page, '2-scene-crafter-high-contrast', ['.sc-panel', 'button.sc-sugg-card'], { tokens: true });
  } finally {
    writeReport();
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
