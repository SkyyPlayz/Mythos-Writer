/**
 * sky10575-timeline-ai-off.spec.ts — SKY-10575 (M11c defect)
 *
 * PLAN.md M11b surface contract: suggest-with-AI affordances disappear when AI
 * is off; manual editing remains.  For the Timeline right panel this means:
 *   • Brainstorm tab (live agent chat via window.api.agentBrainstorm) — hidden
 *   • Archive tab (continuity-flag review/auto-add) — hidden
 *   • Inspector tab — always visible (manual editing, drag, add/edit events
 *     are all unaffected)
 *
 * This test boots the real app with `ai.enabled = false` written to disk,
 * navigates to the Timeline view, and asserts that only the Inspector tab is
 * present in the right-panel tab strip.  No LLM call is made or mocked.
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

const STORY_ID = 'story-sky10575';
const CHAPTER_ID = 'chapter-sky10575';
const SCENE_ID = 'scene-sky10575';
const TIMELINE_ID = 'tl-sky10575';

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000, ...extra,
  };
}

function createFixture(aiEnabled: boolean): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10575-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10575-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10575-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    ai: { enabled: aiEnabled },
    agents: {
      writingAssistant: agentCfg(),
      brainstorm: agentCfg({ enabled: aiEnabled }),
      archive: agentCfg({ enabled: aiEnabled }),
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));

  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const now = new Date().toISOString();
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const manifest = {
    schemaVersion: 1, version: '2.0.0', vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID, title: 'SKY-10575 Fixture', path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID, title: 'Ch 1', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0, storyId: STORY_ID,
        scenes: [{
          id: SCENE_ID, title: 'Anchor Scene', path: scenePath,
          order: 0, chapterId: CHAPTER_ID, storyId: STORY_ID,
          blocks: [], createdAt: now, updatedAt: now,
        }],
        createdAt: now, updatedAt: now,
      }],
      createdAt: now, updatedAt: now,
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
    provenance: {}, boardReferences: [], smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const fullScenePath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });
  fs.writeFileSync(fullScenePath, [
    '---', `id: ${SCENE_ID}`, 'title: Anchor Scene',
    `chapterId: ${CHAPTER_ID}`, `storyId: ${STORY_ID}`, '---', '', 'Anchor prose.',
  ].join('\n'));

  const timelinesStore = {
    schemaVersion: 1, activeTimelineId: TIMELINE_ID,
    timelines: [{
      id: TIMELINE_ID, name: 'SKY-10575 Timeline', kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now,
    }],
    eras: [], spans: [], rows: [],
    events: [{
      id: 'ev-sky10575', timelineId: TIMELINE_ID, name: 'Seed Event', when: 100,
      chapter: 1, pov: 'Hero', location: 'Keep',
    }],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(timelinesStore, null, 2));

  return { userData, vaultDir, notesVaultDir };
}

function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
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

async function openTimeline(page: Page): Promise<void> {
  // Select the anchor scene so DesktopShell sets selectedStory.
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Anchor Scene' }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  // Navigate to Story Writer (in case not already there).
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test('SKY-10575: AI off — Brainstorm and Archive tabs hidden, Inspector remains', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);

    // Inspector tab must be present.
    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toBeVisible({ timeout: 5_000 });

    // Brainstorm and Archive tabs must be absent when AI is off.
    await expect(page.locator('[data-testid="trp-tab-brainstorm"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="trp-tab-archive"]')).toHaveCount(0);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('SKY-10575: AI on — all three tabs visible', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openTimeline(page);

    await expect(page.locator('[data-testid="trp-tab-inspector"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="trp-tab-brainstorm"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="trp-tab-archive"]')).toBeVisible({ timeout: 5_000 });
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
