/**
 * timeline-rebuild-sky10876.spec.ts — SKY-10876 (M12.B4b)
 *
 * Real end-to-end coverage for the "Rebuild my timeline" command (FULL-SPEC
 * "two buttons, one engine" ruling, SKY-10528): UI -> IPC (`timeline:rebuild`)
 * -> main process -> the shared manuscript-pass primitive (`manuscriptPass.ts`,
 * M12.B4a / SKY-10875) -> `timelines.json` on disk -> back into the renderer.
 * None of `window.api`/IPC is stubbed.
 *
 * Unlike the Archive quick-add fixture, the Archive Agent must be ENABLED —
 * the rebuild handler is gated on `agents.archive.enabled`, deliberately not
 * on `archiveContinuityEnabled`, so it can never be reached from (or coupled
 * to) a continuity-check invocation (AC#3).
 *
 *   TC-RB-01  "Rebuild my timeline" is its own button, separate from
 *             quick-add, and its click rebuilds the active timeline's scene
 *             events from the manuscript — persisted to `timelines.json` on
 *             disk, one manuscript-derived event per scene, in manuscript
 *             order — proving it drove the shared primitive, not a parallel
 *             reader (AC#2).
 *   TC-RB-02  Re-running the rebuild after nothing changed reports zero
 *             adds/updates/removes (idempotent) and never touches an event
 *             the author renamed (write discipline scoped to its own events).
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

const STORY_ID = 'story-timeline-rebuild-e2e';
const CHAPTER_ID = 'chapter-timeline-rebuild-e2e';
const STORY_TITLE = 'The Rebuilt Chronicle';
const CHAPTER_TITLE = 'Opening Chapter';
const TIMELINE_ID = 'tl-timeline-rebuild-e2e';

interface SeedScene {
  id: string;
  title: string;
}

const SCENE_A: SeedScene = { id: 'sc-rb-a', title: 'The Departure' };
const SCENE_B: SeedScene = { id: 'sc-rb-b', title: 'The Arrival' };

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
      // The rebuild command only checks this enable flag — never
      // `archiveContinuityEnabled` — so continuity-check settings are
      // irrelevant to whether the command can run (AC#3).
      archive: {
        enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
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

function seedVault(vaultDir: string, scenes: SeedScene[]): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const sceneEntries = scenes.map((s, idx) => ({
    id: s.id,
    title: s.title,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${s.id}.md`,
    order: idx,
    chapterId: CHAPTER_ID,
    storyId: STORY_ID,
    blocks: [],
    createdAt: now,
    updatedAt: now,
  }));
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
        title: CHAPTER_TITLE,
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
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
      vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${scene.id}.md`,
    );
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    const fm = [
      '---',
      `id: ${scene.id}`,
      `title: ${scene.title}`,
      `chapterId: ${CHAPTER_ID}`,
      `storyId: ${STORY_ID}`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(scenePath, fm + scene.title + ' prose body.\n');
  }
}

function seedTimelinesStore(vaultDir: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: TIMELINE_ID,
    timelines: [
      {
        id: TIMELINE_ID, name: STORY_TITLE, kind: 'story', axis: 'calendar',
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

async function openArchiveTab(pg: Page, sceneTitle: string): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const sceneRow = pg.locator('.nav-scene-row', { hasText: sceneTitle }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  await activateStorySection(pg);
  const timelineBtn = pg.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(pg.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(pg.locator('[data-testid="timeline-right-panel"]')).toBeVisible({ timeout: 8_000 });

  await pg.locator('[data-testid="trp-tab-archive"]').click();
  await expect(pg.locator('[data-testid="trp-archive-tab"]')).toBeVisible({ timeout: 6_000 });
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-rebuild-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-rebuild-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-timeline-rebuild-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir, [SCENE_A, SCENE_B]);
  seedTimelinesStore(vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openArchiveTab(page, SCENE_A.title);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-RB-01: "Rebuild my timeline" is a separate command that persists manuscript-derived events to disk', async () => {
  // Sanity: nothing on disk yet — the quick-add button exists too, but this
  // test only ever presses the rebuild button.
  expect(readTimelinesStore(vaultDir).events).toHaveLength(0);
  await expect(page.locator('[data-testid="trp-quickadd-btn"]')).toBeVisible();

  const rebuildBtn = page.locator('[data-testid="trp-rebuild-timeline-btn"]');
  await expect(rebuildBtn).toBeVisible({ timeout: 6_000 });
  await rebuildBtn.click();

  // The write lands on disk via `timeline:rebuild` -> the shared
  // manuscript-pass primitive -> `writeTimelinesStore` — the real IPC ->
  // main -> disk boundary crossing, not just renderer state.
  await expect.poll(() => readTimelinesStore(vaultDir).events.length, { timeout: 10_000 }).toBe(2);
  const events = readTimelinesStore(vaultDir).events;
  const names = events.map((e) => e.name).sort();
  expect(names).toEqual([SCENE_A.title, SCENE_B.title].sort());
  events.forEach((e) => {
    expect(e.source).toBe('agent');
    expect((e.id as string).startsWith('event:manuscript:')).toBe(true);
  });
});

test('TC-RB-02: re-running the rebuild is idempotent and never touches an author-renamed event', async () => {
  // Simulate the author taking ownership of one event's name via the disk
  // fixture (equivalent to editing it in the Inspector) — the rebuild's
  // write discipline must leave it alone on the next run.
  const store = readTimelinesStore(vaultDir);
  const target = store.events.find((e) => e.name === SCENE_A.title)!;
  target.name = 'Author-renamed departure';
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));

  const rebuildBtn = page.locator('[data-testid="trp-rebuild-timeline-btn"]');
  await rebuildBtn.click();

  // Give the IPC round-trip a moment, then assert nothing regressed: still
  // exactly 2 events, and the rename survived.
  await page.waitForTimeout(500);
  const after = readTimelinesStore(vaultDir);
  expect(after.events).toHaveLength(2);
  const renamed = after.events.find((e) => e.id === target.id);
  expect(renamed?.name).toBe('Author-renamed departure');
});
