/**
 * capture-sky-11504-hairline-tokens.spec.ts — SKY-11504 / SKY-11482 PR evidence
 * (NOT part of CI)
 *
 * Five surfaces want the mockup's hairline tier — `--bwh` / `--bh` / `--glowH`.
 * The engine emitted none of them, so four of the five froze on the literal
 * fallback `rgba(0, 240, 255, .2)` and the fifth (Scene Crafter) ran on PR
 * #1465's local `--sc-*` approximation. This PR emits the four tokens from
 * liquidNeonEngine.ts and deletes the approximation.
 *
 * This spec proves the fix the only way that counts: it drives the real app,
 * reads the *computed* border colour of each rim, changes the accent through
 * Settings → Appearance the way a user would, and reads them again.
 *
 * Two assertions, and the second is the one the ticket is actually about:
 *   1. the rim colour changes with the accent — it is not a frozen literal;
 *   2. the rim colour equals the engine's live `--bh` — it is the mockup's
 *      value, not an approximation of it. PR #1465's `color-mix(--b1 50%)`
 *      halved an already-saturated `--b1` and landed on alpha .500 where the
 *      mockup halves .3+.4I first and lands on .550; that gap is exactly what
 *      assertion 2 catches and assertion 1 alone would not.
 *
 *   1-export-dialog     .export-scope-seg      — File ▸ Export…
 *   2-timeline-axis     .ax-zoom-seg           — Timeline toolbar
 *   3-timeline-panel    .trp-tabs              — Timeline right panel tab strip
 *   4-brainstorm-board  .bs-collections-search — Brainstorm ▸ Idea Collections
 *   5-scene-crafter     .sc-panel              — Scene Crafter Setup/Draft panels
 *
 * Modeled on e2e/capture-sky-11477-overlay-tier-tokens.spec.ts (same launch shape).
 *
 * Output: pr-screenshots/sky-11504-hairline-tokens/<classic|ember>-<name>.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test \
 *     e2e/capture-sky-11504-hairline-tokens.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11504-hairline-tokens');

const STORY_ID = 'story-sky11504';
const CHAPTER_ID = 'chapter-sky11504';
const STORY_TITLE = 'Hairline Tokens';
const CHAPTER_TITLE = 'Chapter One';
const SCENE = { id: 'sc-sky11504-1', title: 'The Gate' };

/** The five rims this ticket fixes, in the order they are visited. */
const RIMS = [
  { name: '1-export-dialog', selector: '.export-scope-seg' },
  { name: '2-timeline-axis', selector: '.ax-zoom-seg' },
  { name: '3-timeline-panel', selector: '.trp-tabs' },
  { name: '4-brainstorm-board', selector: '.bs-collections-search' },
  { name: '5-scene-crafter', selector: '.sc-panel' },
] as const;

test.setTimeout(300_000);

async function shot(page: Page, theme: string, name: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${theme}-${name}.png`) });
  console.log(`  wrote ${theme}-${name}.png`);
}

interface Rim {
  /** The rim's own computed border colour. */
  borderColor: string;
  borderWidth: string;
  /** The same colour the engine stamped on :root, resolved through the browser. */
  bh: string;
  bwh: string;
}

/**
 * Read a rim and, alongside it, the engine's live `--bh`/`--bwh` resolved by
 * the same engine. Both go through a throwaway probe element so the browser
 * normalises them into the identical colour syntax the rim reports — comparing
 * the raw custom-property string to a computed `borderTopColor` would fail on
 * formatting alone.
 */
async function readRim(page: Page, selector: string): Promise<Rim> {
  const rim = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;border-style:solid;'
      + 'border-color:var(--bh);border-width:var(--bwh)';
    document.body.appendChild(probe);
    const probed = getComputedStyle(probe);
    const out = {
      borderColor: getComputedStyle(el).borderTopColor,
      borderWidth: getComputedStyle(el).borderTopWidth,
      bh: probed.borderTopColor,
      bwh: probed.borderTopWidth,
    };
    probe.remove();
    return out;
  }, selector);
  expect(rim, `${selector} was not in the DOM`).not.toBeNull();
  console.log(`  [rim] ${selector}: ${JSON.stringify(rim)}`);
  expect(
    rim!.borderColor,
    `${selector} does not paint the engine's --bh. It is either still frozen on a `
      + 'literal fallback or running on a local approximation of the hairline tier '
      + '(PR #1465 shipped one that resolved half an alpha-clamped --b1). The rim '
      + 'must resolve the token the engine stamps.',
  ).toBe(rim!.bh);
  return rim!;
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** One story / chapter / scene, plus a timeline with an event. Nothing here is
 *  a surface under test — all four rims are reached by clicking through the
 *  app (§4c), and none of them is pre-seeded into a particular state. */
