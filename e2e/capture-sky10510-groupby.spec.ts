/**
 * capture-sky10510-groupby.spec.ts — one-off screenshot capture for PR #1257
 * (SKY-10510 / SKY-10525): the Group By select disabled + dimmed in the
 * Progress/Structure lanes modes vs enabled (and grouping) in Spreadsheet.
 *
 * Not part of CI — follows the repo's capture-*.spec.ts precedent
 * (e2e/capture-folder-ops-screenshots.spec.ts, SKY-7995). Seed data mirrors
 * the M23 lane-row suite in timeline.spec.ts so the lanes render populated.
 *
 * Run: xvfb-run --auto-servernum npx playwright test e2e/capture-sky10510-groupby.spec.ts
 * Output: e2e-shots-sky10510/*.png (or $SHOT_DIR)
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
const SHOT_DIR = process.env.SHOT_DIR
  ?? path.resolve(__dirname, '../e2e-shots-sky10510');

const STORY_ID = 'story-cap-e2e';
const CHAPTER_ID = 'chapter-cap-e2e';
const STORY_TITLE = 'Chronicles of the Axis';
const CHAPTER_TITLE = 'Axis One';

const B1 = { id: 'sc-cap-1', title: 'Boarding', date: '2340-01-01', arcs: [] as string[], pov: 'Eira', mood: 'tense' };
const B2 = { id: 'sc-cap-2', title: 'Terminus', date: '2340-08-20', arcs: [] as string[], pov: 'Kael', mood: 'hopeful' };

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const agentDefaults = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { ...agentDefaults, scanIntervalSeconds: 30 },
      brainstorm: { ...agentDefaults },
      archive: { ...agentDefaults, continuityCheckIntervalSeconds: 60 },
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

function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });
  const scenes = [B1, B2];
  const sceneEntries = scenes.map((s, idx) => ({
    id: s.id, title: s.title,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${s.id}.md`,
    order: idx, chapterId: CHAPTER_ID, storyId: STORY_ID, blocks: [],
    createdAt: now, updatedAt: now,
  }));
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID, title: STORY_TITLE, path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID, title: CHAPTER_TITLE,
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0, scenes: sceneEntries, createdAt: now, updatedAt: now,
      }],
      createdAt: now, updatedAt: now,
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
    provenance: {}, boardReferences: [], smartFolders: [],
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
      `chronologicalDate: ${scene.date}`,
      'chronologicalIsEstimated: false',
      'chronologicalConfidence: 1',
      'chronologicalSource: explicit_marker',
      'entityArcs: []',
      `metaPov: ${scene.pov}`,
      `metaMood: ${scene.mood}`,
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
      { id: 'ev-early', timelineId: 'tl-story', name: 'The Watcher Calls', when: 100, chapter: 1, pov: 'Eira', location: 'Docks', impact: 'plot', summary: 'A summons at dawn.' },
      { id: 'ev-flash', timelineId: 'tl-story', name: 'The Crown of Ash', when: 50, chapter: 31, pov: 'Kael', location: 'Bridge', impact: 'tension', summary: 'The truth of the royal line.' },
      { id: 'ev-late', timelineId: 'tl-story', name: 'The Last Stand', when: 800, chapter: 40, pov: 'Eira', location: 'Docks', impact: 'plot' },
      { id: 'ev-world', timelineId: 'tl-story', name: 'Festival of Lanterns', when: 300, rowId: 'lane:world' },
      { id: 'ev-theme', timelineId: 'tl-story', name: 'Trust & Betrayal', when: 0, rowId: 'lane:themes' },
    ],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cap10510-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cap10510-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cap10510-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedTimelinesStore(vaultDir);

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless'] : [];
  app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

/** Clip a close-up of the whole Timeline toolbar (mode segment + filters). */
async function toolbarCloseup(name: string): Promise<void> {
  const box = await page.locator('[data-testid="timeline-header"]').boundingBox();
  if (!box) throw new Error('timeline-header not visible');
  const pad = 12;
  const vp = page.viewportSize() ?? { width: 1440, height: 900 };
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  await page.screenshot({
    path: path.join(SHOT_DIR, name),
    clip: {
      x, y,
      width: Math.min(vp.width - x, box.width + pad * 2),
      height: Math.min(vp.height - y, box.height + pad * 2),
    },
  });
}

/** Clear transient overlays (vault-upgrade prompt, notes-tab toast) so the
 *  captures show only the surface under review. */
async function dismissOverlays(): Promise<void> {
  const notNow = page.getByRole('button', { name: 'Not now' });
  if (await notNow.count()) await notNow.first().click().catch(() => {});
  const toast = page.locator('[data-testid="app-toast"]');
  if (await toast.count()) {
    await toast.first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
  }
}

test('capture Group By disabled in lanes vs enabled in Spreadsheet', async () => {
  test.setTimeout(180_000);

  // Into the story so the Timeline has an active story to render.
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  const sceneRow = page.locator('.nav-scene-row', { hasText: B1.title }).first();
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
  await nav.locator('button[aria-label="Timeline"]').click();
  await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });

  const groupSelect = page.locator('[data-testid="groupby-select"]');
  const modeBar = page.getByRole('group', { name: 'Timeline view mode' });

  // 1 — Progress (default lanes): disabled + dimmed.
  await modeBar.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(page.locator('[data-testid="timeline-axis-view"]')).toBeVisible({ timeout: 8_000 });
  await expect(groupSelect).toBeDisabled();
  await dismissOverlays();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, '01-progress-groupby-disabled.png') });
  await toolbarCloseup('01b-progress-toolbar-closeup.png');

  // 2 — Structure: still disabled.
  await modeBar.getByRole('button', { name: 'Structure', exact: true }).click();
  await expect(groupSelect).toBeDisabled();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-structure-groupby-disabled.png') });

  // 3 — Spreadsheet: enabled, grouping by Chapter produces real group rows.
  await modeBar.getByRole('button', { name: 'Spreadsheet', exact: true }).click();
  await expect(page.locator('[data-testid="timeline-spreadsheet-root"]')).toBeVisible({ timeout: 8_000 });
  await expect(groupSelect).toBeEnabled();
  await groupSelect.selectOption('chapter');
  await expect(page.locator('.tls-group-row').first()).toBeVisible({ timeout: 6_000 });
  await dismissOverlays();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-spreadsheet-groupby-enabled.png') });
  await toolbarCloseup('03b-spreadsheet-toolbar-closeup.png');
});
