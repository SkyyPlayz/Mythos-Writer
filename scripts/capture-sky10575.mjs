/**
 * One-off screenshot capture for PR #1265 (SKY-10575 + bundled SKY-10574).
 * Mirrors the fixtures/navigation of:
 *   e2e/tests/sky10575-timeline-ai-off.spec.ts   (Timeline right panel)
 *   e2e/tests/sky10574-comments-gutter-ai-off.spec.ts (Manuscript gutter)
 * Run under xvfb: xvfb-run -a node scripts/capture-sky10575.mjs
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky10575');
fs.mkdirSync(OUT_DIR, { recursive: true });

const NOW = '2026-08-19T00:00:00.000Z';

// ─── Timeline fixture (from sky10575 spec) ────────────────────────────────────
const STORY_ID = 'story-sky10575';
const CHAPTER_ID = 'chapter-sky10575';
const SCENE_ID = 'scene-sky10575';
const TIMELINE_ID = 'tl-sky10575';

function agentCfg(extra = {}) {
  return {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000, ...extra,
  };
}

function createTimelineFixture(aiEnabled) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-10575-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-10575-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-10575-notes-'));

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
          blocks: [], createdAt: NOW, updatedAt: NOW,
        }],
        createdAt: NOW, updatedAt: NOW,
      }],
      createdAt: NOW, updatedAt: NOW,
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

  fs.writeFileSync(path.join(vaultDir, 'timelines.json'), JSON.stringify({
    schemaVersion: 1, activeTimelineId: TIMELINE_ID,
    timelines: [{
      id: TIMELINE_ID, name: 'SKY-10575 Timeline', kind: 'story', axis: 'calendar',
      calendar: { preset: 'standard', monthsPerYear: 12, daysPerMonth: 30, hoursPerDay: 24 },
      createdAt: NOW, updatedAt: NOW,
    }],
    eras: [], spans: [], rows: [],
    events: [{
      id: 'ev-sky10575', timelineId: TIMELINE_ID, name: 'Seed Event', when: 100,
      chapter: 1, pov: 'Hero', location: 'Keep',
    }],
  }, null, 2));

  return { userData, dirs: [userData, vaultDir, notesVaultDir] };
}

// ─── Manuscript gutter fixture (from sky10574 spec) ──────────────────────────
const G_STORY_ID = 'story-10574';
const G_STORY_TITLE = 'AI-Off Gutter Fixture';
const G_PROSE = 'The lantern cast a trembling circle of light across the drowned stone.';

function createGutterFixture(aiEnabled) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-10574-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Vault');
  const storyDir = path.join(bundle, 'Story Vault', G_STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });

  fs.writeFileSync(path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark', ai: { enabled: aiEnabled } }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: path.join(bundle, 'Story Vault'),
    notesVaultRoot: path.join(bundle, 'Notes Vault'),
  }, null, 2));

  fs.writeFileSync(path.join(bundle, 'mythos.json'), JSON.stringify({
    formatVersion: 2, id: 'vault-10574', name: 'SKY-10574 Vault', createdAt: NOW,
    stories: [{ id: G_STORY_ID, title: G_STORY_TITLE, folder: G_STORY_TITLE, createdAt: NOW, updatedAt: NOW }],
    seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
  }, null, 2));

  const spine = [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-10574', title: 'Chapter One' }] }];
  fs.writeFileSync(path.join(storyDir, 'book.md'), [
    '---', `id: ${G_STORY_ID}`, `title: ${G_STORY_TITLE}`,
    `createdAt: ${NOW}`, `updatedAt: ${NOW}`, '---',
    `# ${G_STORY_TITLE}`, '', '## Part 1', '',
    '- [[Part 1/Chapter 01|Chapter One]]', '',
    '<!-- mythos:spine', JSON.stringify(spine), '-->', '',
  ].join('\n'));
  fs.writeFileSync(path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-10574\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${G_PROSE}`);
  fs.writeFileSync(path.join(storyDir, 'comments.json'), `${JSON.stringify({
    version: 1,
    comments: [
      {
        id: 'c-10574-archive', storyId: G_STORY_ID, sceneId: 'scene-10574',
        anchor: 'trembling circle of light', author: 'Archive Agent', kind: 'archive',
        text: 'Continuity: this lantern is oil-lit in Ch. 1 but crystal-lit later.', createdAt: NOW,
      },
      {
        id: 'c-10574-user', storyId: G_STORY_ID, sceneId: 'scene-10574',
        anchor: 'drowned stone', author: 'You', kind: 'user',
        text: 'Great closer image.', createdAt: NOW,
      },
    ],
  }, null, 2)}\n`);

  return { userData, dirs: [tmpRoot] };
}

// ─── Shared driving helpers ───────────────────────────────────────────────────
async function launch(userData) {
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.app-menu-bar').waitFor({ timeout: 20_000 });
  return { app, page };
}

async function close(app) {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, 5_000)),
  ]);
  try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* gone */ }
}

