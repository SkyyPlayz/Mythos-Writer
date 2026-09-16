/**
 * sky-11615-timeline-wikilinks.spec.ts — SKY-11615 (build for SKY-11594)
 *
 * Real end-to-end coverage for `[[wiki links]]` in Timeline event prose:
 * renderer -> shared resolver -> the live vault indexes -> navigation into
 * four different destinations, plus the Obsidian-parity create-on-unresolved
 * write that has to actually land on disk. Nothing is stubbed.
 *
 * §4c reachability: the feature under test is the LINKS, and every one of
 * them is typed by hand into the Inspector's SUMMARY field through the same
 * clicks a user makes. Only the background the links point at (a story with a
 * chapter and a scene, a note, a folder) and the event to hang the summary on
 * are seeded.
 *
 *   TC-TWL-01  Typing a description with all five link forms renders each one
 *              with its documented kind, on the event card and in the event
 *              detail summary; the unresolved one renders visibly.
 *   TC-TWL-02  The card carries the reference badges and the mixed-accent ring.
 *   TC-TWL-03  A note link (clicked on the card) opens the note.
 *   TC-TWL-04  A scene link opens the scene in the manuscript.
 *   TC-TWL-05  A chapter link opens the manuscript at chapter depth.
 *   TC-TWL-06  A folder link opens the Boards view on that folder.
 *   TC-TWL-07  An unresolved link creates the note in the Notes Vault (on
 *              disk) and opens it.
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

const STORY_ID = 'story-timeline-wikilinks-e2e';
const CHAPTER_ID = 'chapter-timeline-wikilinks-e2e';
const SCENE_ID = 'sc-twl-opening';
const STORY_TITLE = 'The Last City of Veynn';
const CHAPTER_TITLE = 'Chapter One';
const SCENE_TITLE = 'Opening Scene';

const EVENT_ID = 'ev-twl-1';
const TIMELINE_ID = 'tl-twl';

const NOTE_NAME = 'The Drowned Gate';
const FOLDER_NAME = 'Relics';
const UNRESOLVED_NAME = 'Ghost Note';

/** Every supported link form in one description, one of each resolved kind. */
const SUMMARY = `Mira meets [[${NOTE_NAME}]] at [[${SCENE_TITLE}]] in [[${CHAPTER_TITLE}]] over [[${FOLDER_NAME}]] and [[${UNRESOLVED_NAME}]].`;

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const agent = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { ...agent, scanIntervalSeconds: 30 },
      brainstorm: { ...agent },
      archive: { ...agent, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** Manifest + scene file — the story half of what the links point at. */
function seedStoryVault(vaultDir: string): void {
  const now = new Date().toISOString();
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID, title: STORY_TITLE, path: `stories/${STORY_ID}`, createdAt: now, updatedAt: now,
      chapters: [{
        id: CHAPTER_ID, title: CHAPTER_TITLE, path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: SCENE_ID, title: SCENE_TITLE, path: scenePath, order: 0,
          chapterId: CHAPTER_ID, storyId: STORY_ID, blocks: [], createdAt: now, updatedAt: now,
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
    provenance: {}, boardReferences: [], smartFolders: [],
  };
  fs.mkdirSync(path.join(vaultDir, path.dirname(scenePath)), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(vaultDir, scenePath),
    ['---', `id: ${SCENE_ID}`, `title: ${SCENE_TITLE}`, `chapterId: ${CHAPTER_ID}`,
      `storyId: ${STORY_ID}`, `updatedAt: ${now}`, '---', '', 'Opening prose.', ''].join('\n'),
  );
}

/** A note and a folder for the vault half of the resolution order. */
function seedNotesVault(notesVaultDir: string): void {
  fs.mkdirSync(path.join(notesVaultDir, 'Lore', FOLDER_NAME), { recursive: true });
  fs.writeFileSync(
    path.join(notesVaultDir, 'Lore', `${NOTE_NAME}.md`),
    `---\ntitle: "${NOTE_NAME}"\n---\n\n# ${NOTE_NAME}\n\nA gate beneath the tide.\n`,
  );
  fs.writeFileSync(
    path.join(notesVaultDir, 'Lore', FOLDER_NAME, 'Tide Compass.md'),
    '---\ntitle: "Tide Compass"\n---\n\n# Tide Compass\n',
  );
  // Non-empty already, but the sentinel makes "no first-run scaffold" explicit.
  fs.writeFileSync(
    path.join(notesVaultDir, '.mythos-seeded'),
    JSON.stringify({ markerVersion: 1, layout: 'notes-vault@SKY-15', mode: 'blank', seededAt: new Date().toISOString() }),
  );
}

/** One key event with NO summary — the description is typed in the UI. */
function seedTimelinesStore(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify({
    schemaVersion: 1,
    activeTimelineId: TIMELINE_ID,
    timelines: [{
      id: TIMELINE_ID, name: STORY_TITLE, kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now,
    }],
    eras: [], spans: [], rows: [],
    events: [{ id: EVENT_ID, timelineId: TIMELINE_ID, name: 'The Crown of Ash', when: 432, chapter: 1 }],
  }, null, 2));
}

function readEvent(vaultDir: string): Record<string, unknown> | undefined {
  const raw = JSON.parse(fs.readFileSync(path.join(vaultDir, 'timelines.json'), 'utf-8'));
  return (raw.events as Record<string, unknown>[]).find((e) => e.id === EVENT_ID);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
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

/** Activate Story without tripping the nav rail's Stories popover backdrop. */
async function activateStorySection(pg: Page): Promise<void> {
  const nav = pg.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if (await storyNavBtn.getAttribute('aria-current') !== 'page') {
    await storyNavBtn.click();
  }
  const backdrop = pg.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

/** Land on the Timeline with the seeded story selected. Following a note or
 *  board link clears the story selection (as it does for any cross-vault
 *  navigation), so the scene row is re-clicked on the way back exactly as a
 *  user would. */
async function openTimeline(pg: Page): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await activateStorySection(pg);
  const sceneRow = pg.locator('.nav-scene-row', { hasText: SCENE_TITLE }).first();
  if (await sceneRow.count()) await sceneRow.click();

  const timelineBtn = pg.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 8_000 });
  await timelineBtn.click();
  await expect(pg.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 10_000 });
  await expect(eventCard(pg)).toBeVisible({ timeout: 10_000 });
}

