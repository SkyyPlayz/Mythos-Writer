/**
 * timeline.spec.ts — SKY-797 / SKY-7989
 *
 * E2E coverage for the Timeline view (TimelineSpreadsheet mode) per spec §3.3
 * (docs/TIMELINE-VIEWS-DESIGN-SPEC.md) and the SKY-797 scope.
 *
 * Beta 4 M24 (§8.5) rebuilt the Spreadsheet surface to read the M21
 * `timelines.json` events store directly (EVENT/CH/DATE·ERA/POV/LOCATION/
 * IMPACT columns), retiring the earlier scene-row + filter-bar + detail-card
 * contract this suite used to assert against (SKY-791/793/794/795/796). The
 * cases below map 1:1 onto what TimelineSpreadsheet.tsx actually renders now:
 *
 *   TC-TL-01  Event appears as a row with all six columns populated.
 *   TC-TL-02  All seeded events render as rows (nothing dropped/hidden by
 *             default).
 *   TC-TL-03  Click row → row + cell enter the `tls-row--selected` /
 *             `aria-selected` state (routes to the Inspector per §8.6).
 *   TC-TL-04  Narrative ⇄ Chronological toggle re-sorts rows and surfaces the
 *             FLASHBACK badge only in Chronological order, only on the
 *             out-of-narrative-order row (§3.3, M24 AC8).
 *   TC-TL-05  Group-By POV groups rows under a group header with a count and
 *             is collapsible.
 *   TC-TL-06  Group-By Location groups rows the same way.
 *   TC-TL-07  Group-By Chapter groups rows the same way.
 *   TC-TL-08  Empty state — a story with no timeline events shows the
 *             "No events yet" card instead of the table.
 *
 * Performance gate (spec §10): a 500-event fixture must keep keyboard/hover
 * scroll latency under the 60fps frame budget (16.67ms target; we assert a
 * generous ceiling to keep CI runners stable).
 *
 * The suite seeds the vault + `timelines.json` directly on disk before
 * launching Electron so the tests don't pay the cost of UI-driven event
 * creation per case. This keeps the whole suite under one Electron boot and
 * within CI's tight budget.
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'story-timeline-e2e';
const CHAPTER_ID = 'chapter-timeline-e2e';
const STORY_TITLE = 'Chronicles of the Subway';
const CHAPTER_TITLE = 'Track One';

// A single vault scene purely to give StoryNavigator something to click so
// DesktopShell sets `selectedStory` and the Timeline view has an active
// story/timeline to render. The spreadsheet itself reads from timelines.json,
// not from this scene.
const ANCHOR_SCENE = {
  id: 'sc-tl-anchor', title: 'Anchor Scene', date: '2340-06-14',
  arcs: [] as string[], pov: 'Eira', mood: 'tense',
};

// Three events: EV_1/EV_3 share POV+Location, EV_2 differs on both, and EV_2's
// `when` (50) is earlier than EV_1's (100) despite coming later in chapter
// (narrative) order — this is what makes EV_2 the FLASHBACK row once sorted
// Chronologically (TC-TL-04).
const EV_1 = {
  id: 'ev-tl-1', name: 'Departure', when: 100, chapter: 1,
  pov: 'Eira', location: 'Docks', impact: 'plot',
};
const EV_2 = {
  id: 'ev-tl-2', name: 'Crossing', when: 50, chapter: 2,
  pov: 'Kael', location: 'Bridge', impact: 'tension',
};
const EV_3 = {
  id: 'ev-tl-3', name: 'Arrival', when: 200, chapter: 3,
  pov: 'Eira', location: 'Docks', impact: 'plot',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/**
 * Write manifest + a single scene .md file — just enough for StoryNavigator
 * to show a story/chapter/scene to click through into the Timeline view.
 */
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
  // Manifest shape must mirror defaultManifest() in electron-main/src/vault.ts —
  // the readers iterate manifest.scenes / manifest.entities etc., so missing
  // arrays raise "manifest.scenes is not iterable" on first read.
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

interface SeedEvent {
  id: string;
  name: string;
  when: number;
  chapter: number;
  pov: string;
  location: string;
  impact: string;
}

/** Explicit timelines.json fixture — the spreadsheet reads `events` directly
 *  (TimelineSpreadsheet.tsx), filtered to `activeTimelineId`. */
