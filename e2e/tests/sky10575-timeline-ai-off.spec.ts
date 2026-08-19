/**
 * sky10575-timeline-ai-off.spec.ts — SKY-10575 (M11c defect)
 *
 * PLAN.md M11b surface contract, applied to the Timeline right panel
 * (§8.6): suggest-with-AI affordances disappear when the master AI toggle
 * is off; manual editing (Inspector: drag cards, add/edit events, POV
 * track) stays reachable either way.
 *
 * Found during the M11c manual-mode completeness audit (SKY-9025): the
 * Timeline right panel (frontend/src/timeline2/panel/TimelineRightPanel.tsx)
 * never read `useAiEnabled()`, so Brainstorm (live agent chat) and Archive
 * (continuity-flag review/auto-add) stayed visible and clickable with AI
 * off. A server-side backstop (electron-main/src/provider.ts, AiDisabledError)
 * already blocked any real network call — this suite covers the UI/manual-
 * mode surface contract, not network silence.
 *
 * Real end-to-end path: renderer boots against a real `app-settings.json`
 * with `ai.enabled` set on disk, reads it via the real `settingsGet` IPC
 * round trip (no `window.api` seam stubbed) through `useAiEnabled`. Mirrors
 * e2e/tests/sky9876-brainstorm-ai-off.spec.ts and
 * e2e/tests/m25-timeline-right-panel-archive.spec.ts's Timeline-opening path.
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
const STORY_ID = 'story-10575-e2e';
const CHAPTER_ID = 'chapter-10575-e2e';
const SCENE_ID = 'scene-10575-e2e';
const STORY_TITLE = 'SKY-10575 AI-off Timeline';
const TIMELINE_ID = 'tl-10575-e2e';
const EVENT_ID = 'ev-10575-seed';

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000, ...extra,
  };
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string, aiEnabled: boolean): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: agentCfg(),
      brainstorm: agentCfg({ enabled: true }),
      archive: agentCfg({ enabled: true }),
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
 *  click through into the Timeline view (mirrors m25-timeline-right-panel-archive.spec.ts). */
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

/** timelines.json with one seeded event, so there is a real item to select. */
function seedTimelinesStore(vaultDir: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: TIMELINE_ID,
    timelines: [{
      id: TIMELINE_ID, name: 'SKY-10575 Timeline', kind: 'story', axis: 'calendar',
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

function createFixture(aiEnabled: boolean): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10575-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10575-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10575-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir, aiEnabled);
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
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

async function openApp(fixture: Fixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(fixture.userData);
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
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

/** Select the anchor scene and open the Timeline view — mirrors
 *  m25-timeline-right-panel-archive.spec.ts's openTimeline. */
async function openTimeline(page: Page): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Anchor Scene' }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  // SKY-9019/M5: Timeline is a standalone nav-rail destination, not a Story
  // sub-view — the older `story-subview-timeline` testid (still referenced
  // by e2e/tests/m25-timeline-right-panel-archive.spec.ts) no longer exists.
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const timelineBtn = nav.getByRole('button', { name: 'Timeline', exact: true });
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="timeline-right-panel"]')).toBeVisible({ timeout: 8_000 });
}

// ─── AI off: Brainstorm/Archive gone, Inspector-only, manual editing intact ──

test('SKY-10575: AI off — Brainstorm and Archive tabs are gone, only Inspector remains', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);

    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toBeVisible();
    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="trp-tab-brainstorm"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="trp-tab-archive"]')).toHaveCount(0);

    // Manual editing still works: the seeded event is still selectable and
    // the Inspector still shows/edits it (§M11b: manual editing unaffected).
    const eventLocator = page.getByText('Seeded Event').first();
    await expect(eventLocator).toBeVisible({ timeout: 8_000 });
    await eventLocator.click();
    await expect(page.locator('[data-testid="trp-event-static"]')).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-10575: AI on (control) — Inspector, Brainstorm and Archive tabs all render', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);

    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toBeVisible();
    await expect(page.locator('[data-testid="trp-tab-brainstorm"]')).toBeVisible();
    await expect(page.locator('[data-testid="trp-tab-archive"]')).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
