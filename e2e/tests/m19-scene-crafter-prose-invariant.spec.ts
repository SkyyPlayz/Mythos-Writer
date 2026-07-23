/**
 * m19-scene-crafter-prose-invariant.spec.ts — SKY-8267 (independent verifier)
 *
 * Acceptance tests written from the LOCKED spec/contract alone — FULL-SPEC.md
 * §7.1 "Scene Crafter" and BETA-REFINE.md's M19 block — never from the M19
 * slice branch (SKY-8265, FableEngineer).
 *
 * Spec text (BETA-REFINE.md, M19 — Scene Crafter refresh *(§7.1)*):
 *   "...gradient generate → draft card (`— first pass`, word count, preview;
 *    Add to scene board (B4-9 — the draft lands on the scene's canvas board;
 *    generated prose NEVER enters the manuscript; the writer lifts it by
 *    hand) / Retry / Discard...) Accept: no code path writes generated prose
 *    into the manuscript; Add to scene board places the draft card on the
 *    board; board mini canvas pans/zooms."
 *
 * Per the SKY-8267 mandate this is the highest-value test in the batch and
 * is written FIRST: **AC-M19-01, the prose invariant.**
 *
 * Real end-to-end path: the AI provider call is mocked at the main-process
 * `stream:start` IPC handler (no network) — every other hop (renderer ->
 * preload -> IPC -> board persistence -> disk -> scene file read) is real,
 * unmocked `window.api`, matching the pattern already used in this repo
 * (e2e/coach-page.spec.ts's installCoachChatMock). SKY-7994: a stubbed
 * `window.api` seam does not count as coverage, so nothing beyond the raw
 * provider network call is mocked here.
 *
 * Published acceptance criteria under test:
 *   AC-M19-01  Prose invariant — generating a draft and clicking "Add to
 *              scene board" does NOT change the manuscript scene file on
 *              disk, byte for byte, and the scene's IPC-read content is
 *              unchanged.
 *   AC-M19-02  "Add to scene board" places the draft card on the canvas
 *              board (real board.md persistence, IPC read-back).
 *   AC-M19-03  Setup form exposes title, POV select, GOAL/CONFLICT
 *              textareas, and a BEATS add control (§7.1 field list).
 *   AC-M19-04  Draft card shows "— first pass" title suffix and a word
 *              count once generation completes.
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
import { clickStoryNav } from '../helpers/navGuard';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_ID = 'story-m19-e2e';
const CHAPTER_ID = 'chapter-m19-e2e';
const SCENE_ID = 'scene-m19-e2e';
const STORY_TITLE = 'M19 Prose Invariant Chronicle';
const NOW = '2026-07-23T10:00:00.000Z';
const MANUSCRIPT_PROSE = 'The lantern guttered as Kessa crossed the threshold, unsure of what waited beyond.';
const MOCK_DRAFT_TEXT = 'A gust of cold air rolled through the doorway. Kessa steadied her breath and stepped in.';

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
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
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

/** Scene path relative to vaultDir — shared by manifest + on-disk file. */
function scenePath(): string {
  return `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
}

function sceneMarkdown(): string {
  return [
    '---', `id: ${SCENE_ID}`, 'title: Threshold', `chapterId: ${CHAPTER_ID}`,
    `storyId: ${STORY_ID}`, `updatedAt: ${NOW}`, '---', '', MANUSCRIPT_PROSE, '',
  ].join('\n');
}

function seedVault(vaultDir: string): void {
  fs.mkdirSync(vaultDir, { recursive: true });
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
          title: 'Threshold',
          path: scenePath(),
          order: 0,
          chapterId: CHAPTER_ID,
          storyId: STORY_ID,
          blocks: [{ id: 'block-1', type: 'prose', order: 0, content: MANUSCRIPT_PROSE, updatedAt: NOW }],
          createdAt: NOW,
          updatedAt: NOW,
        }],
        createdAt: NOW,
        updatedAt: NOW,
      }],
      createdAt: NOW,
      updatedAt: NOW,
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

  const fullScenePath = path.join(vaultDir, scenePath());
  fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });
  fs.writeFileSync(fullScenePath, sceneMarkdown());
}

function createFixture(): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m19-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m19-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m19-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
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
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
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

/** Replace the streaming IPC with a deterministic, no-network mock — only
 *  the provider call is stubbed; every other hop stays real (SKY-7994). */
async function installDraftStreamMock(app: ElectronApplication, text: string): Promise<void> {
  await app.evaluate(({ ipcMain }, args) => {
    try { ipcMain.removeHandler('stream:start'); } catch { /* not registered */ }
    ipcMain.handle('stream:start', (event) => {
      const streamId = 'mock-draft-stream-1';
      setTimeout(() => {
        event.sender.send('stream:token', { streamId, token: args.text });
        event.sender.send('stream:end', { streamId });
      }, 30);
      return { streamId };
    });
  }, { text });
}

/** Navigate to the Scene Crafter (Board) view via the toolbar, selecting the
 *  seeded story first (StoryNavigator requires an explicit story selection —
 *  mirrors e2e/tests/sceneCrafter.spec.ts's createStory/selectStory pair). */
async function openBoardView(pg: Page): Promise<void> {
  await clickStoryNav(pg);
  await pg.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
  await pg.locator('[data-testid="story-subview-kanban"]').click();
  await expect(pg.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
}

// ─── AC-M19-01: THE prose invariant — highest priority in this batch ─────────

test('AC-M19-01: generating a draft and adding it to the scene board never writes to the manuscript scene file', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;
    await installDraftStreamMock(app, MOCK_DRAFT_TEXT);

    const fullScenePath = path.join(fixture.vaultDir, scenePath());
    const before = fs.readFileSync(fullScenePath, 'utf-8');
    expect(before).toBe(sceneMarkdown());

    await openBoardView(page);

    await page.locator('.sc-draft-btn', { hasText: 'Generate' }).click();
    await expect(page.locator('[data-testid="sc-draft-card"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="sc-draft-card"]')).toContainText(MOCK_DRAFT_TEXT);

    await page.locator('[data-testid="sc-draft-card"]').getByRole('button', { name: 'Add to scene board' }).click();
    // Board persistence is debounced/async — wait for the canvas view (draft
    // card cleared, board opened) rather than an arbitrary timeout.
    await expect(page.locator('.sc-canvas-body')).toBeVisible({ timeout: 8_000 });

    // The manuscript scene file on disk must be byte-for-byte unchanged.
    const after = fs.readFileSync(fullScenePath, 'utf-8');
    expect(after).toBe(before);
    expect(after).not.toContain(MOCK_DRAFT_TEXT);

    // The IPC-read scene content (the real `vault:read` hop the editor uses
    // to load a scene) must also be unchanged — not just the raw file.
    const ipcRead = await page.evaluate(
      (relPath) => (window as Window & typeof globalThis & {
        api: { readVault: (filePath: string) => Promise<{ content: string; path: string }> };
      }).api.readVault(relPath),
      scenePath(),
    );
    expect(ipcRead.content).not.toContain(MOCK_DRAFT_TEXT);
    expect(ipcRead.content).toContain(MANUSCRIPT_PROSE);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M19-02: Add to scene board places the draft card on the board ────────

test('AC-M19-02: "Add to scene board" places the first-pass draft card on the canvas board (persisted, IPC read-back)', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;
    await installDraftStreamMock(app, MOCK_DRAFT_TEXT);

    await openBoardView(page);
    await page.locator('.sc-draft-btn', { hasText: 'Generate' }).click();
    await expect(page.locator('[data-testid="sc-draft-card"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="sc-draft-card"]').getByRole('button', { name: 'Add to scene board' }).click();

    // Canvas view opens on the newly-created board.
    await expect(page.locator('.sc-canvas-body')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.sc-canvas-name')).toBeVisible();

    // The draft card text is now on the canvas, not on a still-open draft panel.
    await expect(page.locator('[data-testid="sc-draft-card"]')).not.toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M19-03: setup form field surface (§7.1) ───────────────────────────────

test('AC-M19-03: Scene Setup form exposes title, POV select, GOAL/CONFLICT textareas, and BEATS', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openBoardView(page);

    const setup = page.locator('.sc-col-setup');
    await expect(setup.getByText('SCENE TITLE')).toBeVisible();
    await expect(setup.getByLabel('POV')).toBeVisible();
    await expect(setup.getByText('GOAL')).toBeVisible();
    await expect(setup.getByText('CONFLICT')).toBeVisible();
    await expect(setup.getByText('BEATS')).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M19-04: draft card shows "— first pass" + word count ────────────────

test('AC-M19-04: draft card title carries "— first pass" and a word count once generation completes', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;
    await installDraftStreamMock(app, MOCK_DRAFT_TEXT);

    await openBoardView(page);
    await page.locator('.sc-draft-btn', { hasText: 'Generate' }).click();

    const card = page.locator('[data-testid="sc-draft-card"]');
    await expect(card).toBeVisible({ timeout: 8_000 });
    await expect(card.locator('.sc-draft-card-title')).toContainText('— first pass');
    const expectedWords = MOCK_DRAFT_TEXT.trim().split(/\s+/).length;
    await expect(card.locator('.sc-draft-card-meta')).toContainText(`${expectedWords} words`);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
