/**
 * timeline-archive-quickadd.spec.ts — SKY-8266
 *
 * Real end-to-end coverage for the Beta 4 M25 Archive tab quick-add path
 * (FULL-SPEC §8.6): UI -> IPC (`timelines:upsertItem`) -> main process ->
 * `timelines.json` on disk -> back into the renderer. None of
 * `window.api`/IPC is stubbed — this is the boundary-crossing test the
 * milestone's "E2E note" calls for (SKY-7994 E2E standard).
 *
 * The Archive agent is left disabled in seeded app-settings (same as
 * timeline.spec.ts's fixture), so `agentArchive` rejects with "Archive agent
 * is disabled in settings." and quick-add deterministically falls back to
 * `heuristicQuickAdd`'s chapter-reference parsing — no network/API key
 * needed, and the resulting event name/chapter are exact.
 *
 *   TC-AQ-01  Quick-add with a "Ch. N" reference plots a new event dated to
 *             that chapter, and the event is actually persisted to
 *             `timelines.json` on disk (not just renderer state).
 *   TC-AQ-02  The new event shows up in RECENTLY AUTO-ADDED, and clicking it
 *             jumps to + selects it on the timeline (Inspector surfaces via
 *             the existing cross-view selection, per §14.5).
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'story-archive-quickadd-e2e';
const CHAPTER_ID = 'chapter-archive-quickadd-e2e';
const STORY_TITLE = 'The Archive Ledger';
const CHAPTER_TITLE = 'Opening Ledger';

const ANCHOR_SCENE = {
  id: 'sc-aq-anchor', title: 'Anchor Scene', date: '2340-06-14',
  arcs: [] as string[], pov: 'Eira', mood: 'tense',
};

const QUICK_ADD_TEXT = 'Add the harvest festival from Ch. 1';
// heuristicQuickAdd's titleFromText strips the leading "Add the" and the
// trailing "from Ch. 1", capitalizing what's left.
const EXPECTED_EVENT_NAME = 'Harvest festival';

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
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
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
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

interface SeedScene {
  id: string;
  title: string;
  date: string;
  arcs: string[];
  pov: string;
  mood: string;
}

/** Write manifest + a single scene .md file — just enough for StoryNavigator
 *  to show a story/chapter/scene to click through into the Timeline view. */
function seedVault(
  vaultDir: string,
  storyId: string,
  storyTitle: string,
  chapterId: string,
  chapterTitle: string,
  scenes: SeedScene[],
): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const sceneEntries = scenes.map((s, idx) => ({
    id: s.id,
    title: s.title,
    path: `stories/${storyId}/chapters/${chapterId}/scenes/${s.id}.md`,
    order: idx,
    chapterId,
    storyId,
    blocks: [],
    createdAt: now,
    updatedAt: now,
  }));
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: storyId,
      title: storyTitle,
      path: `stories/${storyId}`,
      chapters: [{
        id: chapterId,
        title: chapterTitle,
        path: `stories/${storyId}/chapters/${chapterId}`,
        order: 0,
        scenes: sceneEntries,
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
    smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  for (const scene of scenes) {
    const scenePath = path.join(
      vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes', `${scene.id}.md`,
    );
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    const fm = [
      '---',
      `id: ${scene.id}`,
      `title: ${scene.title}`,
      `chapterId: ${chapterId}`,
      `storyId: ${storyId}`,
      `chronologicalDate: ${scene.date}`,
      `chronologicalIsEstimated: false`,
      `chronologicalConfidence: 1`,
      `chronologicalSource: explicit_marker`,
      `entityArcs: [${scene.arcs.join(', ')}]`,
      `metaPov: ${scene.pov}`,
      `metaMood: ${scene.mood}`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(scenePath, fm + scene.title + ' prose body.\n');
  }
}

/** Explicit timelines.json fixture — an empty story timeline with no events,
 *  so quick-add's write is the only thing that ever puts an event on disk. */
function seedTimelinesStore(vaultDir: string, timelineId: string, timelineName: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: timelineId,
    timelines: [
      {
        id: timelineId, name: timelineName, kind: 'story', axis: 'calendar',
        calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
        createdAt: now, updatedAt: now,
      },
    ],
    eras: [],
    spans: [],
    rows: [],
    events: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
}

function readTimelinesStore(vaultDir: string): { events: Array<Record<string, unknown>> } {
  const raw = fs.readFileSync(path.join(vaultDir, 'timelines.json'), 'utf-8');
  return JSON.parse(raw);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
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

/** Activate the Story nav section without tripping the nav rail v2 Stories
 *  popover (re-clicking the active item toggles it open, and its backdrop
 *  intercepts pointer events until dismissed). */
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

/** Open the story's first scene, land on the Timeline view (Progress mode,
 *  the M23 default), and open the right panel's Archive tab. */
async function openArchiveTab(pg: Page, sceneTitle: string): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const storiesTab = pg.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = pg.locator('.nav-scene-row', { hasText: sceneTitle }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  await activateStorySection(pg);
  const timelineBtn = pg.locator('[data-testid="story-subview-timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(pg.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(pg.locator('[data-testid="timeline-right-panel"]')).toBeVisible({ timeout: 8_000 });

  await pg.locator('[data-testid="trp-tab-archive"]').click();
  await expect(pg.locator('[data-testid="trp-archive-tab"]')).toBeVisible({ timeout: 6_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-archive-quickadd-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-archive-quickadd-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-archive-quickadd-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir, STORY_ID, STORY_TITLE, CHAPTER_ID, CHAPTER_TITLE, [ANCHOR_SCENE]);
  seedTimelinesStore(vaultDir, 'tl-archive-quickadd', STORY_TITLE);
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openArchiveTab(page, ANCHOR_SCENE.title);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-AQ-01: quick-add plots a dated event and persists it to timelines.json on disk', async () => {
  // Sanity: nothing on disk yet.
  expect(readTimelinesStore(vaultDir).events).toHaveLength(0);

  await page.locator('[data-testid="trp-quickadd-input"]').fill(QUICK_ADD_TEXT);
  await page.locator('[data-testid="trp-quickadd-btn"]').click();

  // RECENTLY AUTO-ADDED renders the new event once the IPC round-trip
  // resolves and the renderer re-hydrates from the main-process response.
  const recentList = page.locator('[data-testid="trp-recent-list"]');
  await expect(recentList).toBeVisible({ timeout: 10_000 });
  await expect(recentList).toContainText(EXPECTED_EVENT_NAME);

  // The write actually landed on disk via `timelines:upsertItem` — not just
  // in renderer state. This is the real IPC -> main -> disk boundary crossing.
  await expect.poll(() => readTimelinesStore(vaultDir).events.length, { timeout: 10_000 }).toBe(1);
  const [event] = readTimelinesStore(vaultDir).events;
  expect(event.name).toBe(EXPECTED_EVENT_NAME);
  expect(event.chapter).toBe(1);
  expect(event.source).toBe('agent');
});

test('TC-AQ-02: clicking the auto-added event in RECENTLY AUTO-ADDED jumps to + selects it', async () => {
  const [event] = readTimelinesStore(vaultDir).events;
  const recentButton = page.locator(`[data-testid="trp-recent-${event.id}"]`);
  await expect(recentButton).toBeVisible({ timeout: 6_000 });
  await recentButton.click();

  // The jump switches to a lanes mode and selects the event, surfacing the
  // Inspector tab (§14.5) — the panel's active tab flips off Archive.
  await expect(page.locator('[data-testid="trp-tab-inspector"]')).toHaveAttribute('aria-selected', 'true', { timeout: 6_000 });
});
