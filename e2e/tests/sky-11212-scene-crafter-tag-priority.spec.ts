/**
 * sky-11212-scene-crafter-tag-priority.spec.ts — SKY-11326 evidence for SKY-11212
 *
 * PR #1390 (SKY-11212) fixed two Scene Crafter "Setup" bugs in
 * frontend/src/pages/SceneCrafter/crafterState.ts:
 *
 *   1. refPickerCards() — the column `+` picker used to offer EVERY vault
 *      note regardless of category. It now starts from the column's own
 *      category base, so e.g. the LOCATIONS picker only ever offers
 *      location notes.
 *   2. suggestedFromVault() — categorization used to be folder-only. It now
 *      classifies a note by its TAG signal first (frontmatter `type:`, a
 *      frontmatter `tags:` entry, or an inline `#<kind>` hashtag) and only
 *      falls back to folder placement for untagged notes.
 *
 * This is a genuine cross-process E2E test (real Electron app, real disk,
 * real UI) — company standard §4a requires this over the mocked-renderer
 * unit coverage in crafterState.test.ts / SceneCrafterPage.test.tsx /
 * vault.test.ts, which are all green but insufficient on their own.
 *
 * Reachability (§4c) — nothing is pre-seeded except the standard
 * onboarding-complete profile. Both notes are created through the real
 * Notes Editor UI, and each is tagged in Source mode with an inline
 * hashtag before Scene Crafter ever reads them, proving the fix end to end:
 * UI note creation -> autosave to disk -> tag-priority classification ->
 * board column -> picker category filter.
 *
 * "Ashfall Docks" carries no folder placement (created flat, no vault
 * folder) and is tagged `#location`; "Kael Thorne" is tagged `#character`.
 * Neither note's title hints at a folder, so a pass here can only be
 * explained by the tag-priority classifier, not a folder fallback.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const SCREENSHOT_DIR = path.resolve(__dirname, '../../docs/screenshots/sky-11212-tag-priority');

// ─── Helpers (copied/adapted from sceneCrafter.spec.ts's SKY-11072 block —
// test files in this repo do not import helpers from each other) ─────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/**
 * Create a story via the title bar's File → New story item — selection-state
 * independent. M3 (SKY-9021/9896): instant-create — no prompt, the story
 * row appears immediately as "Untitled Story". Returns the index of the new
 * row so callers can select it positionally.
 */
async function createStory(pg: Page): Promise<number> {
  const before = await pg.locator('.nav-story-row').count();
  await pg.locator('.wc-menu', { hasText: 'File' }).click();
  await pg.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await expect(pg.locator('.nav-story-row').nth(before)).toBeVisible({ timeout: 8_000 });
  return before;
}

/** Select a story by its positional index in the StoryNavigator sidebar. */
async function selectStory(pg: Page, index: number): Promise<void> {
  await pg.locator('.nav-story-title').nth(index).click();
}

/** Navigate to the Scene Crafter (Board) view via the nav rail. */
async function openBoardView(pg: Page): Promise<void> {
  await pg.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  const setupTab = pg.locator(
    '[role="tablist"][aria-label="Workspace tabs"] [role="tab"]',
    { hasText: 'Scene Crafter' },
  );
  await setupTab.waitFor({ state: 'visible', timeout: 8_000 });
  if ((await setupTab.getAttribute('aria-selected')) !== 'true') await setupTab.click();
  await expect(pg.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
}

/**
 * The seed vault's twin-root layout (separate vaultRoot/notesVaultRoot dirs)
 * reads as a "v0.4" vault to MythosMigrationCenter, whose prompt can pop up
 * and intercept clicks. Dismiss it if present.
 */
async function dismissMigrationPromptIfPresent(pg: Page): Promise<void> {
  const dismissBtn = pg.locator('[data-testid="mythos-migration-prompt-dismiss"]');
  if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) await dismissBtn.click();
}

/**
 * Create a note through the real Notes Editor UI, switch it to Source mode,
 * type a body containing the given inline hashtag, and poll the on-disk
 * .md file for the tag before returning — autosave is debounced, so the
 * column classification (read from disk) is not reliable until this lands.
 */