async function dismissStoriesBackdrop(page) {
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await backdrop.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
  }
}

async function captureTimeline(aiEnabled, outName) {
  const fixture = createTimelineFixture(aiEnabled);
  let app;
  try {
    const opened = await launch(fixture.userData);
    app = opened.app;
    const page = opened.page;

    const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
    if (await storiesTab.isVisible().catch(() => false)) await storiesTab.click();
    const sceneRow = page.locator('.nav-scene-row', { hasText: 'Anchor Scene' }).first();
    await sceneRow.waitFor({ timeout: 10_000 });
    await sceneRow.click();

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.waitFor({ timeout: 10_000 });
    const storyNavBtn = nav.getByRole('button', { name: 'Story Writer', exact: true });
    if (await storyNavBtn.getAttribute('aria-current') !== 'page') await storyNavBtn.click();
    await dismissStoriesBackdrop(page);

    // Timeline is a standalone rail destination (SKY-9019/M5), not a story sub-view.
    try {
      await nav.getByRole('button', { name: 'Timeline', exact: true }).click({ timeout: 8_000 });
    } catch (err) {
      await page.screenshot({ path: path.join(OUT_DIR, `debug-${outName}`) });
      throw err;
    }
    await page.locator('[data-testid="timeline-root"]').waitFor({ timeout: 10_000 });
    await page.locator('[data-testid="timeline-right-panel"]').waitFor({ timeout: 10_000 });
    await page.locator('[data-testid="trp-tab-inspector"]').waitFor({ timeout: 8_000 });
    await page.waitForTimeout(1_000);

    await page.screenshot({ path: path.join(OUT_DIR, outName) });
    console.log(`captured ${outName} (ai=${aiEnabled})`);
  } finally {
    await close(app);
    for (const d of fixture.dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

async function captureGutter(aiEnabled, outName) {
  const fixture = createGutterFixture(aiEnabled);
  let app;
  try {
    const opened = await launch(fixture.userData);
    app = opened.app;
    const page = opened.page;

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await nav.waitFor({ timeout: 15_000 });
    const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
    if ((await storyBtn.getAttribute('aria-current')) !== 'page') await storyBtn.click();
    await dismissStoriesBackdrop(page);

    const storyRow = page.getByRole('button', { name: new RegExp(G_STORY_TITLE) }).first();
    await storyRow.waitFor({ timeout: 20_000 });
    const chapterRow = page.getByRole('button', { name: /Chapter One/ }).first();
    if (!(await chapterRow.isVisible().catch(() => false))) await storyRow.click();
    await chapterRow.waitFor({ timeout: 10_000 });
    const sceneRow = page.getByRole('button', { name: /The Gate/ }).first();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await chapterRow.click();
      try {
        await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
        break;
      } catch { /* collapsed again — retry */ }
    }
    await sceneRow.click();
    await page.locator('.ProseMirror').first().waitFor({ timeout: 15_000 });
    await page.getByTestId('msv-zoom-chapter').click();
    await page.locator('.chapter-continuous-view').waitFor({ timeout: 10_000 });
    await page.getByTestId('msv-gutter').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1_000);

    await page.screenshot({ path: path.join(OUT_DIR, outName) });
    console.log(`captured ${outName} (ai=${aiEnabled})`);
  } finally {
    await close(app);
    for (const d of fixture.dirs) fs.rmSync(d, { recursive: true, force: true });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
try {
  await captureTimeline(true, 'timeline-ai-on.png');
  await captureTimeline(false, 'timeline-ai-off.png');
  await captureGutter(true, 'gutter-ai-on.png');
  await captureGutter(false, 'gutter-ai-off.png');
  console.log('ALL_CAPTURES_DONE');
} catch (err) {
  console.error('CAPTURE_FAILED', err);
  process.exit(1);
}
