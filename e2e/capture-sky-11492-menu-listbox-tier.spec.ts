/**
 * capture-sky-11492-menu-listbox-tier.spec.ts — SKY-11492 PR evidence (NOT part of CI)
 *
 * The two shared popup primitives — `.ln-menu` (ui/Menu) and
 * `.ln-select-listbox` (ui/DropdownSelect) — painted a flat `--bg-elevated`
 * fill with a neutral white hairline and a depth-only shadow: entirely off
 * the Liquid Neon overlay tier every dialog has been on since SKY-11450.
 * This PR puts both on `.ln-overlay-surface`, so every consumer of either
 * primitive is corrected by the one class.
 *
 * Shot from a fresh profile (§4c) on both sides of the change so the
 * before/after compares 1:1:
 *
 *   1-story-navigator-menu      StoryNavigator context menu (`.ln-menu`) over
 *                               the manuscript — the highest-traffic consumer.
 *   2-notes-tree-context-menu   VaultBrowser notes-tree menu (`.ln-menu.vb-ctx-menu`)
 *                               — the CONTROL: it hand-rolled the mockup recipe
 *                               already, so nothing about it may move.
 *   3-nav-rail-vault-menu       AppNavRail vault-tile menu — a third `.ln-menu`
 *                               consumer, opened over the rail.
 *   4-continuity-scope-listbox  ContinuityPanel scan-scope picker — the only
 *                               `.ln-select-listbox` consumer.
 *   5-story-navigator-menu-high-contrast
 *                               Shot 1 again under [data-contrast="high"] —
 *                               the tier must flatten to opaque, no glow.
 *
 * Every shot also dumps the computed chrome of the popup next to the computed
 * chrome of a reference `.ln-overlay-surface` probe, so "on the tier" is a
 * measured equality, not a visual impression. (Menus and dropdowns keep the
 * mockup's depth-only shadow — the probe's glow layer is the one expected
 * difference.) No value assertions: the same file runs against the
 * pre-change build.
 *
 * Modeled on e2e/capture-sky-11491-overlay-tier-recipe.spec.ts.
 *
 * Output: pr-screenshots/sky-11492-menu-listbox-tier/<SHOT_PREFIX><name>.png
 *         pr-screenshots/sky-11492-menu-listbox-tier/<SHOT_PREFIX>chrome.json
 *
 * Run (after `npm run build:electron`):
 *   SHOT_PREFIX=after- xvfb-run --auto-servernum npx playwright test \
 *     e2e/capture-sky-11492-menu-listbox-tier.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11492-menu-listbox-tier');
const PREFIX = process.env.SHOT_PREFIX ?? '';

const VIEWPORT = { width: 1440, height: 900 };
const NOW = '2026-06-17T00:00:00.000Z';

/** The tier tokens + the slot pair the tier's border and glow read. */
const ROOT_TOKENS: string[] = [
  '--glass-fill-overlay',
  '--blur-panel-overlay',
  '--bw',
  '--b1',
  '--g1',
  '--bg-elevated',
  '--border-default',
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
  borderRadius?: string;
  note?: string;
}

interface ShotReport {
  elements: ChromeEntry[];
  /** Computed chrome of a throwaway `.ln-overlay-surface` div — the target. */
  tierReference: ChromeEntry;
  tokens?: Record<string, string>;
}

const report: Record<string, ShotReport> = {};