function seedTimelinesStore(vaultDir: string, timelineId: string, timelineName: string, events: SeedEvent[]): void {
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
    events: events.map(e => ({
      id: e.id, timelineId, name: e.name, when: e.when, chapter: e.chapter,
      pov: e.pov, location: e.location, impact: e.impact,
    })),
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
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

/** Open the story's first scene so DesktopShell sets `selectedStory`, then
 *  switch to the Timeline view's Spreadsheet mode.
 *
 *  Beta 4 M23 made Progress (the axis lane rows) the DEFAULT timeline mode,
 *  so this suite explicitly switches to Spreadsheet after the view mounts. */
async function openSpreadsheet(pg: Page, sceneTitle: string): Promise<void> {
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
  // Persisted viewMode may already be 'spreadsheet' from an earlier switch in
  // this profile; clicking the seg button is idempotent either way.
  await pg.locator('[data-testid="view-mode-spreadsheet"]').click();
}

/** Same as openSpreadsheet, but lets the caller pick which timeline view mode
 *  to land on — the M23 lane-row suite below stays on the 'progress' default. */
async function openTimeline(
  pg: Page,
  sceneTitle: string,
  mode: 'spreadsheet' | 'progress' = 'spreadsheet',
): Promise<void> {
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
  if (mode === 'spreadsheet') {
    await pg.locator('[data-testid="view-mode-spreadsheet"]').click();
    await expect(pg.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 8_000 });
  } else {
    await pg.locator('[data-testid="view-mode-progress"]').click();
    await expect(pg.locator('[data-testid="timeline-axis-view"]')).toBeVisible({ timeout: 8_000 });
  }
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir, STORY_ID, STORY_TITLE, CHAPTER_ID, CHAPTER_TITLE, [ANCHOR_SCENE]);
  seedTimelinesStore(vaultDir, 'tl-story', STORY_TITLE, [EV_1, EV_2, EV_3]);
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openSpreadsheet(page, ANCHOR_SCENE.title);
  await expect(page.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 8_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-TL-01: Event appears as a row with all six columns ─────────────────

test('TC-TL-01: a seeded event appears as a row with all six columns populated', async () => {
  const row = page.locator(`[data-testid="row-${EV_1.id}"]`);
  await expect(row).toBeVisible({ timeout: 6_000 });
  await expect(page.locator(`[data-testid="cell-${EV_1.id}-event"]`)).toContainText(EV_1.name);
  await expect(page.locator(`[data-testid="cell-${EV_1.id}-ch"]`)).toContainText(String(EV_1.chapter));
  await expect(page.locator(`[data-testid="cell-${EV_1.id}-pov"]`)).toContainText(EV_1.pov);
  await expect(page.locator(`[data-testid="cell-${EV_1.id}-location"]`)).toContainText(EV_1.location);
  await expect(page.locator(`[data-testid="cell-${EV_1.id}-impact"]`)).toContainText(EV_1.impact);
});

// ─── TC-TL-02: all seeded events render, nothing dropped by default ────────

test('TC-TL-02: all seeded events render as rows by default', async () => {
  await expect(page.locator(`[data-testid="row-${EV_1.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="row-${EV_2.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="row-${EV_3.id}"]`)).toBeVisible();
  await expect(page.locator('.tls-row')).toHaveCount(3);
});

// ─── TC-TL-03: click row → selected state ───────────────────────────────────

test('TC-TL-03: clicking a row enters the selected state', async () => {
  const row = page.locator(`[data-testid="row-${EV_1.id}"]`);
  await row.click();

  await expect(row).toHaveClass(/tls-row--selected/);
  await expect(row).toHaveAttribute('aria-selected', 'true');

  // Clicking a different row moves the selection rather than adding to it.
  const row2 = page.locator(`[data-testid="row-${EV_2.id}"]`);
  await row2.click();
  await expect(row2).toHaveClass(/tls-row--selected/);
  await expect(row).not.toHaveClass(/tls-row--selected/);
});

// ─── TC-TL-04: Narrative ⇄ Chronological toggle + FLASHBACK badge ───────────

test('TC-TL-04: Chronological sort re-orders rows and badges the out-of-order event as FLASHBACK', async () => {
  // Narrative order (by chapter) is the default: EV_1, EV_2, EV_3. No badges.
  const narrativeOrder = await page.locator('.tls-row').evaluateAll(rows =>
    rows.map(r => r.getAttribute('data-testid') ?? ''),
  );
  expect(narrativeOrder).toEqual([`row-${EV_1.id}`, `row-${EV_2.id}`, `row-${EV_3.id}`]);
  await expect(page.locator(`[data-testid="flashback-${EV_2.id}"]`)).toHaveCount(0);

  await page.locator('[data-testid="tls-sort-chronological"]').click();
  await expect(page.locator('.tls-th-date')).toHaveAttribute('aria-sort', 'ascending');

  // Chronological order is by `when` ascending: EV_2 (50), EV_1 (100), EV_3 (200).
  const chronoOrder = await page.locator('.tls-row').evaluateAll(rows =>
    rows.map(r => r.getAttribute('data-testid') ?? ''),
  );
  expect(chronoOrder).toEqual([`row-${EV_2.id}`, `row-${EV_1.id}`, `row-${EV_3.id}`]);

  // EV_2 sits earlier in-world time than EV_1 despite coming later in chapter
  // order → it's the FLASHBACK row once sorted chronologically.
  await expect(page.locator(`[data-testid="flashback-${EV_2.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="flashback-${EV_1.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="flashback-${EV_3.id}"]`)).toHaveCount(0);
  await expect(page.locator('[data-testid="tls-sort-caption"]')).toContainText('Chronological order');

  // Reset for later tests.
  await page.locator('[data-testid="tls-sort-narrative"]').click();
  await expect(page.locator('.tls-th-date')).toHaveAttribute('aria-sort', 'none');
});

// ─── TC-TL-05: Group-By POV ──────────────────────────────────────────────────

test('TC-TL-05: Group-By POV groups rows under a collapsible header with a count', async () => {
  await page.locator('[data-testid="tls-group-pov"]').click();

  const groupRows = page.locator('.tls-group-row');
  await expect(groupRows).toHaveCount(2); // Eira, Kael

  const eiraGroup = groupRows.filter({ hasText: 'Eira' });
  await expect(eiraGroup).toContainText('(2)'); // EV_1 + EV_3
  const kaelGroup = groupRows.filter({ hasText: 'Kael' });
  await expect(kaelGroup).toContainText('(1)'); // EV_2

  // Collapsing a group hides its rows without unmounting the other group.
  await eiraGroup.click();
  await expect(eiraGroup).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[data-testid="row-${EV_1.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="row-${EV_2.id}"]`)).toBeVisible();

  await eiraGroup.click();
  await expect(eiraGroup).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`[data-testid="row-${EV_1.id}"]`)).toBeVisible();

  await page.locator('[data-testid="tls-group-none"]').click();
});

