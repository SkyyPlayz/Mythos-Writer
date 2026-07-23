/**
 * brainstorm-scene-append.spec.ts — SKY-8007
 *
 * Real E2E for the Brainstorm → "Open in writing panel" scene-append path.
 *
 * Gap this closes: e2e/brainstorm-wave33.spec.ts (skipped entirely — see
 * test.skip(true, ...) at its top) stubbed the `scene:appendBrainstormNote`
 * IPC handler to return `{ appended: true }` in every OWP test, so the real
 * write path (electron-main/src/sceneAppendBrainstormNote.ts → db.ts's
 * upsertNote, which persists into <vaultRoot>/.mythos/state.db) was never
 * exercised end to end.
 *
 * This spec does NOT stub `scene:appendBrainstormNote` (or `vault:manifest:read`,
 * or `scene:save`). Only `stream:start` (the LLM call) is mocked, matching the
 * existing convention in brainstorm.spec.ts / brainstorm-wave33.spec.ts — no
 * real Anthropic network access is required or desired for a deterministic test.
 *
 * User path exercised:
 *   Launch real Electron app -> open Brainstorm chat -> send a prompt that
 *   yields a FACT card -> open its detail drawer -> click "Open in writing
 *   panel" -> since the idea has no linkedSceneId yet, the real scene picker
 *   opens (ask-once category routing) -> select the seeded scene -> the real
 *   IPC handler runs and appends the fact content to the scene's note ->
 *   assert the note table in the real on-disk state.db actually contains the
 *   appended content, in the documented format (first-append = raw content).
 *
 * Run (after `npm run build:electron`):
 *   DISPLAY=:99 npx playwright test e2e/brainstorm-scene-append.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'story-bst-append';
const CHAPTER_ID = 'chapter-bst-append';
const SCENE_ID = 'scene-bst-append-0001';
const SCENE_TITLE = 'Opening Scene';

const MOCK_FACT_NAME = 'Aria Voss';
const MOCK_FACT_DESC = 'A brave young sorceress who discovers her hidden powers';
const MOCK_TOKENS = [
  'Here is a character suggestion.\n\n',
  `[FACT:character|${MOCK_FACT_NAME}|${MOCK_FACT_DESC}]`,
];

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6' },
      brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001' },
      archive: { enabled: false, model: 'claude-sonnet-4-6' },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

/** Seeds a real, structure-only manifest.json + one scene .md file — the on-disk
 *  shape scene:save / vault:manifest:read expect (mirrors scene-save-perf.spec.ts). */
function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.mkdirSync(vaultDir, { recursive: true });

  const manifest = {
    schemaVersion: 2,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: 'Append Test Story',
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'Chapter 1',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: [{
          id: SCENE_ID,
          title: SCENE_TITLE,
          path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
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
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
  fs.writeFileSync(path.join(vaultDir, 'arcs.json'), JSON.stringify([]), 'utf-8');

  const scenePath = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes', `${SCENE_ID}.md`);
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  const fm = ['---', `id: ${SCENE_ID}`, `title: ${SCENE_TITLE}`, `chapterId: ${CHAPTER_ID}`, `storyId: ${STORY_ID}`, `updatedAt: ${now}`, '---', ''].join('\n');
  fs.writeFileSync(scenePath, `${fm}Once upon a time.`);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Reads the note content directly from the real on-disk state.db (electron-main/src/db.ts). */
function readNoteFromRealDb(vaultDir: string, sceneId: string): string {
  const dbPath = path.join(vaultDir, '.mythos', 'state.db');
  expect(fs.existsSync(dbPath), `Expected real state.db at ${dbPath}`).toBe(true);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT content FROM notes WHERE scene_id = ?').get(sceneId) as { content: string } | undefined;
    return row?.content ?? '';
  } finally {
    db.close();
  }
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bst-append-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bst-append-vault-'));
  seedUserData(userData, vaultDir);
  seedVault(vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Mock ONLY the LLM stream — everything else (manifest read, scene picker,
  // scene:appendBrainstormNote, state.db) is the real, unmocked implementation.
  await app!.evaluate(
    async ({ ipcMain }, tokens: string[]) => {
      ipcMain.removeHandler('stream:start');
      ipcMain.handle('stream:start', async (event) => {
        const streamId = `mock-stream-${Date.now()}`;
        void (async () => {
          for (const token of tokens) {
            await new Promise<void>((r) => setTimeout(r, 40));
            if (!event.sender.isDestroyed()) event.sender.send('stream:token', { streamId, token });
          }
          await new Promise<void>((r) => setTimeout(r, 40));
          if (!event.sender.isDestroyed()) event.sender.send('stream:end', { streamId });
        })();
        return { streamId };
      });
    },
    MOCK_TOKENS,
  );

  await page.keyboard.press('Control+3');
  await expect(page.locator('#app-tabpanel-brainstorm')).toBeVisible({ timeout: 6_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

test('SKY-8007: Open in writing panel appends real content to the real scene note on disk', async () => {
  // 1. Trigger the mock stream to get one FACT card.
  const textarea = page.locator('.brainstorm-input');
  await textarea.fill('Tell me about my main character');
  await page.locator('.brainstorm-send-btn').click();

  const factCard = page.locator('.idea-card-title', { hasText: MOCK_FACT_NAME }).first();
  await expect(factCard).toBeVisible({ timeout: 12_000 });

  // Sanity: nothing has been written to the real note table yet.
  expect(readNoteFromRealDb(vaultDir, SCENE_ID)).toBe('');

  // 2. Open the idea's detail drawer.
  await factCard.click();
  const drawer = page.locator('[data-testid="idea-detail-drawer"]');
  await expect(drawer).toBeVisible({ timeout: 6_000 });

  // 3. Click "Open in writing panel" — the idea has no linkedSceneId yet, so
  //    the real scene picker (ask-once category routing) must appear.
  const owpBtn = drawer.locator('[data-testid="idd-open-in-writing-panel"]');
  await expect(owpBtn).toBeVisible({ timeout: 4_000 });
  await owpBtn.click();

  const picker = page.locator('[data-testid="scene-picker"]');
  await expect(picker).toBeVisible({ timeout: 6_000 });

  // 4. Select the seeded scene — this fires the REAL scene:appendBrainstormNote
  //    IPC call (no stub installed anywhere in this file).
  const sceneOption = picker.getByText(SCENE_TITLE, { exact: false }).first();
  await expect(sceneOption).toBeVisible({ timeout: 4_000 });
  await sceneOption.click();

  // 5. Success navigates the writing panel to the target scene (the toast is
  //    transient and may already have auto-dismissed by the time we check).
  await expect(page.getByText(SCENE_TITLE, { exact: false }).first()).toBeVisible({ timeout: 8_000 });

  // 6. The real on-disk state.db must now contain the fact's content for this
  //    scene — proving the write crossed UI -> IPC -> main -> disk with no
  //    mock at the seam.
  await expect.poll(() => readNoteFromRealDb(vaultDir, SCENE_ID), {
    timeout: 8_000,
    message: 'Expected the real state.db notes table to contain the appended brainstorm content',
  }).toContain(MOCK_FACT_DESC);

  // 7. Confirm the exact on-disk format documented in
  //    sceneAppendBrainstormNote.ts: first append stores content directly
  //    (no leading separator, no stray whitespace).
  expect(readNoteFromRealDb(vaultDir, SCENE_ID)).toBe(MOCK_FACT_DESC);
});
