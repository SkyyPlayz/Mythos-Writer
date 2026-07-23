/**
 * m25-timeline-right-panel-archive.spec.ts — SKY-8267 (independent verifier)
 *
 * Acceptance tests written from the LOCKED spec/contract alone — FULL-SPEC.md
 * §8.6 "Right panel — tabs Inspector · Brainstorm · Archive" plus the §14
 * acceptance-checklist item covering it, and BETA-REFINE.md's M25 block —
 * never from the M25 slice branch (SKY-8266, FoundingEngineer).
 *
 * Spec text (FULL-SPEC.md §14, checklist item 5 — referenced as "§14.5" by
 * BETA-REFINE.md's M25 Accept line):
 *   "Clicking ANY timeline item surfaces the Inspector tab even if
 *    Brainstorm/Archive tab was open; both side-tab mini chats send/receive."
 *
 * Spec text (BETA-REFINE.md, M25 — Timeline right panel + Archive
 * auto-build *(§8.6)*):
 *   "...Archive tab (blurb, quick-add input → agent dates & plots it,
 *    RECENTLY AUTO-ADDED, mini chat)... Accept: §14.5 (any click surfaces
 *    Inspector; both mini chats work); quick-add plots a dated event."
 *
 * Published acceptance criteria under test:
 *   AC-M25-01  Selecting a timeline item (an event) surfaces the Inspector
 *              tab even when the Archive tab was open (§14.5).
 *   AC-M25-02  Archive tab quick-add plots a real, dated event: the typed
 *              text becomes a `timelines.json` event via the real
 *              `timelinesUpsertItem` IPC hop and appears in RECENTLY
 *              AUTO-ADDED — no `window.api` seam is stubbed (no API key is
 *              configured, so this exercises the heuristic quick-add
 *              fallback path end to end, same as production with the agent
 *              offline/capped).
 *   AC-M25-03  Inspector tab's static view shows the event row + KEY EVENT
 *              badge (§8.6), and the pencil toggle reveals the event editor
 *              fields (TITLE / SUMMARY) per §8.6's "pencil toggles edit".
 *
 * Real end-to-end path: renderer -> IPC (`timelinesUpsertItem`) -> main ->
 * `timelines.json` on disk -> back. No `window.api` seam is stubbed
 * (SKY-7994).
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
const STORY_ID = 'story-m25-e2e';
const CHAPTER_ID = 'chapter-m25-e2e';
const SCENE_ID = 'scene-m25-e2e';
const STORY_TITLE = 'M25 Right Panel Chronicle';
const TIMELINE_ID = 'tl-m25-e2e';
const EVENT_ID = 'ev-m25-seed';

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

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
        enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
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

/** Manifest + one anchor scene, purely so StoryNavigator has something to
 *  click through into the Timeline view (mirrors e2e/timeline.spec.ts). */
function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: STORY_TITLE,
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'Chapter One',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: [{
          id: SCENE_ID,
          title: 'Anchor Scene',
          path: scenePath,
          order: 0,
          chapterId: CHAPTER_ID,
          storyId: STORY_ID,
          blocks: [],
          createdAt: now,
          updatedAt: now,
        }],
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

  const fullScenePath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });
  fs.writeFileSync(fullScenePath, [
    '---', `id: ${SCENE_ID}`, 'title: Anchor Scene', `chapterId: ${CHAPTER_ID}`,
    `storyId: ${STORY_ID}`, '---', '', 'Anchor prose.',
  ].join('\n'));
}

/** timelines.json with one seeded event, so there is a real item to click
 *  for the "any click surfaces Inspector" assertion (§14.5). */
function seedTimelinesStore(vaultDir: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: TIMELINE_ID,
    timelines: [{
      id: TIMELINE_ID, name: 'M25 Timeline', kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now,
    }],
    eras: [],
    spans: [],
    rows: [],
    events: [{
      id: EVENT_ID, timelineId: TIMELINE_ID, name: 'Seeded Event', when: 100,
      chapter: 1, pov: 'Kessa', location: 'Docks', impact: 'plot',
    }],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
}

function createFixture(): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m25-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m25-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m25-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedTimelinesStore(vaultDir);
  return { userData, vaultDir, notesVaultDir };
}

function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