// ─── TC-TL-06: Group-By Location ─────────────────────────────────────────────

test('TC-TL-06: Group-By Location groups rows under a collapsible header with a count', async () => {
  await page.locator('[data-testid="tls-group-location"]').click();

  const groupRows = page.locator('.tls-group-row');
  await expect(groupRows).toHaveCount(2); // Docks, Bridge

  const docksGroup = groupRows.filter({ hasText: 'Docks' });
  await expect(docksGroup).toContainText('(2)'); // EV_1 + EV_3
  const bridgeGroup = groupRows.filter({ hasText: 'Bridge' });
  await expect(bridgeGroup).toContainText('(1)'); // EV_2

  await page.locator('[data-testid="tls-group-none"]').click();
});

// ─── TC-TL-07: Group-By Chapter ──────────────────────────────────────────────

test('TC-TL-07: Group-By Chapter groups rows under a collapsible header with a count', async () => {
  await page.locator('[data-testid="tls-group-chapter"]').click();

  const groupRows = page.locator('.tls-group-row');
  await expect(groupRows).toHaveCount(3); // Chapter 1, 2, 3 — one event each

  for (const ch of [1, 2, 3]) {
    await expect(groupRows.filter({ hasText: `Chapter ${ch}` })).toContainText('(1)');
  }

  await page.locator('[data-testid="tls-group-none"]').click();
  await expect(page.locator('.tls-group-row')).toHaveCount(0);
});

// ─── TC-TL-08: Empty state — no timeline events ─────────────────────────────