function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: `stories/${STORY_ID}`,
        chapters: [
          {
            id: CHAPTER_ID,
            title: CHAPTER_TITLE,
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            scenes: [
              {
                id: SCENE.id,
                title: SCENE.title,
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE.id}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
    smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const scenePath = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${SCENE.id}.md`);
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  fs.writeFileSync(
    scenePath,
    `---\nid: ${SCENE.id}\ntitle: ${SCENE.title}\nchapterId: ${CHAPTER_ID}\nstoryId: ${STORY_ID}\nupdatedAt: ${now}\n---\n\nThe lantern flickered once, casting long shadows across the stone floor.\n`,
  );

  fs.writeFileSync(
    path.join(vaultDir, 'timelines.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        activeTimelineId: 'tl-sky11504',
        timelines: [
          {
            id: 'tl-sky11504',
            name: 'The Last City of Veynn',
            kind: 'story',
            axis: 'calendar',
            calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
            createdAt: now,
            updatedAt: now,
          },
        ],
        eras: [],
        spans: [],
        rows: [],
        events: [
          {
            id: 'ev-watcher',
            timelineId: 'tl-sky11504',
            name: 'The Watcher Calls',
            when: 100,
            chapter: 1,
            summary: 'A summons at dawn.',
          },
        ],
      },
      null,
      2,
    ),
  );
}

async function activateStorySection(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if ((await storyNavBtn.getAttribute('aria-current')) !== 'page') {
    await storyNavBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

/**
 * Walk all five rims and record each computed border, screenshotting as it
 * goes. Every surface is opened and closed again so the walk is repeatable
 * against a changed theme without relaunching.
 */
async function walkRims(page: Page, theme: string): Promise<Record<string, string>> {
  const colors: Record<string, string> = {};
  console.log(`\n── ${theme} ──`);

  // 1. Export dialog — File ▸ Export…. That item only opens the dialog when a
  // story is selected (otherwise it toasts), and the scope segment only renders
  // for a story-scoped open — so click into the scene first.
  await activateStorySection(page);
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE.title }).first();
  await expect(sceneRow).toBeVisible({ timeout: 15_000 });
  await sceneRow.click();
  await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wc-menu-file').click();
  await page.locator('.wc-menu-item', { hasText: 'Export…' }).first().click();
  const exportSeg = page.locator('.export-scope-seg');
  await expect(exportSeg).toBeVisible({ timeout: 10_000 });
  colors['1-export-dialog'] = (await readRim(page, '.export-scope-seg')).borderColor;
  await shot(page, theme, '1-export-dialog');
  await page.locator('.export-dialog-close').click();
  await expect(exportSeg).toHaveCount(0);

  // 2 + 3. Timeline axis toolbar and right-panel tab strip.
  const timelineBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 10_000 });
  await timelineBtn.click();
  await expect(page.getByTestId('timeline-root')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.ax-zoom-seg')).toBeVisible({ timeout: 10_000 });
  colors['2-timeline-axis'] = (await readRim(page, '.ax-zoom-seg')).borderColor;
  await shot(page, theme, '2-timeline-axis');

  await expect(page.locator('.trp-tabs')).toBeVisible({ timeout: 10_000 });
  colors['3-timeline-panel'] = (await readRim(page, '.trp-tabs')).borderColor;
  await shot(page, theme, '3-timeline-panel');

  // 4. Brainstorm ▸ Idea Collections search pill (Ctrl+3 is the supported route).
  await page.keyboard.press('Control+3');
  await expect(page.locator('#app-tabpanel-brainstorm')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.bs-collections-search')).toBeVisible({ timeout: 10_000 });
  colors['4-brainstorm-board'] = (await readRim(page, '.bs-collections-search')).borderColor;
  await shot(page, theme, '4-brainstorm-board');

  // 5. Scene Crafter Setup/Draft panels — the surface PR #1465 wired to the
  // local --sc-* approximation this PR deletes.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await expect(page.locator('.sc-panel').first()).toBeVisible({ timeout: 15_000 });
  colors['5-scene-crafter'] = (await readRim(page, '.sc-panel')).borderColor;
  await shot(page, theme, '5-scene-crafter');

  return colors;
}

/** Change the accent the way a user does: Settings → Appearance → a preset card. */
async function switchThemePreset(page: Page, presetKey: string): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('.settings-cat-nav [role="tab"]', { hasText: 'Appearance' }).first().click();
  const preset = page.getByTestId(`lnas-preset-${presetKey}`);
  await expect(preset).toBeVisible({ timeout: 10_000 });
  await preset.click();
  await expect(preset).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('SKY-11504 — all five hairline rims paint the engine\'s --bh and repaint with the accent', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11504-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const vaultDir = path.join(tmpRoot, 'vault');
  const notesVaultDir = path.join(tmpRoot, 'notes-vault');
  fs.mkdirSync(notesVaultDir, { recursive: true });
  seedVault(vaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 30_000 });

    const before = await walkRims(page, 'classic');

    // Ember is the furthest slot-1 hue from the classic cyan, so a rim that
    // stayed cyan is unmistakable in the paired screenshots.
    await switchThemePreset(page, 'ember');

    const after = await walkRims(page, 'ember');

    for (const { name, selector } of RIMS) {
      expect(
        after[name],
        `${selector} painted the same border colour (${before[name]}) before and after the accent `
          + 'changed to Ember. That rim is still reading a custom property nothing defines, so it is '
          + 'frozen on its literal fallback rather than wired to the theme engine.',
      ).not.toBe(before[name]);
    }
    console.log(`\nall five rims repainted:\n${JSON.stringify({ before, after }, null, 2)}`);
  } finally {
    await app.close();
  }
});