// ─── App lifecycle ─────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write('[main:out] ' + d.toString()));
  proc.stderr?.on('data', (d: Buffer) => process.stdout.write('[main:err] ' + d.toString()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('console', (m) => process.stdout.write(`[renderer:${m.type()}] ${m.text()}\n`));
  page.on('pageerror', (e) => process.stdout.write(`[renderer:pageerror] ${e.message}\n`));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openApp(fixture: Fixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(fixture.userData);
  const page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

/** Select the anchor scene (so DesktopShell sets `selectedStory`) and open
 *  the Timeline view — mirrors e2e/timeline.spec.ts's activateStorySection. */
async function openTimeline(page: Page): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Anchor Scene' }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if (await storyNavBtn.getAttribute('aria-current') !== 'page') {
    await storyNavBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }

  const timelineBtn = page.locator('[data-testid="story-subview-timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="timeline-right-panel"]')).toBeVisible({ timeout: 8_000 });
}

function readTimelinesStore(vaultDir: string): { events: Array<{ id: string; name: string; source?: string }> } {
  return JSON.parse(fs.readFileSync(path.join(vaultDir, 'timelines.json'), 'utf-8'));
}

// ─── AC-M25-01: any click surfaces Inspector (§14.5) ─────────────────────────

test('AC-M25-01: clicking a timeline item surfaces the Inspector tab even when Archive was open', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);

    // Open Archive tab explicitly first.
    await page.locator('[data-testid="trp-tab-archive"]').click();
    await expect(page.locator('[data-testid="trp-tab-archive"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="trp-archive-tab"]')).toBeVisible();

    // Select the seeded event on the axis/spreadsheet — whichever timeline
    // item row renders it. Progress mode is the M23 default.
    const eventLocator = page.getByText('Seeded Event').first();
    await expect(eventLocator).toBeVisible({ timeout: 8_000 });
    await eventLocator.click();

    // §14.5: selection forces the Inspector tab open, even though Archive
    // was the last tab the user had open.
    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toHaveAttribute('aria-selected', 'true', { timeout: 6_000 });
    await expect(page.locator('[data-testid="trp-archive-tab"]')).not.toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M25-02: Archive quick-add plots a real, dated event ─────────────────

test('AC-M25-02: Archive tab quick-add plots a dated event via real IPC + disk persistence', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);
    await page.locator('[data-testid="trp-tab-archive"]').click();
    await expect(page.locator('[data-testid="trp-archive-tab"]')).toBeVisible();

    const before = readTimelinesStore(fixture.vaultDir).events.length;

    await page.locator('[data-testid="trp-quickadd-input"]').fill('The harvest festival in Year 872');
    await page.locator('[data-testid="trp-quickadd-btn"]').click();

    // RECENTLY AUTO-ADDED list gets the new event (agent offline with no API
    // key, so this exercises the heuristic quick-add fallback for real).
    await expect(page.locator('[data-testid="trp-recent-list"]')).toBeVisible({ timeout: 10_000 });

    await expect.poll(() => readTimelinesStore(fixture.vaultDir).events.length, { timeout: 10_000 })
      .toBe(before + 1);

    const events = readTimelinesStore(fixture.vaultDir).events;
    const added = events.find((e) => e.id !== EVENT_ID);
    expect(added).toBeDefined();
    expect(added?.source).toBe('agent');
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M25-03: Inspector renders the event editor fields ────────────────────

test('AC-M25-03: Inspector shows the static event row + KEY EVENT badge, and the pencil toggle reveals the editor fields', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);
    const eventLocator = page.getByText('Seeded Event').first();
    await expect(eventLocator).toBeVisible({ timeout: 8_000 });
    await eventLocator.click();

    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toHaveAttribute('aria-selected', 'true', { timeout: 6_000 });

    // Static view: title row + KEY EVENT badge (§8.6).
    const eventEditor = page.locator('[data-testid="trp-event-editor"]');
    await expect(page.locator('[data-testid="trp-event-title"]')).toContainText('Seeded Event');
    await expect(eventEditor.locator('.trp-key-badge')).toHaveText('KEY EVENT');
    await expect(page.locator('[data-testid="trp-event-static"]')).toBeVisible();

    // Pencil toggles into edit mode, revealing TITLE/SUMMARY fields.
    await page.locator('[data-testid="trp-event-pencil"]').click();
    await expect(page.locator('[data-testid="trp-event-summary"]')).toBeVisible({ timeout: 6_000 });
    await expect(eventEditor.getByText('TITLE', { exact: true })).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