test.describe('TC-TL-08 — empty state', () => {
  const EMPTY_STORY_ID = 'story-timeline-empty';
  const EMPTY_CHAPTER_ID = 'chapter-timeline-empty';
  const EMPTY_SCENE = {
    id: 'sc-tl-empty-anchor', title: 'Empty Anchor Scene', date: '2340-01-01',
    arcs: [] as string[], pov: 'Eira', mood: 'tense',
  };

  let emptyUserData: string;
  let emptyVaultDir: string;
  let emptyNotesVaultDir: string;
  let emptyApp: ElectronApplication | undefined;
  let emptyPage: Page;

  test.beforeAll(async () => {
    emptyUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-empty-user-'));
    emptyVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-empty-vault-'));
    emptyNotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-empty-notes-'));
    seedUserData(emptyUserData, emptyVaultDir, emptyNotesVaultDir);
    seedVault(emptyVaultDir, EMPTY_STORY_ID, 'Empty Story', EMPTY_CHAPTER_ID, 'Empty Chapter', [EMPTY_SCENE]);
    seedTimelinesStore(emptyVaultDir, 'tl-story', 'Empty Story', []);
    emptyApp = await launchApp(emptyUserData);
    emptyPage = await firstWindow(emptyApp);
    await openSpreadsheet(emptyPage, EMPTY_SCENE.title);
  });

  test.afterAll(async () => {
    await emptyApp?.close().catch(() => {});
    fs.rmSync(emptyUserData, { recursive: true, force: true });
    fs.rmSync(emptyVaultDir, { recursive: true, force: true });
    fs.rmSync(emptyNotesVaultDir, { recursive: true, force: true });
  });

  test('TC-TL-08: a story with no timeline events shows the "No events yet" empty state', async () => {
    await expect(emptyPage.locator('[data-testid="timeline-spreadsheet-empty"]')).toBeVisible({ timeout: 8_000 });
    await expect(emptyPage.locator('[data-testid="timeline-spreadsheet-empty"]')).toContainText('No events yet');
    await expect(emptyPage.locator('[data-testid="timeline-spreadsheet-root"]')).toHaveCount(0);
  });
});

// ─── Performance gate (spec §10 — 500 events under a 60ms frame budget) ─────
//
// A separate Electron boot with a 500-event fixture. We measure the median
// requestAnimationFrame interval while a hover/scroll sweep is running and
// assert it stays under a ceiling — generous vs. the 16.67ms 60fps ideal,
// but tight enough to catch the obvious render-blocking regressions the spec
// guards against on CI runners. Local devs see headroom; CI runners running
// under xvfb with no GPU sit near the ceiling, which is why we don't assert
// 16.67ms directly.

