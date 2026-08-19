// SKY-10542 — PR #1261 evidence screenshots for the Timeline POV track lane:
// the Progress lanes view with the new POV row ("POV · WHO TELLS EACH SCENE")
// between CHARACTERS and WORLD, one lane per POV name (Eira, Kael), and the
// POV-less scene contributing no chip. Seeds the same fixture shape as the
// TC-TL-M23-09 e2e in timeline.spec.ts. Not part of CI: run manually to
// refresh the images.
//   xvfb-run --auto-servernum npx playwright test e2e/capture-sky10542-pov-lane.spec.ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10542-pov-lane');

const STORY_ID = 'story-pov-cap';
const CHAPTER_ID = 'chapter-pov-cap';
const STORY_TITLE = 'Chronicles of the Axis';
const CHAPTER_TITLE = 'Axis One';

// Two POV-carrying scenes (distinct names → two lanes) + one scene whose POV
// was never set (must render no chip — the M2 unset → no chip convention).
const SCENES = [
  { id: 'sc-pov-1', title: 'Boarding',  date: '2340-01-01', pov: 'Eira', mood: 'tense' },
  { id: 'sc-pov-2', title: 'Terminus',  date: '2340-08-20', pov: 'Kael', mood: 'hopeful' },
  { id: 'sc-pov-3', title: 'Interlude', date: '2340-04-10', pov: '', mood: 'quiet' },
];

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  const sceneEntries = SCENES.map((s, idx) => ({
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
  // Manifest shape must mirror defaultManifest() in electron-main/src/vault.ts.
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

  for (const scene of SCENES) {
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
      `chronologicalIsEstimated: false`,
      `chronologicalConfidence: 1`,
      `chronologicalSource: explicit_marker`,
      `entityArcs: []`,
      // Empty pov means "unset" — omit the key so the fixture mirrors a scene
      // whose POV was never filled in.
      ...(scene.pov ? [`metaPov: ${scene.pov}`] : []),
      `metaMood: ${scene.mood}`,
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    fs.writeFileSync(scenePath, fm + scene.title + ' prose body.\n');
  }
}

/** Story timeline with books/arc/character rows so the POV row shows in its
 *  real context between CHARACTERS and WORLD (same store as the M23 suite). */
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
      { id: 'ev-late', timelineId: 'tl-story', name: 'The Last Stand', when: 800, chapter: 40 },
      { id: 'ev-world', timelineId: 'tl-story', name: 'Festival of Lanterns', when: 300, rowId: 'lane:world' },
      { id: 'ev-theme', timelineId: 'tl-story', name: 'Trust & Betrayal', when: 0, rowId: 'lane:themes' },
    ],
  };
  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify(store, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
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

test('capture: POV track lane in the Progress lanes view', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pov-cap-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pov-cap-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pov-cap-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedTimelinesStore(vaultDir);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
    if (await storiesTab.isVisible()) await storiesTab.click();
    const sceneRow = page.locator('.nav-scene-row', { hasText: SCENES[0].title }).first();
    await expect(sceneRow).toBeVisible({ timeout: 8_000 });
    await sceneRow.click();

    await activateStorySection(page);
    const timelineBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Timeline"]');
    await expect(timelineBtn).toBeVisible({ timeout: 6_000 });
    await timelineBtn.click();
    await expect(page.locator('[data-testid="timeline-root"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="view-mode-progress"]').click();
    await expect(page.locator('[data-testid="timeline-axis-view"]')).toBeVisible({ timeout: 8_000 });

    // The v0.4 → MythosVault upgrade toast covers the bottom-left corner where
    // the POV row lands — dismiss it before capturing.
    const toastDismiss = page.getByRole('button', { name: 'Not now' });
    if (await toastDismiss.isVisible().catch(() => false)) await toastDismiss.click();

    // The new POV row, with both lanes plotted and the POV-less scene chipless.
    const povRow = page.locator('[data-testid="ax-pov-row"]');
    await povRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(povRow).toHaveAttribute('data-lane-count', '2');
    await expect(page.locator('[data-testid="ax-pov-chip-sc-pov-1"]')).toHaveAttribute('data-pov', 'Eira');
    await expect(page.locator('[data-testid="ax-pov-chip-sc-pov-2"]')).toHaveAttribute('data-pov', 'Kael');
    await expect(page.locator('[data-testid="ax-pov-chip-sc-pov-3"]')).toHaveCount(0);
    await page.waitForTimeout(500); // let lane transitions settle before capture

    await page.screenshot({
      path: path.join(OUT_DIR, '1-progress-view-with-pov-row.png'),
      fullPage: false,
    });
    // Close-up: expand the row's box leftward to include the "POV · WHO TELLS
    // EACH SCENE" gutter label and vertically for neighboring-row context.
    const box = await povRow.boundingBox();
    if (!box) throw new Error('ax-pov-row has no bounding box');
    const vp = page.viewportSize() ?? { width: 1600, height: 1000 };
    const x = Math.max(0, box.x - 260);
    const y = Math.max(0, box.y - 90);
    await page.screenshot({
      path: path.join(OUT_DIR, '2-pov-row-closeup.png'),
      clip: {
        x, y,
        width: Math.min(vp.width - x, box.width + 300),
        height: Math.min(vp.height - y, box.height + 180),
      },
    });
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  }
});
