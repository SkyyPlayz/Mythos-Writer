/**
 * timeline-tension-open-chapter-event.spec.ts — SKY-10926
 *
 * Reachability coverage for `TimelineTension`'s `onOpenChapterEvent` callback
 * prop (frontend/src/TimelineTension.tsx line 23/170): pressing Enter or
 * Space on a keyboard-focused chapter tension point used to call a prop that
 * `TimelineRoot` never passed — the interaction was a dead no-op. `SKY-10926`
 * wires it to `TimelineRoot`'s existing `onOpenScene` chapter navigation
 * (the same handler Lanes/Relationships/Subway already use), keyed off the
 * POV track's chapter index.
 *
 *   TC-TOE-01  Focusing chapter 2's tension point and pressing Enter
 *              navigates the manuscript to chapter 2's scene — the active
 *              workspace tab switches from the chapter-1 anchor scene to the
 *              chapter-2 scene, proving the callback is really wired, not
 *              merely present.
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

const STORY_ID = 'story-tension-open-chapter-e2e';
const STORY_TITLE = 'The Tension Ledger';

const CHAPTER_1_ID = 'chapter-tension-e2e-1';
const CHAPTER_1_TITLE = 'Opening Chapter';
const CHAPTER_2_ID = 'chapter-tension-e2e-2';
const CHAPTER_2_TITLE = 'Second Chapter';

// Chapter 1's scene is opened first (to give StoryNavigator/DesktopShell an
// active story+tab); chapter 2's scene is the real navigation target — the
// Enter keypress on the chapter-2 tension point must switch the active tab
// to THIS scene, not merely leave chapter 1's tab open.
const ANCHOR_SCENE = {
  id: 'sc-toe-anchor', title: 'Anchor Scene', chapterId: CHAPTER_1_ID,
};
const TARGET_SCENE = {
  id: 'sc-toe-target', title: 'Target Scene', chapterId: CHAPTER_2_ID,
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
  chapterId: string;
}

/** Write manifest + scene .md files for a two-chapter, one-scene-each story —
 *  enough for StoryNavigator to open, and for `axisChapters`/POV-track
 *  derivation (chapterIndex 0/1) to give the Tension view two chapter cells. */
function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  function sceneEntry(s: SeedScene, order: number) {
    return {
      id: s.id,
      title: s.title,
      path: `stories/${STORY_ID}/chapters/${s.chapterId}/scenes/${s.id}.md`,
      order,
      chapterId: s.chapterId,
      storyId: STORY_ID,
      blocks: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: STORY_TITLE,
      path: `stories/${STORY_ID}`,
      chapters: [
        {
          id: CHAPTER_1_ID,
          title: CHAPTER_1_TITLE,
          path: `stories/${STORY_ID}/chapters/${CHAPTER_1_ID}`,
          order: 0,
          scenes: [sceneEntry(ANCHOR_SCENE, 0)],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: CHAPTER_2_ID,
          title: CHAPTER_2_TITLE,
          path: `stories/${STORY_ID}/chapters/${CHAPTER_2_ID}`,
          order: 1,
          scenes: [sceneEntry(TARGET_SCENE, 0)],
          createdAt: now,
          updatedAt: now,
        },
      ],
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

  for (const scene of [ANCHOR_SCENE, TARGET_SCENE]) {
    const scenePath = path.join(
      vaultDir, 'stories', STORY_ID, 'chapters', scene.chapterId, 'scenes', `${scene.id}.md`,
    );
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    const fm = [
      '---',
      `id: ${scene.id}`,
      `title: ${scene.title}`,
      `chapterId: ${scene.chapterId}`,
      `storyId: ${STORY_ID}`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    // Non-empty prose so the scene counts as "written" (wordCount > 0).
    fs.writeFileSync(scenePath, fm + scene.title + ' has some real prose body text.\n');
  }
}

/** Empty timelines.json — the Tension view renders its axis/points from
 *  `chapters` (real vault chapters) even with zero persisted tension points,
 *  so no tensionPoints seeding is required for this reachability check. */
function seedTimelinesStore(vaultDir: string, timelineId: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: timelineId,
    timelines: [
      {
        id: timelineId, name: STORY_TITLE, kind: 'story', axis: 'calendar',
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

/** Open the anchor scene, land on the Timeline view, and switch to Tension
 *  mode (§8.5 M24 seven-mode segment). */
async function openTensionView(pg: Page): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const sceneRow = pg.locator('.nav-scene-row', { hasText: ANCHOR_SCENE.title }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  await activateStorySection(pg);
  const timelineBtn = pg.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();

  await expect(pg.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
  await pg.locator('[data-testid="view-mode-tension"]').click();
  await expect(pg.locator('[data-testid="timeline-tension"]')).toBeVisible({ timeout: 8_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tension-open-chapter-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tension-open-chapter-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tension-open-chapter-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedTimelinesStore(vaultDir, 'tl-tension-open-chapter');
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openTensionView(page);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-TOE-01: Enter on a focused chapter tension point navigates to that chapter\'s scene', async () => {
  // Sanity: the Timeline view is showing (DesktopShell's `view === 'timeline'`
  // gate hides the shell's editor pane — and with it the workspace tab strip —
  // while Timeline is active), and no editor tab strip is present yet.
  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible();
  await expect(page.locator('.wtb-tab--active')).toHaveCount(0);

  // Chapter 2's tension point (role="slider", 1-based chapter columns —
  // TimelineTension.tsx `chapterCols`). Playwright's `.press()` focuses the
  // element first (firing the component's `onFocus` -> `setFocusedChapter`),
  // then dispatches the real keydown the component listens for.
  const chapter2Point = page.locator('[data-testid="tlt-point-2"]');
  await expect(chapter2Point).toBeVisible({ timeout: 8_000 });
  await chapter2Point.press('Enter');

  // The real chapter-navigation handler (TimelineRoot's onOpenScene, reused
  // from Lanes/Relationships/Subway) fires: DesktopShell's handleOpenSceneById
  // selects chapter 2's scene and switches `view` back to 'editor' — the
  // Timeline view unmounts and the workspace tab strip reappears with chapter
  // 2's scene as the active tab.
  await expect(page.locator('[data-testid="timeline-root"]')).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator('.wtb-tab--active .wtb-tab-label')).toHaveText(
    TARGET_SCENE.title,
    { timeout: 8_000 },
  );
});