const eventCard = (pg: Page) => pg.locator(`[data-testid="ax-event-${EVENT_ID}"]`);
const cardDesc = (pg: Page) => pg.locator(`[data-testid="ax-event-desc-${EVENT_ID}"]`);
const detailSummary = (pg: Page) => pg.locator('[data-testid="trp-event-summary-text"]');

/** Select the event so the Inspector shows its detail view. */
async function selectEvent(pg: Page): Promise<void> {
  await eventCard(pg).click();
  await expect(pg.locator('[data-testid="trp-event-editor"]')).toBeVisible({ timeout: 8_000 });
}

/** Back to the Timeline from wherever the last link navigated to. */
async function backToTimeline(pg: Page): Promise<void> {
  await openTimeline(pg);
}

// The tests share one app and build on the description typed in TC-TWL-01.
// Serial mode keeps a failure from restarting the worker mid-suite, which
// would re-run beforeAll and reseed the vault out from under the rest.
test.describe.configure({ mode: 'serial' });

// ─── Suite-level state ──────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-twl-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-twl-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-twl-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedStoryVault(vaultDir);
  seedNotesVault(notesVaultDir);
  seedTimelinesStore(vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openTimeline(page);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-TWL-01: a typed description renders every link form with its resolved kind', async () => {
  expect(readEvent(vaultDir)?.summary).toBeUndefined();

  await selectEvent(page);
  await page.locator('[data-testid="trp-event-pencil"]').click();
  const field = page.locator('[data-testid="trp-event-summary"]');
  await expect(field).toBeVisible({ timeout: 6_000 });
  await field.fill(SUMMARY);
  await page.locator('[data-testid="trp-event-done"]').click();

  // The description round-tripped through IPC to timelines.json, not just state.
  await expect.poll(() => readEvent(vaultDir)?.summary, { timeout: 10_000 }).toBe(SUMMARY);

  // Event detail summary (the mockup's evDetail.sum) — five links, in order,
  // one of each kind, and the unresolved one renders visibly rather than
  // blanking out.
  await expect(detailSummary(page)).toBeVisible({ timeout: 6_000 });
  const detailTones = detailSummary(page).locator('[data-testid="tlw-link"]');
  await expect(detailTones).toHaveCount(5);
  expect(await detailTones.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tone)))
    .toEqual(['note', 'story', 'story', 'folder', 'unresolved']);
  expect(await detailTones.evaluateAll((els) => els.map((el) => el.textContent)))
    .toEqual([NOTE_NAME, SCENE_TITLE, CHAPTER_TITLE, FOLDER_NAME, UNRESOLVED_NAME]);

  // The event card renders the same five (it clamps to two lines, so assert
  // on the DOM rather than on visibility).
  const cardTones = cardDesc(page).locator('[data-testid="tlw-link"]');
  await expect(cardTones).toHaveCount(5);
  expect(await cardTones.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.tone)))
    .toEqual(['note', 'story', 'story', 'folder', 'unresolved']);
});