test.describe('SKY-797 — perf gate', () => {
  const PERF_STORY_ID = 'story-perf';
  const PERF_CHAPTER_ID = 'chapter-perf';
  const PERF_SCENE = {
    id: 'sc-perf-anchor', title: 'Perf Anchor Scene', date: '2340-01-01',
    arcs: [] as string[], pov: 'Eira', mood: 'tense',
  };

  // 60ms = 16.67fps. Tight enough to catch O(n²) regressions on every hover
  // sweep; loose enough to survive runner jitter under xvfb.
  // 60ms was calibrated against 2025 ubuntu-latest runners; current images
  // render this fixture at ~66ms median on UNMODIFIED main (measured
  // 2026-07-08, sampled=31 median=65.8 p95=113 under xvfb software GL), so
  // the gate now flakes on runner drift rather than catching regressions.
  // 100ms in CI still fails the pre-SKY-797 jank this gate was written for
  // (~200ms+ medians) while absorbing shared-runner variance; local runs
  // keep the strict 60ms budget.
  const FRAME_BUDGET_MS = process.env.CI ? 100 : 60;

  let perfUserData: string;
  let perfVaultDir: string;
  let perfNotesVaultDir: string;
  let perfApp: ElectronApplication | undefined;
  let perfPage: Page;

  test.beforeAll(async () => {
    perfUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-perf-user-'));
    perfVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-perf-vault-'));
    perfNotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-perf-notes-'));
    seedUserData(perfUserData, perfVaultDir, perfNotesVaultDir);
    seedVault(perfVaultDir, PERF_STORY_ID, 'Perf Story', PERF_CHAPTER_ID, 'Perf Chapter', [PERF_SCENE]);

    // Build a 500-event fixture programmatically.
    const events: SeedEvent[] = Array.from({ length: 500 }, (_, i) => ({
      id: `ev-perf-${i.toString().padStart(3, '0')}`,
      name: `Event ${i.toString().padStart(3, '0')}`,
      when: i * 2,
      chapter: (i % 20) + 1,
      pov: `Char ${i % 5}`,
      location: `Location ${i % 8}`,
      impact: ['plot', 'tension', 'reveal', 'setup', 'payoff'][i % 5],
    }));
    seedTimelinesStore(perfVaultDir, 'tl-story', 'Perf Story', events);

    perfApp = await launchApp(perfUserData);
    perfPage = await firstWindow(perfApp);
    // Freeze Liquid Neon ambience (frame ring / breathing borders / wallpaper
    // drift) so the gate measures timeline cost, not shell repaints, under
    // software rendering. emulateMedia is the proven mechanism (TRK-08).
    await perfPage.emulateMedia({ reducedMotion: 'reduce' });
    await openSpreadsheet(perfPage, PERF_SCENE.title);
    await expect(perfPage.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await perfApp?.close().catch(() => {});
    fs.rmSync(perfUserData, { recursive: true, force: true });
    fs.rmSync(perfVaultDir, { recursive: true, force: true });
    fs.rmSync(perfNotesVaultDir, { recursive: true, force: true });
  });

  test('500 events — median frame interval under budget during a hover + scroll sweep', async () => {
    // Sanity: at least the first batch of rows is rendered.
    await expect(perfPage.locator('.tls-row').first()).toBeVisible({ timeout: 10_000 });

    // page.evaluate samples requestAnimationFrame intervals for ~2 s while it
    // drives a hover + scroll sweep on the scroll container. We assert on the
    // median so a single jank frame from GC or layout doesn't blow up the test.
    const result = await perfPage.evaluate(async () => {
      const SAMPLE_MS = 2000;
      const SAMPLE_MAX_MS = 8000;
      const MIN_FRAMES = 40;
      const intervals: number[] = [];
      const scroller = document.querySelector<HTMLElement>('.tls-scroll');
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.tls-row'));
      if (!scroller || rows.length === 0) {
        return { sampled: 0, medianMs: 0, p95Ms: 0, rows: rows.length };
      }

      let last = performance.now();
      const stopAt = last + SAMPLE_MS;
      let raf = 0;
      let i = 0;
      let direction = 1;

      const step = () => {
        const now = performance.now();
        intervals.push(now - last);
        last = now;

        const row = rows[i % rows.length];
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        row.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        i++;

        scroller.scrollTop += direction * 40;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) direction = -1;
        if (scroller.scrollTop <= 0) direction = 1;

        if (now < stopAt || (intervals.length < MIN_FRAMES && now < hardStopAt)) {
          raf = requestAnimationFrame(step);
        } else {
          done = true;
        }
      };
      const hardStopAt = last + SAMPLE_MAX_MS;
      let done = false;
      raf = requestAnimationFrame(step);

      const deadline = performance.now() + SAMPLE_MAX_MS + 500;
      while (!done && performance.now() < deadline) {
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      }
      cancelAnimationFrame(raf);

      const usable = intervals.slice(1).sort((a, b) => a - b);
      const median = usable[Math.floor(usable.length / 2)] ?? 0;
      const p95 = usable[Math.floor(usable.length * 0.95)] ?? 0;
      return { sampled: usable.length, medianMs: median, p95Ms: p95, rows: rows.length };
    });

    console.log('[perf]', JSON.stringify(result));
    expect(result.rows, 'fixture must render at least 100 rows for the sample to be meaningful').toBeGreaterThanOrEqual(100);
    expect(result.sampled, 'must collect a meaningful frame sample').toBeGreaterThan(30);
    expect(
      result.medianMs,
      `median frame interval ${result.medianMs.toFixed(1)}ms exceeded the ${FRAME_BUDGET_MS}ms budget (p95=${result.p95Ms.toFixed(1)}ms over ${result.sampled} frames, ${result.rows} rows)`,
    ).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  });
});