async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}${name}.png`), clip });
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
      borderRadius: cs.borderTopLeftRadius,
    };
  }, selector);
}

/** Mount a bare `.ln-overlay-surface` probe, read it, remove it. */
async function readTierReference(page: Page): Promise<ChromeEntry> {
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'ln-overlay-surface';
    probe.id = 'sky11492-tier-probe';
    probe.style.position = 'fixed';
    probe.style.left = '-9999px';
    document.body.appendChild(probe);
  });
  const entry = await readChrome(page, '#sky11492-tier-probe');
  await page.evaluate(() => document.getElementById('sky11492-tier-probe')?.remove());
  return { ...entry, selector: '.ln-overlay-surface (probe)' };
}

async function readRootTokens(page: Page): Promise<Record<string, string>> {
  return page.evaluate((names) => {
    const root = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const n of names) out[n] = root.getPropertyValue(n).trim();
    return out;
  }, ROOT_TOKENS);
}

async function dumpChrome(page: Page, name: string, selectors: string[], opts: { tokens?: boolean } = {}): Promise<void> {
  const elements: ChromeEntry[] = [];
  for (const sel of selectors) elements.push(await readChrome(page, sel));
  const entry: ShotReport = { elements, tierReference: await readTierReference(page) };
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

async function clipAround(page: Page, selector: string, padX = 80, padY = 60): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, box.width + padX * 2),
    height: Math.min(VIEWPORT.height - y, box.height + padY * 2),
  };
}

/** One story with a chapter + scene (navigator rows to right-click) and a notes folder (tree row to right-click). */
function seedProject(userData: string, storyVaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: '',
        onboardingComplete: true,
        notesTabUpgradeToastShown: true,
        gettingStartedDismissed: true,
        vaultUpgradePromptShown: true,
        theme: 'dark',
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
  const scene = {
    id: 'scene-1',
    title: 'Opening Scene',
    path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
    order: 1,
    blocks: [{ id: 'block-1', type: 'prose', content: 'Meet Elara.', order: 1, updatedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const chapter = {
    id: 'chapter-1',
    title: 'Chapter One',
    path: 'Test Story/Manuscript/Chapter One',
    order: 1,
    scenes: [scene],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const story = { id: 'story-1', title: 'Test Story', path: 'Test Story', chapters: [chapter], createdAt: NOW, updatedAt: NOW };
  fs.writeFileSync(
    path.join(storyVaultDir, 'manifest.json'),
    JSON.stringify(
      { version: '1.0.0', vaultRoot: storyVaultDir, stories: [story], chapters: [chapter], scenes: [scene], entities: [], suggestions: [] },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(storyVaultDir, scene.path), 'Meet Elara.');
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Elara.md'), '# Elara\n\nShe reads the tide charts like other people read faces.\n');
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

/** Story Writer with the seeded story selected — the navigator shows its rows. */
async function openStoryWriter(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await nav.locator('button[aria-label="Story Writer"]').click();
  const storyPick = page.locator('[data-testid="nav-rail-story-story-1"]');
  if (await storyPick.count()) await storyPick.click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function openStoryNavigatorMenu(page: Page): Promise<void> {
  await page.locator('.nav-story-row').first().click({ button: 'right' });
  await expect(page.locator('[data-testid="story-navigator-context-menu"]')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(350);
}

/** Escape when the menu holds focus; otherwise the outside-mousedown dismissal. */
async function closeMenu(page: Page, testId: string): Promise<void> {
  const menu = page.locator(`[data-testid="${testId}"]`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  if (await menu.count()) await page.mouse.click(VIEWPORT.width - 4, VIEWPORT.height - 4);
  await expect(menu).toHaveCount(0);
  await page.waitForTimeout(200);
}

test('capture SKY-11492 .ln-menu / .ln-select-listbox overlay-tier screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11492-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const storyVaultDir = path.join(tmpRoot, 'story-vault');
  const notesVaultDir = path.join(tmpRoot, 'notes-vault');
  fs.mkdirSync(userData, { recursive: true });
  seedProject(userData, storyVaultDir, notesVaultDir);

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
    await page.waitForTimeout(1000);

    // 1. StoryNavigator context menu — `.ln-menu` over the manuscript.
    await openStoryWriter(page);
    await openStoryNavigatorMenu(page);
    await shot(page, '1-story-navigator-menu');
    await shot(page, '1b-story-navigator-menu-detail', await clipAround(page, '[data-testid="story-navigator-context-menu"]'));
    await dumpChrome(page, '1-story-navigator-menu', ['[data-testid="story-navigator-context-menu"]'], { tokens: true });
    await closeMenu(page, 'story-navigator-context-menu');

    // 2. Notes-tree context menu — the control (`.ln-menu.vb-ctx-menu` already
    //    hand-rolled the mockup recipe; nothing about it may move).
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    const notesRow = page.locator('[data-testid="vb-row-Characters"]');
    await expect(notesRow).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await notesRow.click({ button: 'right' });
    await expect(page.locator('[data-testid="vb-context-menu"]')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(350);
    await shot(page, '2-notes-tree-context-menu', await clipAround(page, '[data-testid="vb-context-menu"]'));
    await dumpChrome(page, '2-notes-tree-context-menu', ['[data-testid="vb-context-menu"]']);
    await closeMenu(page, 'vb-context-menu');

    // 3. Nav-rail vault-tile menu — `.ln-menu` opened over the rail.
    const tile = page.locator('.nav-rail__vault-tile').first();
    await expect(tile).toBeVisible({ timeout: 10_000 });
    await tile.click({ button: 'right' });
    await expect(page.locator('[data-testid="nav-rail-vault-menu"]')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(350);
    await shot(page, '3-nav-rail-vault-menu', await clipAround(page, '[data-testid="nav-rail-vault-menu"]'));
    await dumpChrome(page, '3-nav-rail-vault-menu', ['[data-testid="nav-rail-vault-menu"]']);
    await closeMenu(page, 'nav-rail-vault-menu');

    // 4. Continuity scan-scope picker — `.ln-select-listbox`.
    await openStoryWriter(page);
    const sidebar = page.getByTestId('global-right-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 12_000 });
    const picker = sidebar.getByRole('combobox', { name: /scan scope/i });
    await expect(picker).toBeVisible({ timeout: 12_000 });
    await picker.click();
    await expect(page.locator('[data-testid="ln-select-listbox"]')).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(350);
    await shot(page, '4-continuity-scope-listbox', await clipAround(page, '[data-testid="ln-select-listbox"]', 120, 90));
    await dumpChrome(page, '4-continuity-scope-listbox', ['[data-testid="ln-select-listbox"]']);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="ln-select-listbox"]')).toHaveCount(0);

    // 5. Shot 1 under the app high-contrast toggle — opaque, no glow.
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
    await page.waitForTimeout(300);
    await openStoryNavigatorMenu(page);
    await shot(page, '5-story-navigator-menu-high-contrast', await clipAround(page, '[data-testid="story-navigator-context-menu"]'));
    await dumpChrome(page, '5-story-navigator-menu-high-contrast', ['[data-testid="story-navigator-context-menu"]'], { tokens: true });
    await closeMenu(page, 'story-navigator-context-menu');
    await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
  } finally {
    writeReport();
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