test('TC-TWL-02: the card badges its references and rings in the mixed accent', async () => {
  // A fresh Timeline has nothing selected, which is when the ring paints.
  await backToTimeline(page);
  await expect(eventCard(page)).toHaveClass(/ax-event--refs-mixed/);

  // Note badge counts the note, the folder and the unresolved link (3);
  // the story badge counts the scene and the chapter (2).
  const noteBadge = eventCard(page).locator('[data-testid="tlw-badge-note"]');
  const storyBadge = eventCard(page).locator('[data-testid="tlw-badge-story"]');
  await expect(noteBadge).toHaveAttribute('data-count', '3');
  await expect(storyBadge).toHaveAttribute('data-count', '2');
  await expect(noteBadge).toHaveAttribute('title', '3 notes linked in this description');
  await expect(storyBadge).toHaveAttribute('title', '2 chapters linked in this description');
});

test('TC-TWL-03: a note link on the card opens the note', async () => {
  await backToTimeline(page);
  await cardDesc(page).locator(`[data-target="${NOTE_NAME}"]`).click();

  await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="note-title"]')).toHaveText(NOTE_NAME, { timeout: 8_000 });
});

test('TC-TWL-04: a scene link opens that scene in the manuscript', async () => {
  await backToTimeline(page);
  await selectEvent(page);
  await detailSummary(page).locator(`[data-target="${SCENE_TITLE}"]`).click();

  await expect(page.locator('[data-testid="msv-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="msv-zoom-scene"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid="msv-root"]')).toContainText('Opening prose.', { timeout: 8_000 });
});

test('TC-TWL-05: a chapter link opens the manuscript at chapter depth', async () => {
  await backToTimeline(page);
  await selectEvent(page);
  await detailSummary(page).locator(`[data-target="${CHAPTER_TITLE}"]`).click();

  await expect(page.locator('[data-testid="msv-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="msv-zoom-chapter"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-testid="msv-chapter-title-${CHAPTER_ID}"]`)).toBeVisible({ timeout: 8_000 });
});

test('TC-TWL-06: a folder link opens the Boards view on that folder', async () => {
  await backToTimeline(page);
  await selectEvent(page);
  await detailSummary(page).locator(`[data-target="${FOLDER_NAME}"]`).click();

  await expect(page.locator('#app-tabpanel-boards')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.boards-tab-panel__breadcrumb-current')).toHaveText(FOLDER_NAME, { timeout: 8_000 });
  // Navigated INTO the folder, not just to the Boards tab: the trail back up
  // through Lore to Home is there, and the folder's note is on the board.
  await expect(page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Home' })).toBeVisible();
  await expect(page.locator('.boards-tab-panel__breadcrumb-btn', { hasText: 'Lore' })).toBeVisible();
});

test('TC-TWL-07: an unresolved link creates the note in the Notes Vault and opens it', async () => {
  const created = path.join(notesVaultDir, `${UNRESOLVED_NAME}.md`);
  expect(fs.existsSync(created)).toBe(false);

  await backToTimeline(page);
  await selectEvent(page);
  await detailSummary(page).locator(`[data-target="${UNRESOLVED_NAME}"]`).click();

  await expect.poll(() => fs.existsSync(created), { timeout: 10_000 }).toBe(true);
  expect(fs.readFileSync(created, 'utf-8')).toContain(`# ${UNRESOLVED_NAME}`);

  await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="note-title"]')).toHaveText(UNRESOLVED_NAME, { timeout: 8_000 });

  // Once the note exists the same link resolves — it is no longer pink.
  await backToTimeline(page);
  await expect(cardDesc(page).locator(`[data-target="${UNRESOLVED_NAME}"]`))
    .toHaveAttribute('data-tone', 'note', { timeout: 10_000 });
});
