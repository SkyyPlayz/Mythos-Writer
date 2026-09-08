/**
 * capture-sky-11477-overlay-tier-tokens.spec.ts — SKY-11477 PR evidence (NOT part of CI)
 *
 * SKY-11450 put the dialog/popover tier on `.ln-overlay-surface`. Two floating
 * surfaces kept hand-rolling the mockup chrome as frozen literals — this shoots
 * both from a fresh profile (§4c) on each side of the change, and dumps the
 * computed fill/blur/shadow so the *wiring* (not just the pixels) is on record:
 *
 *   1-settings          Settings panel — the control. Untouched by this PR.
 *   2-drafts-popover    DraftsPopover, reached through the "Draft N ▾" pill.
 *   3-calendar-editor   CalendarEditorModal — the `.t2m-card--purple` variant.
 *   4-exact-time        ExactTimeModal — the `.t2m-card--cyan` variant.
 *   5-exact-time-hc     Same card at [data-contrast="high"]. Before this PR the
 *                       t2m cards had no high-contrast path at all; joining the
 *                       tier gives them the shared opaque degrade.
 *
 * Modeled on e2e/capture-sky-11450-overlay-tier.spec.ts (same launch shape).
 *
 * Output: pr-screenshots/sky-11477-overlay-tier-tokens/<SHOT_PREFIX><name>.png
 *
 * Run (after `npm run build:electron`):
 *   SHOT_PREFIX=after- xvfb-run -a npx playwright test \
 *     e2e/capture-sky-11477-overlay-tier-tokens.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11477-overlay-tier-tokens');
const PREFIX = process.env.SHOT_PREFIX ?? '';

const STORY_ID = 'story-sky11477';
const CHAPTER_ID = 'chapter-sky11477';
const STORY_TITLE = 'Overlay Tier Tokens';
const CHAPTER_TITLE = 'Chapter One';
const SCENE = { id: 'sc-sky11477-1', title: 'The Gate' };

test.setTimeout(240_000);

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}${name}.png`) });
  console.log(`  wrote ${PREFIX}${name}.png`);
}

/** The point of the ticket: is the chrome wired to the tier tokens, or frozen? */
async function dumpChrome(page: Page, label: string, selector: string) {
  const chrome = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    return {
      background: cs.backgroundColor,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      boxShadow: cs.boxShadow,
      borderTop: cs.borderTopColor,
      tokenFill: root.getPropertyValue('--glass-fill-overlay').trim(),
      tokenBlur: root.getPropertyValue('--blur-panel-overlay').trim(),
    };
  }, selector);
  console.log(`  [chrome] ${label}: ${JSON.stringify(chrome)}`);
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

/** One story / chapter / scene, plus a timeline with an event to inspect.
 *  Nothing here is a surface under test — the popover and both modals are
 *  reached by clicking through the app (§4c). */
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
        activeTimelineId: 'tl-sky11477',
        timelines: [
          {
            id: 'tl-sky11477',
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
            timelineId: 'tl-sky11477',
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

async function activateStorySection(pg: Page): Promise<void> {
  const nav = pg.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if ((await storyNavBtn.getAttribute('aria-current')) !== 'page') {
    await storyNavBtn.click();
  }
  const backdrop = pg.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

test('capture SKY-11477 overlay-tier token screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11477-shots-'));
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

    // 1. Settings — the control. Already on the overlay tier before this PR.
    await page.locator('.app-menu-gear-btn').click();
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.settings-cat-nav__tab').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '1-settings');
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toHaveCount(0);

    // 2. DraftsPopover — open the scene editor, then the "Draft N ▾" pill.
    const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE.title }).first();
    await expect(sceneRow).toBeVisible({ timeout: 15_000 });
    await sceneRow.click();
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('scene-drafts-pill').click();
    const popover = page.getByTestId('ln-drafts-popover');
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await dumpChrome(page, 'drafts-popover', '[data-testid="ln-drafts-popover"]');
    await shot(page, '2-drafts-popover');
    await page.keyboard.press('Escape');

    // 3. CalendarEditorModal — the purple t2m card.
    await activateStorySection(page);
    const timelineBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
    await expect(timelineBtn).toBeVisible({ timeout: 10_000 });
    await timelineBtn.click();
    await expect(page.getByTestId('timeline-root')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('timeline-picker').click();
    await page.getByTestId('timeline-edit-calendar').click();
    const calendarCard = page.getByTestId('calendar-editor-modal');
    await expect(calendarCard).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await dumpChrome(page, 'calendar-editor (t2m-card--purple)', '[data-testid="calendar-editor-modal"]');
    await shot(page, '3-calendar-editor');
    await page.getByTestId('cem-close').click();
    await expect(calendarCard).toHaveCount(0);

    // 4. ExactTimeModal — the cyan t2m card, via the Inspector.
    await page.locator('[data-testid="view-mode-progress"]').click();
    await page.getByTestId('ax-event-ev-watcher').click();
    await expect(page.getByTestId('trp-tab-inspector')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    // The Inspector opens read-only; the pencil switches it to the edit form
    // that carries the DATE / TIME button.
    await page.getByTestId('trp-event-pencil').click();
    await page.getByTestId('trp-event-datetime').click();
    const exactCard = page.getByTestId('exact-time-modal');
    await expect(exactCard).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await dumpChrome(page, 'exact-time (t2m-card--cyan)', '[data-testid="exact-time-modal"]');
    await shot(page, '4-exact-time');

    // 5. Same card under the app high-contrast toggle.
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
    await page.waitForTimeout(400);
    await dumpChrome(page, 'exact-time @ high-contrast', '[data-testid="exact-time-modal"]');
    await shot(page, '5-exact-time-hc');
    await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