// ─── Beta 4 M23 — Lane rows + Progress/Structure (TC-TL-M23-*) ───────────────
//
// M23 (§8.4) rebuilt the Progress/Structure surfaces on the M22 axis engine:
// the seven-mode segment (Progress · Structure · Plotlines · Spreadsheet ·
// Tension · Relationships · Subway), the full story row stack plotted from
// timelines.json, the functional View/Show filters, Templates ▾ (dashed beat
// plotlines — §14.4 step 8) and the Progress written/planned greyscale. The
// timelines store is seeded EXPLICITLY on disk (never relying on implicit
// demo seeding) so every row assertion maps to a known fixture item.

test.describe('Beta 4 M23 — timeline lane rows (TC-TL-M23-*)', () => {
  const M23_STORY_ID = 'story-m23-e2e';
  const M23_CHAPTER_ID = 'chapter-m23-e2e';
  const M23_STORY_TITLE = 'Chronicles of the Axis';
  const M23_CHAPTER_TITLE = 'Axis One';

  const B1 = { id: 'sc-m23-1', title: 'Boarding',  date: '2340-01-01', arcs: [] as string[], pov: 'Eira', mood: 'tense' };
  const B2 = { id: 'sc-m23-2', title: 'Terminus',  date: '2340-08-20', arcs: [] as string[], pov: 'Kael', mood: 'hopeful' };

  /** Explicit timelines.json fixture: one story timeline with books, an arc,
   *  a character lifespan, world/theme chips and a flashback event pair. */
  function seedTimelinesStore(vaultDir: string): void {
    const now = new Date().toISOString();
    const store = {
      schemaVersion: 1,
      activeTimelineId: 'tl-story',
      timelines: [
        {
          id: 'tl-story', name: 'The Last City of Veynn', kind: 'story', axis: 'calendar',
          calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
          createdAt: now, updatedAt: now,
        },
      ],
      eras: [
        { id: 'era-1', timelineId: 'tl-story', name: 'OPENING', startWhen: 0, endWhen: 864 },
      ],
      spans: [
        { id: 'book-1', timelineId: 'tl-story', name: 'BOOK ONE', startWhen: 0, endWhen: 432 },
        { id: 'book-2', timelineId: 'tl-story', name: 'BOOK TWO', startWhen: 432, endWhen: 864 },
        { id: 'arc-1', timelineId: 'tl-story', name: 'I. The Call', startWhen: 0, endWhen: 400, rowId: 'lane:arcs' },
        { id: 'char-1', timelineId: 'tl-story', name: 'Mira', startWhen: 0, endWhen: 800, rowId: 'lane:characters' },
      ],
      rows: [],
      events: [
        { id: 'ev-early', timelineId: 'tl-story', name: 'The Watcher Calls', when: 100, chapter: 1, summary: 'A summons at dawn.' },
        { id: 'ev-flash', timelineId: 'tl-story', name: 'The Crown of Ash', when: 50, chapter: 31, summary: 'The truth of the royal line.' },
        { id: 'ev-late', timelineId: 'tl-story', name: 'The Last Stand', when: 800, chapter: 40 },
        { id: 'ev-world', timelineId: 'tl-story', name: 'Festival of Lanterns', when: 300, rowId: 'lane:world' },
        { id: 'ev-theme', timelineId: 'tl-story', name: 'Trust & Betrayal', when: 0, rowId: 'lane:themes' },
      ],
    };
    fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
  }

  let m23UserData: string;
  let m23VaultDir: string;
  let m23NotesVaultDir: string;
  let m23App: ElectronApplication | undefined;
  let m23Page: Page;

  test.beforeAll(async () => {
    m23UserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m23-user-'));
    m23VaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m23-vault-'));
    m23NotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m23-notes-'));
    seedUserData(m23UserData, m23VaultDir, m23NotesVaultDir);
    seedVault(
      m23VaultDir,
      M23_STORY_ID, M23_STORY_TITLE,
      M23_CHAPTER_ID, M23_CHAPTER_TITLE,
      [B1, B2],
      [],
    );
    seedTimelinesStore(m23VaultDir);
    m23App = await launchApp(m23UserData);
    m23Page = await firstWindow(m23App);
    await openTimeline(m23Page, B1.title, 'progress');
  });

  test.afterAll(async () => {
    await m23App?.close().catch(() => {});
    fs.rmSync(m23UserData, { recursive: true, force: true });
    fs.rmSync(m23VaultDir, { recursive: true, force: true });
    fs.rmSync(m23NotesVaultDir, { recursive: true, force: true });
  });

  test('TC-TL-M23-01: seven-mode segment with Progress default + the full toolbar', async () => {
    const modeBar = m23Page.getByRole('group', { name: 'Timeline view mode' });
    await expect(modeBar).toBeVisible({ timeout: 6_000 });
    for (const label of ['Progress', 'Structure', 'Plotlines', 'Spreadsheet', 'Tension', 'Relationships', 'Subway']) {
      await expect(modeBar.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    await expect(modeBar.getByRole('button', { name: 'Progress', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Toolbar: Templates ▾, + Plotline, View/Group/Show selects, Today.
    await expect(m23Page.locator('[data-testid="tl-templates-btn"]')).toBeVisible();
    await expect(m23Page.locator('[data-testid="tl-add-plotline"]')).toBeVisible();
    await expect(m23Page.locator('[data-testid="tl-view-filter"]')).toBeVisible();
    await expect(m23Page.locator('[data-testid="groupby-select"]')).toBeVisible();
    await expect(m23Page.locator('[data-testid="tl-show-filter"]')).toBeVisible();
    await expect(m23Page.locator('[data-testid="tl-today-btn"]')).toBeVisible();
  });

  test('TC-TL-M23-02: every story row plots from timelines.json', async () => {
    // ERAS + BOOKS (M22 rows) from the seeded store.
    await expect(m23Page.locator('[data-testid="ax-era-era-1"]')).toHaveText('OPENING');
    await expect(m23Page.locator('[data-testid="ax-span-book-1"]')).toContainText('BOOK ONE');
    // M23 rows: ARCS · CHAPTERS · KEY EVENTS (badged) · CHARACTERS · WORLD · THEMES.
    await expect(m23Page.locator('[data-testid="ax-arc-arc-1"]')).toContainText('I. The Call');
    await expect(m23Page.locator('[data-testid="ax-chapter"]')).toHaveCount(1); // one story chapter
    await expect(m23Page.locator('[data-testid="ax-event-ev-early"]')).toContainText('The Watcher Calls');
    await expect(m23Page.locator('[data-testid="ax-event-ev-early"]')).toContainText('Ch. 1');
    await expect(m23Page.locator('[data-testid="ax-flash-ev-flash"]')).toHaveText('FLASHBACK');
    await expect(m23Page.locator('[data-testid="ax-char-char-1"]')).toContainText('Mira');
    await expect(m23Page.locator('[data-testid="ax-world-ev-world"]')).toContainText('Festival of Lanterns');
    await expect(m23Page.locator('[data-testid="ax-theme-ev-theme"]')).toContainText('Trust & Betrayal');
    // Story-lane items never leak into KEY EVENTS.
    await expect(m23Page.locator('[data-testid="ax-event-ev-world"]')).toHaveCount(0);
    // Left panel: Overview + book-focus cards.
    await expect(m23Page.locator('[data-testid="tl-overview-card"]')).toBeVisible();
    await expect(m23Page.locator('[data-testid="tl-book-card-book-1"]')).toContainText('BOOK ONE');
  });

  test('TC-TL-M23-03: Progress greys planned content; Structure does not', async () => {
    // No seeded scene has a word count → the chapter is unwritten/planned.
    const mini = m23Page.locator('[data-testid="ax-chapter"]').first();
    await expect(mini).toBeVisible({ timeout: 6_000 });
    await expect(mini).toHaveAttribute('style', /grayscale\(0?\.92\) brightness\(0?\.82\)/);

    const modeBar = m23Page.getByRole('group', { name: 'Timeline view mode' });
    await modeBar.getByRole('button', { name: 'Structure', exact: true }).click();
    await expect(mini).not.toHaveAttribute('style', /grayscale/);
    await modeBar.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(m23Page.locator('[data-testid="timeline-axis-view"]')).toBeVisible();
  });

  test('TC-TL-M23-04: Templates ▾ → Save the Cat lays a dashed beat plotline (§14.4 step 8)', async () => {
    await m23Page.locator('[data-testid="tl-templates-btn"]').click();
    await expect(m23Page.locator('[data-testid="tl-templates-menu"]')).toBeVisible();
    await m23Page.locator('[data-testid="tl-template-save-the-cat"]').click();

    // Toast confirms; the PLOTLINES row gains a lane of 8 dashed beat chips.
    // Filtered by text: several app-toasts can coexist (the global
    // notes-migration notice merged from main, plus other timeline toasts),
    // so a bare [data-testid="app-toast"] locator trips Playwright's strict
    // mode. Same pattern as wiki-links.spec.ts.
    await expect(m23Page.locator('[data-testid="app-toast"]')
      .filter({ hasText: '“Save the Cat” laid onto the timeline as a plotline' }))
      .toBeVisible({ timeout: 8_000 });
    await expect(m23Page.locator('.ax-plotcard[data-beat="true"]')).toHaveCount(8, { timeout: 8_000 });
    await expect(m23Page.locator('.ax-plotcard').first()).toHaveCSS('border-style', 'dashed');
    // The left panel lists the new plotline with its card count.
    await expect(m23Page.locator('[data-testid="tlr-aside"]')).toContainText('Save the Cat');
    // Beat cards survive restarts: the store on disk now holds the plotline row.
    const onDisk = JSON.parse(fs.readFileSync(path.join(m23VaultDir, 'timelines.json'), 'utf-8'));
    expect(onDisk.rows.some((r: { kind: string; name: string }) => r.kind === 'plotline' && r.name === 'Save the Cat')).toBe(true);
    expect(onDisk.events.filter((e: { beat?: boolean }) => e.beat).length).toBe(8);
  });

  test('TC-TL-M23-05: the Show filter regroups the KEY EVENTS row live', async () => {
    // Nothing is written (no word counts) → Written Only empties the row.
    await m23Page.locator('[data-testid="tl-show-filter"]').selectOption('Written Only');
    await expect(m23Page.locator('[data-testid="ax-event-ev-early"]')).toHaveCount(0);
    await expect(m23Page.locator('[data-testid="ax-event-ev-late"]')).toHaveCount(0);
    await m23Page.locator('[data-testid="tl-show-filter"]').selectOption('Planned Only');
    await expect(m23Page.locator('[data-testid="ax-event-ev-early"]')).toBeVisible();
    await m23Page.locator('[data-testid="tl-show-filter"]').selectOption('All Events');
    await expect(m23Page.locator('[data-testid="ax-event-ev-late"]')).toBeVisible();
  });

  test('TC-TL-M23-06: Today explains itself while nothing is written; modes route their surfaces', async () => {
    await m23Page.locator('[data-testid="tl-today-btn"]').click();
    // Filtered by text (see TC-TL-M23-04): concurrent app-toasts must not
    // make this locator ambiguous under Playwright's strict mode.
    await expect(m23Page.locator('[data-testid="app-toast"]')
      .filter({ hasText: 'Nothing written yet' }))
      .toBeVisible();

    const modeBar = m23Page.getByRole('group', { name: 'Timeline view mode' });
    await modeBar.getByRole('button', { name: 'Plotlines', exact: true }).click();
    // Beta 4 M24 rebuilt Plotlines as the Plottr grid (reads/writes
    // timelines.json) — the old stub testid no longer exists.
    await expect(m23Page.locator('[data-testid="timeline-plotlines"]')).toBeVisible();
    await modeBar.getByRole('button', { name: 'Tension', exact: true }).click();
    // Beta 4 M24 also rebuilt Tension mode — see the stub testid replacement above.
    await expect(m23Page.locator('[data-testid="timeline-tension"]')).toBeVisible();
    await modeBar.getByRole('button', { name: 'Relationships', exact: true }).click();
    await expect(m23Page.locator('[data-testid="timeline-relationships"]')).toBeVisible({ timeout: 6_000 });
    await modeBar.getByRole('button', { name: 'Subway', exact: true }).click();
    await expect(m23Page.locator('[data-testid="timeline-subway"]')).toBeVisible({ timeout: 6_000 });
    await modeBar.getByRole('button', { name: 'Spreadsheet', exact: true }).click();
    await expect(m23Page.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 6_000 });
    // Back to the lanes for good measure.
    await modeBar.getByRole('button', { name: 'Progress', exact: true }).click();
    await expect(m23Page.locator('[data-testid="timeline-axis-view"]')).toBeVisible({ timeout: 6_000 });
  });
});
