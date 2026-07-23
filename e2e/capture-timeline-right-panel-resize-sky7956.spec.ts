/**
 * capture-timeline-right-panel-resize-sky7956.spec.ts — SKY-7956 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots showing the
 * Timeline right panel (Inspector/Brainstorm/Archive) is now resizable
 * (250-430px, default 316px) instead of the previous hardcoded 264px.
 * Seed helpers are copied from e2e/timeline.spec.ts (manifest/scene/timelines
 * store shapes) rather than re-derived, to match what the app actually reads.
 * Not registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-timeline-right-panel-resize-sky7956.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/timeline-right-panel-resize-sky7956');

const STORY_ID = 'story-sky7956';
const CHAPTER_ID = 'chapter-sky7956';
const STORY_TITLE = 'SKY-7956 Resize Story';
const CHAPTER_TITLE = 'Chapter One';
const ANCHOR_SCENE = {
  id: 'sc-sky7956-anchor', title: 'Anchor Scene', date: '2340-06-14',
  arcs: [] as string[], pov: 'Eira', mood: 'tense',
};
const EV_1 = { id: 'ev-sky7956-1', name: 'Departure', when: 100, chapter: 1 };

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
}

/** Copied from e2e/timeline.spec.ts's seedVault — manifest shape must mirror
 *  defaultManifest() in electron-main/src/vault.ts. */
function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const sceneEntries = [{
    id: ANCHOR_SCENE.id,
    title: ANCHOR_SCENE.title,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${ANCHOR_SCENE.id}.md`,
    order: 0,
    chapterId: CHAPTER_ID,
    storyId: STORY_ID,
    blocks: [],
    createdAt: now,
    updatedAt: now,
  }];
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

  const scenePath = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${ANCHOR_SCENE.id}.md`);
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  const fm = [
    '---',
    `id: ${ANCHOR_SCENE.id}`,
    `title: ${ANCHOR_SCENE.title}`,
    `chapterId: ${CHAPTER_ID}`,
    `storyId: ${STORY_ID}`,
    `chronologicalDate: ${ANCHOR_SCENE.date}`,
    `chronologicalIsEstimated: false`,
    `chronologicalConfidence: 1`,
    `chronologicalSource: explicit_marker`,
    `entityArcs: [${ANCHOR_SCENE.arcs.join(', ')}]`,
    `metaPov: ${ANCHOR_SCENE.pov}`,
    `metaMood: ${ANCHOR_SCENE.mood}`,
    `updatedAt: ${now}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(scenePath, fm + ANCHOR_SCENE.title + ' prose body.\n');
}

/** Copied from e2e/timeline.spec.ts's seedTimelinesStore. */
function seedTimelinesStore(vaultDir: string): void {
  const now = new Date().toISOString();
  const store = {
    schemaVersion: 1,
    activeTimelineId: 'tl-story',
    timelines: [{
      id: 'tl-story', name: STORY_TITLE, kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: now, updatedAt: now,
    }],
    eras: [], spans: [], rows: [],
    events: [{ id: EV_1.id, timelineId: 'tl-story', name: EV_1.name, when: EV_1.when, chapter: EV_1.chapter }],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  // Run this spec under `xvfb-run` (matches how CI's e2e suite launches
  // Electron) rather than passing a bare `--headless` Chromium flag — that
  // flag alone produces zero BrowserWindows for this app.
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion'],
    timeout: 60_000,
  });
}

test('capture timeline right panel resize screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky7956-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky7956-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky7956-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedTimelinesStore(vaultDir);

  const app = await launchApp(userData);
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  proc.on('exit', (code) => console.log('[main:exit]', code));
  const page: Page = await app.firstWindow();
  page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: ANCHOR_SCENE.title }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
  if (await storyNavBtn.getAttribute('aria-current') !== 'page') await storyNavBtn.click();

  const timelineBtn = page.locator('[data-testid="story-subview-timeline"]');
  await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
  await timelineBtn.click();
  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });

  const panel = page.locator('[data-testid="timeline-right-panel"]');
  await expect(panel).toBeVisible({ timeout: 8_000 });

  // Click an event card to select it into the Inspector tab (§14.5).
  await page.locator(`[data-testid="ax-event-${EV_1.id}"]`).click();
  await expect(page.locator('[data-testid="trp-tab-inspector"]')).toHaveAttribute('aria-selected', 'true');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Default width (316px) — the prototype's default, was hardcoded 264px.
  const defaultWidth = await panel.evaluate((el) => el.getBoundingClientRect().width);
  console.log('[sky7956] default panel width:', defaultWidth);
  await page.screenshot({ path: path.join(OUT_DIR, '1-default-316px.png') });

  // 2. Drag the resize handle wider, toward the prototype's 430px max.
  const handle = page.locator('[aria-label="Resize timeline panel"]');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('resize handle has no bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 100, handleBox.y + handleBox.height / 2, { steps: 10 });
  await page.mouse.up();

  const widenedWidth = await panel.evaluate((el) => el.getBoundingClientRect().width);
  console.log('[sky7956] widened panel width:', widenedWidth);
  expect(widenedWidth).toBeGreaterThan(defaultWidth);
  await page.screenshot({ path: path.join(OUT_DIR, '2-dragged-wider.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
