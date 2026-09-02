/**
 * sky-11008-delete-scene-chapter.spec.ts — SKY-11008
 *
 * Real process-boundary E2E for the destructive delete-scene/delete-chapter
 * path added by SKY-10917 (StoryNavigator right-click menu -> LeftRail ->
 * DesktopShell.deleteScene/deleteChapter -> window.api.deleteVault, a real
 * on-disk file delete across the IPC boundary). PR #1305 shipped this path
 * with zero coverage; per §4a ("real E2E across the process boundary or it
 * is not done") this suite asserts the actual on-disk effect, not just DOM
 * state.
 *
 * Acceptance criteria:
 *   TC-DS-01  Delete scene   — file removed from disk, manifest updated,
 *             sibling scene untouched, open-scene selection clears.
 *   TC-DS-02  Delete chapter — chapter + all its scene files removed from
 *             disk, manifest updated, sibling chapter untouched, open-scene
 *             selection clears.
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
const STORY_TITLE = 'Delete Flow Test Vault';
const CHAPTER_A_TITLE = 'Chapter One';
const CHAPTER_B_TITLE = 'Chapter Two';
const SCENE_A1_TITLE = 'Scene Alpha';
const SCENE_A2_TITLE = 'Scene Beta';
const SCENE_B1_TITLE = 'Scene Gamma';
const SCENE_B2_TITLE = 'Scene Delta';

const STORY_ID = 'story-ds-001';
const CHAPTER_A_ID = 'chapter-ds-a';
const CHAPTER_B_ID = 'chapter-ds-b';
const SCENE_A1_ID = 'scene-ds-a1';
const SCENE_A2_ID = 'scene-ds-a2';
const SCENE_B1_ID = 'scene-ds-b1';
const SCENE_B2_ID = 'scene-ds-b2';

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

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

function scenePath(chapterTitle: string, sceneTitle: string): string {
  return path.join(STORY_TITLE, chapterTitle, `${sceneTitle}.md`).split(path.sep).join('/');
}

function sceneEntry(id: string, title: string, chapterId: string, chapterTitle: string, order: number) {
  const now = new Date().toISOString();
  return {
    id,
    title,
    path: scenePath(chapterTitle, title),
    order,
    chapterId,
    storyId: STORY_ID,
    draftState: 'in-progress',
    blocks: [
      { id: `${id}-block-0`, type: 'prose', order: 0, content: `Prose for ${title}.`, updatedAt: now },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

// Manifest seeded directly (not created via the app UI) so the fixture is
// deterministic — same rationale as global-search.spec.ts (SKY-905): raw
// .md files dropped in the vault before launch aren't auto-discovered by
// the deferred startup indexer, and the app reads its tree from
// manifest.stories[].chapters[].scenes[], not a disk scan.
function seedVaultManifest(vaultDir: string): void {
  const now = new Date().toISOString();

  const chapterA = {
    id: CHAPTER_A_ID,
    title: CHAPTER_A_TITLE,
    path: path.join(STORY_TITLE, CHAPTER_A_TITLE).split(path.sep).join('/'),
    order: 0,
    scenes: [
      sceneEntry(SCENE_A1_ID, SCENE_A1_TITLE, CHAPTER_A_ID, CHAPTER_A_TITLE, 0),
      sceneEntry(SCENE_A2_ID, SCENE_A2_TITLE, CHAPTER_A_ID, CHAPTER_A_TITLE, 1),
    ],
    createdAt: now,
    updatedAt: now,
  };

  const chapterB = {
    id: CHAPTER_B_ID,
    title: CHAPTER_B_TITLE,
    path: path.join(STORY_TITLE, CHAPTER_B_TITLE).split(path.sep).join('/'),
    order: 1,
    scenes: [
      sceneEntry(SCENE_B1_ID, SCENE_B1_TITLE, CHAPTER_B_ID, CHAPTER_B_TITLE, 0),
      sceneEntry(SCENE_B2_ID, SCENE_B2_TITLE, CHAPTER_B_ID, CHAPTER_B_TITLE, 1),
    ],
    createdAt: now,
    updatedAt: now,
  };

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    // No `parts` — isSimpleSinglePart(story) must be true so StoryNavigator
    // renders the single-part branch, the only one that wires delete
    // (see StoryNavigator.tsx SKY-10917 comment).
    stories: [
      {
        id: STORY_ID,
        title: STORY_TITLE,
        path: STORY_TITLE,
        chapters: [chapterA, chapterB],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };

  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

function writeSceneFile(vaultDir: string, id: string, chapterTitle: string, title: string): string {
  const rel = scenePath(chapterTitle, title);
  const full = path.join(vaultDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(
    full,
    `---\nid: ${id}\ntitle: "${title}"\ncreatedAt: ${new Date().toISOString()}\n---\n\nProse for ${title}.\n`,
  );
  return full;
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
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
  // deleteScene/deleteChapter gate on a real window.confirm() — auto-accept
  // it the same way writing-assistant-tips.spec.ts does for its own confirm
  // dialogs, so the destructive path actually proceeds.
  pg.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function readManifest(vaultDir: string): any {
  return JSON.parse(fs.readFileSync(path.join(vaultDir, 'manifest.json'), 'utf-8'));
}

function manifestSceneIds(manifest: any): string[] {
  return manifest.stories.flatMap((s: any) =>
    s.chapters.flatMap((c: any) => c.scenes.map((sc: any) => sc.id)));
}

function manifestChapterIds(manifest: any): string[] {
  return manifest.stories.flatMap((s: any) => s.chapters.map((c: any) => c.id));
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;
let sceneA1Path: string;
let sceneA2Path: string;
let sceneB1Path: string;
let sceneB2Path: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ds-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ds-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ds-notes-'));

  sceneA1Path = writeSceneFile(vaultDir, SCENE_A1_ID, CHAPTER_A_TITLE, SCENE_A1_TITLE);
  sceneA2Path = writeSceneFile(vaultDir, SCENE_A2_ID, CHAPTER_A_TITLE, SCENE_A2_TITLE);
  sceneB1Path = writeSceneFile(vaultDir, SCENE_B1_ID, CHAPTER_B_TITLE, SCENE_B1_TITLE);
  sceneB2Path = writeSceneFile(vaultDir, SCENE_B2_ID, CHAPTER_B_TITLE, SCENE_B2_TITLE);

  seedVaultManifest(vaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-DS-01: Delete scene ────────────────────────────────────────────────────

test('TC-DS-01: delete scene removes the file on disk, updates the manifest, leaves siblings untouched, and clears the open-scene selection', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const sceneA1Row = page.locator('.nav-scene-row', { hasText: SCENE_A1_TITLE });
  await expect(sceneA1Row).toBeVisible({ timeout: 8_000 });

  // Open the scene first so the delete also has to clear an active selection.
  await sceneA1Row.click();
  await expect(
    page.locator('.shell-editor-scene-wrap, .scene-snapshot-toolbar'),
  ).toBeVisible({ timeout: 8_000 });

  await sceneA1Row.click({ button: 'right' });
  const deleteItem = page.locator('[data-testid="menu-item-delete"]');
  await expect(deleteItem).toBeVisible({ timeout: 4_000 });
  await deleteItem.click();

  // Row leaves the tree.
  await expect(sceneA1Row).toHaveCount(0, { timeout: 8_000 });

  // Selection clears — ManuscriptView (driven by `selectedStory` + a cursor,
  // not `selectedScene` directly) must stop rendering the deleted scene's
  // content and fall back to a sibling, not keep the stale prose on screen.
  const editorPane = page.locator('.shell-editor-scene-wrap');
  await expect(editorPane).not.toContainText(`Prose for ${SCENE_A1_TITLE}.`, { timeout: 8_000 });
  await expect(editorPane).toContainText(`Prose for ${SCENE_A2_TITLE}.`, { timeout: 8_000 });

  // Real on-disk delete across the IPC boundary (window.api.deleteVault).
  const removed = await waitUntil(() => !fs.existsSync(sceneA1Path), 10_000);
  expect(removed, `${sceneA1Path} still exists after deleting Scene Alpha`).toBe(true);

  // Sibling scene in the same chapter is untouched.
  expect(fs.existsSync(sceneA2Path), 'Scene Beta file must survive deleting Scene Alpha').toBe(true);
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_A2_TITLE })).toBeVisible();

  // Manifest persisted to disk (900ms debounce) no longer references the deleted scene.
  const manifestUpdated = await waitUntil(() => {
    try {
      return !manifestSceneIds(readManifest(vaultDir)).includes(SCENE_A1_ID);
    } catch {
      return false;
    }
  }, 10_000);
  expect(manifestUpdated, 'manifest.json still references the deleted scene id').toBe(true);
  expect(manifestSceneIds(readManifest(vaultDir))).toContain(SCENE_A2_ID);
});

// ─── TC-DS-02: Delete chapter ──────────────────────────────────────────────────

test('TC-DS-02: delete chapter removes the chapter and all its scene files on disk, updates the manifest, leaves the sibling chapter untouched, and clears the open-scene selection', async () => {
  const sceneB1Row = page.locator('.nav-scene-row', { hasText: SCENE_B1_TITLE });
  await expect(sceneB1Row).toBeVisible({ timeout: 8_000 });

  // Open a scene inside the chapter being deleted, to also cover the
  // selection-clear path for deleteChapter (not just deleteScene).
  await sceneB1Row.click();
  await expect(
    page.locator('.shell-editor-scene-wrap, .scene-snapshot-toolbar'),
  ).toBeVisible({ timeout: 8_000 });

  const chapterBRow = page.locator('.nav-chapter-row', { hasText: CHAPTER_B_TITLE });
  await chapterBRow.click({ button: 'right' });
  const deleteItem = page.locator('[data-testid="menu-item-delete"]');
  await expect(deleteItem).toBeVisible({ timeout: 4_000 });
  await deleteItem.click();

  // Chapter (and, implicitly, its scene rows) leave the tree.
  await expect(chapterBRow).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator('.nav-scene-row', { hasText: SCENE_B2_TITLE })).toHaveCount(0);

  // Selection clears — same stale-`selectedStory` hazard as TC-DS-01, this
  // time via deleteChapter. The editor must stop showing the deleted
  // chapter's scene and fall back to a scene that still exists.
  const editorPane = page.locator('.shell-editor-scene-wrap');
  await expect(editorPane).not.toContainText(`Prose for ${SCENE_B1_TITLE}.`, { timeout: 8_000 });
  await expect(editorPane).toContainText(`Prose for ${SCENE_A2_TITLE}.`, { timeout: 8_000 });

  // Both scene files under the deleted chapter are actually removed from disk.
  const b1Removed = await waitUntil(() => !fs.existsSync(sceneB1Path), 10_000);
  const b2Removed = await waitUntil(() => !fs.existsSync(sceneB2Path), 10_000);
  expect(b1Removed, `${sceneB1Path} still exists after deleting Chapter Two`).toBe(true);
  expect(b2Removed, `${sceneB2Path} still exists after deleting Chapter Two`).toBe(true);

  // Sibling chapter (and its already-surviving scene) is untouched.
  expect(fs.existsSync(sceneA2Path), 'Chapter One scene must survive deleting Chapter Two').toBe(true);
  await expect(page.locator('.nav-chapter-row', { hasText: CHAPTER_A_TITLE })).toBeVisible();

  // Manifest persisted to disk no longer references the deleted chapter or its scenes.
  const manifestUpdated = await waitUntil(() => {
    try {
      const manifest = readManifest(vaultDir);
      return !manifestChapterIds(manifest).includes(CHAPTER_B_ID)
        && !manifestSceneIds(manifest).includes(SCENE_B1_ID)
        && !manifestSceneIds(manifest).includes(SCENE_B2_ID);
    } catch {
      return false;
    }
  }, 10_000);
  expect(manifestUpdated, 'manifest.json still references the deleted chapter or its scenes').toBe(true);
  const finalManifest = readManifest(vaultDir);
  expect(manifestChapterIds(finalManifest)).toContain(CHAPTER_A_ID);
  expect(manifestSceneIds(finalManifest)).toContain(SCENE_A2_ID);
});
