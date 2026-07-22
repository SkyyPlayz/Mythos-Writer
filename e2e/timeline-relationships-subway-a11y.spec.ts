/**
 * timeline-relationships-subway-a11y.spec.ts — SKY-7935
 *
 * E2E coverage for the Beta4/M24 a11y rebuild of the Relationships and
 * Subway timeline view modes (docs/TIMELINE-VIEW-MODES-A11Y-SPEC.md §3.2/§3.3,
 * parent SKY-6980/PR #1040).
 *
 * Acceptance cases:
 *   TC-A11Y-01  Relationships renders a native <table> with the sr-only
 *               caption and per-cell aria-labels for present characters.
 *   TC-A11Y-02  Subway's "View as table" toggle swaps the SVG diagram for
 *               the identical presence-table markup and moves focus into it.
 *
 * Follows this repo's house e2e convention (see timeline.spec.ts): seeds the
 * vault directly on disk, launches the real Electron app, and drives it via
 * Playwright — no IPC stubbing.
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

const STORY_ID = 'story-rel-sub-a11y';
const CHAPTER_ID = 'chapter-rel-sub-a11y';
const STORY_TITLE = 'The Hue-Separated Chronicles';
const CHAPTER_TITLE = 'Track One';

const CHAR_MIRA = { id: 'entity-mira', name: 'Mira Veynn' };
const CHAR_KAEL = { id: 'entity-kael', name: 'Kael Thorne' };

// Two dated, written scenes so deriveAeonTimeline samples both as key events
// and both characters' POV/participant links produce presence dots.
const SCENE_1 = {
  id: 'sc-rs-1', title: 'Departure', date: '2340-06-14',
  characters: [CHAR_MIRA.id], pov: 'Mira Veynn', mood: 'tense',
};
const SCENE_2 = {
  id: 'sc-rs-2', title: 'Crossing', date: '2340-06-15',
  characters: [CHAR_KAEL.id], pov: 'Kael Thorne', mood: 'somber',
};

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
  characters: string[];
  pov: string;
  mood: string;
}

/** Seed manifest + character entities + scene .md files with POV/participant
 *  links, so Relationships/Subway derive presence from the same POV data
 *  path Spreadsheet/Plotlines/Tension already use (spec §3.2 data-contract
 *  recommendation — no manual-override UI in this milestone). */
function seedVault(
  vaultDir: string,
  storyId: string,
  storyTitle: string,
  chapterId: string,
  chapterTitle: string,
  scenes: SeedScene[],
  characters: { id: string; name: string }[],
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

  const entityEntries = characters.map(c => ({
    id: c.id,
    name: c.name,
    type: 'character',
    path: `entities/${c.id}.md`,
    aliases: [],
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
    entities: entityEntries,
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
    smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(vaultDir, 'arcs.json'), JSON.stringify([], null, 2));

  for (const c of characters) {
    const entityPath = path.join(vaultDir, 'entities', `${c.id}.md`);
    fs.mkdirSync(path.dirname(entityPath), { recursive: true });
    fs.writeFileSync(
      entityPath,
      ['---', `id: ${c.id}`, `name: ${c.name}`, 'type: character', `updatedAt: ${now}`, '---', '', `${c.name} description.`].join('\n'),
    );
  }

  for (const scene of scenes) {
    const scenePath = path.join(
      vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes', `${scene.id}.md`,
    );
    fs.mkdirSync(path.dirname(scenePath), { recursive: true });
    // wordCount > 0 marks the scene "written" so deriveAeonTimeline samples it
    // as a key event (isWritten()); entityCharacterIds is the POV/participant
    // link Relationships/Subway derive presence from.
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
      `entityCharacterIds: [${scene.characters.join(', ')}]`,
      `metaPov: ${scene.pov}`,
      `metaMood: ${scene.mood}`,
      `metaWordCount: 120`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(scenePath, fm + scene.title + ' prose body with enough words to count as written.\n');
  }
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

async function openTimelineMode(
  pg: Page,
  sceneTitle: string,
  mode: 'relations' | 'subway',
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
  await pg.locator(`[data-testid="view-mode-${mode}"]`).click();
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-rel-sub-a11y-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-rel-sub-a11y-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-rel-sub-a11y-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(
    vaultDir,
    STORY_ID, STORY_TITLE,
    CHAPTER_ID, CHAPTER_TITLE,
    [SCENE_1, SCENE_2],
    [CHAR_MIRA, CHAR_KAEL],
  );
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-A11Y-01: Relationships native table ───────────────────────────────────

test('TC-A11Y-01: Relationships renders a native table with caption and presence aria-labels', async () => {
  await openTimelineMode(page, SCENE_1.title, 'relations');

  const table = page.locator('[data-testid="timeline-character-presence-table"]');
  await expect(table).toBeVisible({ timeout: 8_000 });
  expect(await table.evaluate(el => el.tagName)).toBe('TABLE');

  const caption = table.locator('caption');
  await expect(caption).toHaveText('Character presence by chapter');

  // Presence dot for the character actually linked to a sampled scene.
  const mira = table.getByLabel(/Mira Veynn present in chapter \d+/);
  await expect(mira.first()).toBeVisible();
});

// ─── TC-A11Y-02: Subway "View as table" toggle ────────────────────────────────

test('TC-A11Y-02: Subway "View as table" swaps to the shared table and moves focus into it', async () => {
  // Reuse the timeline view already opened by TC-A11Y-01 — just switch the
  // mode-seg to Subway rather than re-navigating from the story nav (which
  // can land on a different scene-selection state once already inside the
  // Timeline sub-view).
  await page.locator('[data-testid="view-mode-subway"]').click();

  const svg = page.locator('[data-testid="tsw-svg"]');
  await expect(svg).toBeVisible({ timeout: 8_000 });

  const toggle = page.locator('[data-testid="subway-table-toggle"]');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  const table = page.locator('[data-testid="timeline-character-presence-table"]');
  await expect(table).toBeVisible({ timeout: 8_000 });
  await expect(svg).toHaveCount(0);

  // Focus moved into the table on activation (spec §3.3).
  await expect(table).toBeFocused();

  // Identical table markup/contract as Relationships mode.
  await expect(table.locator('caption')).toHaveText('Character presence by chapter');
});