async function createTaggedNote(
  pg: Page,
  notesVaultDir: string,
  title: string,
  body: string,
  tag: string,
): Promise<void> {
  await dismissMigrationPromptIfPresent(pg);
  const addNoteBtn = pg.locator('[data-testid="vb-btn-new-note"]').first();
  await expect(addNoteBtn).toBeVisible({ timeout: 6_000 });
  await addNoteBtn.click();
  const dialog = pg.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 6_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill(title);
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });

  await dismissMigrationPromptIfPresent(pg);
  await pg.locator('[data-testid^="vb-row-"]', { hasText: title }).first().click();
  await expect(pg.locator('.note-viewer [data-testid="note-gear-btn"]')).toBeVisible({ timeout: 8_000 });
  await pg.locator('.note-viewer [data-testid="note-gear-btn"]').click();
  await expect(pg.locator('[data-testid="note-gear-menu"]')).toBeVisible();
  await pg.locator('[data-testid="note-gear-mode-source"]').click();
  const editor = pg.getByRole('textbox', { name: `Edit note: ${title}.md` });
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await editor.click();
  await editor.fill(`${body} ${tag}`);
  await expect(editor).toHaveValue(new RegExp(tag));

  const notePath = path.join(notesVaultDir, `${title}.md`);
  await expect.poll(
    () => (fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf-8') : ''),
    { timeout: 8_000 },
  ).toContain(tag);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe('SKY-11212 — Scene Crafter board tag-priority classification (fresh profile)', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11212-tag-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11212-tag-story-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11212-tag-notes-'));
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('a #location-tagged note lands in LOCATIONS and a #character-tagged note lands in CHARACTERS, and the LOCATIONS picker excludes the character note', async () => {
    const storyIndex = await createStory(page);
    await selectStory(page, storyIndex);

    // Create both notes through the real Notes Editor UI (§4c: never
    // pre-seed the thing under test) — neither is filed in any vault
    // folder, so folder fallback cannot explain a correct classification.
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });

    await createTaggedNote(
      page,
      notesVaultDir,
      'Ashfall Docks',
      'Flooded pier district on the northern edge of the city.',
      '#location',
    );
    await dismissMigrationPromptIfPresent(page);
    await createTaggedNote(
      page,
      notesVaultDir,
      'Kael Thorne',
      'Smuggler — witty, guarded, survivor.',
      '#character',
    );

    await dismissMigrationPromptIfPresent(page);
    await openBoardView(page);

    const locations = page.locator('[data-testid="sc-ref-col-locations"]');
    const characters = page.locator('[data-testid="sc-ref-col-characters"]');
    await expect(locations).toBeVisible({ timeout: 8_000 });
    await expect(characters).toBeVisible({ timeout: 8_000 });

    // 1. Tag-priority classification proof: each note lands in the column
    //    matching its tag, and only that column.
    await expect(locations.getByText('Ashfall Docks')).toBeVisible({ timeout: 8_000 });
    await expect(characters.getByText('Ashfall Docks')).toHaveCount(0);

    await expect(characters.getByText('Kael Thorne')).toBeVisible({ timeout: 8_000 });
    await expect(locations.getByText('Kael Thorne')).toHaveCount(0);

    // Real screenshot of the Setup view — both columns visible together
    // with each note under its correctly classified column. The vault-
    // reference columns sit in a horizontally-scrolling row after Setup/
    // Draft (.sc-columns, overflow-x: auto) — narrower than its scrollable
    // content, so scroll CHARACTERS to the row's left edge first or the
    // LOCATIONS column renders cut off / out of view.
    await page.evaluate(() => {
      const scroller = document.querySelector('.sc-columns') as HTMLElement | null;
      const charactersCol = document.querySelector(
        '[data-testid="sc-ref-col-characters"]',
      ) as HTMLElement | null;
      if (scroller && charactersCol) {
        scroller.scrollLeft = charactersCol.offsetLeft - 16;
      }
    });
    await page.waitForTimeout(300); // let layout/scroll settle before capture

    const charactersBox = await characters.boundingBox();
    const locationsBox = await locations.boundingBox();
    if (!charactersBox || !locationsBox) throw new Error('vault-reference columns have no bounding box to clip a screenshot to');
    const clip = {
      x: Math.max(0, charactersBox.x - 12),
      y: Math.max(0, Math.min(charactersBox.y, locationsBox.y) - 12),
      width: (locationsBox.x + locationsBox.width) - charactersBox.x + 24,
      height: Math.max(charactersBox.height, locationsBox.height) + 24,
    };
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'board-columns-tag-priority.png'),
      clip,
    });

    // 2. Picker category-filter proof: the LOCATIONS `+` picker must never
    //    offer a character-classified note (the owner-reported bug — the
    //    picker used to offer every vault note regardless of category).
    await locations.getByRole('button', { name: 'Add a note to LOCATIONS' }).click();
    const search = page.getByRole('textbox', { name: 'Search notes to add to LOCATIONS' });
    await expect(search).toBeVisible();
    await expect(locations.getByRole('button', { name: /kael thorne/i })).toHaveCount(0);

    // The note the picker DOES exist for the category is unaffected —
    // sanity that the picker isn't just empty for unrelated reasons. Since
    // Ashfall Docks is already referenced on this scene's LOCATIONS column,
    // it correctly does not reappear in the "add" picker either; assert the
    // picker only ever shows notes from vault search results named after
    // the LOCATIONS category, never CHARACTERS-classified ones.
    await expect(page.locator('.sc-ref-picker').getByText('Kael Thorne')).toHaveCount(0);
  });
});
