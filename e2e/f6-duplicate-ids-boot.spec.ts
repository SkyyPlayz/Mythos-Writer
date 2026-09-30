/**
 * e2e/f6-duplicate-ids-boot.spec.ts — F6 (v0.5.7 blocker)
 *
 * Real base bug on main `1b019661`: Finder-copied stories share story/chapter/
 * scene IDs, so the copy's scene cannot be opened as its own document (selection
 * bleed / unreachable copy prose). This is NOT a reliable "hang / no render"
 * failure — Shield saw case (a) miss only the disk write-back check and case (b)
 * stay green on main when the suite only asserted nav labels.
 *
 * This tip: open BOTH scenes and assert each shows its own prose token.
 * Expected:
 *   - RED on main `1b019661` (copy scene prose unreachable / wrong id)
 *   - RED on this tip with the `main.ts` boot-check call removed (case b / c)
 *   - GREEN on this tip with boot check + scan dedupe
 *
 * Cases:
 *   (a) copy story folder → delete manifest-cache → launch → both scenes open
 *   (b) launch with pre-built duplicate cache → boot rebuild → both scenes open
 *   (c) warm clean cache → `cp -r` Finder-copy → launch → both scenes open (Probe H4)
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/f6-duplicate-ids-boot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const RENDER_TIMEOUT_MS = 45_000;
const STORY = 'The Last City of Veynn';
const COPY = `${STORY} copy`;
const NOW = '2026-01-01T00:00:00.000Z';
const SHARED_STORY_ID = 'f6-shared-story-id';
const SHARED_CH_ID = 'f6-shared-chapter-id';
const SHARED_SCENE_ID = 'f6-shared-scene-id';
const ORIG_PROSE = 'ORIGINAL-PROSE-F6-UNIQUE-TOKEN';
const COPY_PROSE = 'COPY-PROSE-F6-UNIQUE-TOKEN';
const ORIG_SCENE_TITLE = 'Opening Original';
const COPY_SCENE_TITLE = 'Opening Copy';

test.setTimeout(180_000);

function seedUserData(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function expectAppRenders(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({
    timeout: RENDER_TIMEOUT_MS,
  });
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  await expect(storyBtn).toBeVisible({ timeout: 15_000 });
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
}

/** Expand a story row, then open its scene and assert prose. */
async function openStorySceneAndAssertProse(
  page: Page,
  storyFolder: string,
  sceneTitle: string,
  prose: string,
): Promise<void> {
  // Story buttons use accessible name "▾ <folder>" — exact folder match so STORY
  // does not also match `${STORY} copy`.
  const storyBtn = page
    .getByRole('button', { name: new RegExp(`^▾\\s*${escapeRegExp(storyFolder)}$`) })
    .first();
  await expect(storyBtn).toBeVisible({ timeout: 20_000 });
  const expanded = await storyBtn.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await storyBtn.click();
  }
  // Scene rows: aria-label starts with the frontmatter title.
  const sceneRow = page.locator(`.nav-scene-row[aria-label^="${cssEscape(sceneTitle)}"]`).first();
  await expect(sceneRow).toBeVisible({ timeout: 15_000 });
  await sceneRow.click();
  const editor = page.locator('.ProseMirror').first();
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByText(prose, { exact: false })).toBeVisible({ timeout: 15_000 });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

function writeStoryFolder(
  storyVault: string,
  folder: string,
  prose: string,
  sceneTitle: string,
  ids: { storyId: string; chapterId: string; sceneId: string },
): void {
  const chapterDir = path.join(storyVault, folder, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  const spine = [
    {
      dir: 'Part 1',
      chapters: [{ dir: 'Chapter 01', id: ids.chapterId, title: 'Chapter One' }],
    },
  ];
  fs.writeFileSync(
    path.join(storyVault, folder, 'book.md'),
    [
      '---',
      `id: ${ids.storyId}`,
      `title: ${folder}`,
      `createdAt: ${NOW}`,
      `updatedAt: ${NOW}`,
      '---',
      `# ${folder}`,
      '',
      '<!-- mythos:spine',
      JSON.stringify(spine),
      '-->',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    [
      '---',
      `id: ${ids.sceneId}`,
      `title: ${sceneTitle}`,
      'status: draft',
      `updatedAt: ${NOW}`,
      '---',
      prose,
      '',
    ].join('\n'),
  );
}

/** Minimal MythosVault v2 with a Finder-copied story sharing all ids. */
function seedDuplicateV2Vault(bundle: string): {
  storyVault: string;
  notesVault: string;
} {
  const storyVault = path.join(bundle, 'Stories', 'Story Vault');
  const notesVault = path.join(bundle, 'Notes', 'Notes Vault');
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Agent Vault'), { recursive: true });
  fs.mkdirSync(path.join(bundle, '.mythos'), { recursive: true });

  const vaultId = crypto.randomUUID();
  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify(
      {
        formatVersion: 2,
        id: vaultId,
        name: 'F6 E2E',
        createdAt: NOW,
        updatedAt: NOW,
        stories: [
          {
            id: SHARED_STORY_ID,
            title: STORY,
            folder: STORY,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        seed: { layout: 'blank@M5', mode: 'blank', seededAt: NOW },
      },
      null,
      2,
    ),
  );
  const storyEntryId = crypto.randomUUID();
  const notesEntryId = crypto.randomUUID();
  fs.writeFileSync(
    path.join(bundle, 'story-vaults.json'),
    JSON.stringify(
      {
        version: 1,
        vaults: [
          {
            id: storyEntryId,
            displayName: 'Story',
            dirName: 'Stories/Story Vault',
            createdAt: NOW,
            pairedNotesVaultId: null,
          },
        ],
        activeId: storyEntryId,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(bundle, 'notes-vaults.json'),
    JSON.stringify(
      {
        version: 1,
        vaults: [
          {
            id: notesEntryId,
            displayName: 'Notes',
            dirName: 'Notes/Notes Vault',
            createdAt: NOW,
            origin: 'created',
          },
        ],
        activeId: notesEntryId,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(bundle, 'settings.json'),
    JSON.stringify({ version: 1 }, null, 2),
  );
  fs.writeFileSync(
    path.join(bundle, 'timelines.json'),
    JSON.stringify({ version: 1, timelines: [], events: [], eras: [], spans: [] }, null, 2),
  );

  const sharedIds = {
    storyId: SHARED_STORY_ID,
    chapterId: SHARED_CH_ID,
    sceneId: SHARED_SCENE_ID,
  };
  writeStoryFolder(storyVault, STORY, ORIG_PROSE, ORIG_SCENE_TITLE, sharedIds);
  writeStoryFolder(storyVault, COPY, COPY_PROSE, COPY_SCENE_TITLE, sharedIds);

  return { storyVault, notesVault };
}

function writePoisonedCache(storyVault: string): void {
  const cachePath = path.join(storyVault, '.mythos', 'manifest-cache.json');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const scene = (folder: string, title: string, prose: string) => ({
    id: SHARED_SCENE_ID,
    title,
    path: `${folder}/Part 1/Chapter 01/Scene 01.md`,
    order: 0,
    chapterId: SHARED_CH_ID,
    storyId: SHARED_STORY_ID,
    blocks: [
      {
        id: `block-${SHARED_SCENE_ID}`,
        type: 'prose',
        order: 0,
        content: prose,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
  const chapter = (folder: string, title: string, prose: string) => ({
    id: SHARED_CH_ID,
    title: 'Chapter One',
    path: `${folder}/Part 1/Chapter 01`,
    order: 0,
    scenes: [scene(folder, title, prose)],
    createdAt: NOW,
    updatedAt: NOW,
  });
  const manifest = {
    schemaVersion: 3,
    version: '2.0.0',
    vaultRoot: storyVault,
    stories: [
      {
        id: SHARED_STORY_ID,
        title: STORY,
        path: STORY,
        chapters: [chapter(STORY, ORIG_SCENE_TITLE, ORIG_PROSE)],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: SHARED_STORY_ID,
        title: COPY,
        path: COPY,
        chapters: [chapter(COPY, COPY_SCENE_TITLE, COPY_PROSE)],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [
      scene(STORY, ORIG_SCENE_TITLE, ORIG_PROSE),
      scene(COPY, COPY_SCENE_TITLE, COPY_PROSE),
    ],
    chapters: [
      chapter(STORY, ORIG_SCENE_TITLE, ORIG_PROSE),
      chapter(COPY, COPY_SCENE_TITLE, COPY_PROSE),
    ],
    provenance: {},
    boardReferences: [],
  };
  fs.writeFileSync(cachePath, JSON.stringify(manifest, null, 2));
}

/** Warm clean cache for a single-story vault (no duplicates). */
function writeWarmSingleStoryCache(storyVault: string): void {
  const cachePath = path.join(storyVault, '.mythos', 'manifest-cache.json');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const scene = {
    id: SHARED_SCENE_ID,
    title: ORIG_SCENE_TITLE,
    path: `${STORY}/Part 1/Chapter 01/Scene 01.md`,
    order: 0,
    chapterId: SHARED_CH_ID,
    storyId: SHARED_STORY_ID,
    blocks: [
      {
        id: `block-${SHARED_SCENE_ID}`,
        type: 'prose',
        order: 0,
        content: ORIG_PROSE,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const chapter = {
    id: SHARED_CH_ID,
    title: 'Chapter One',
    path: `${STORY}/Part 1/Chapter 01`,
    order: 0,
    scenes: [scene],
    createdAt: NOW,
    updatedAt: NOW,
  };
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        schemaVersion: 3,
        version: '2.0.0',
        vaultRoot: storyVault,
        stories: [
          {
            id: SHARED_STORY_ID,
            title: STORY,
            path: STORY,
            chapters: [chapter],
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        entities: [],
        suggestions: [],
        scenes: [scene],
        chapters: [chapter],
        provenance: {},
        boardReferences: [],
      },
      null,
      2,
    ),
  );
}

test.describe('F6 duplicate ID boot hang', () => {
  const temps: string[] = [];

  test.afterEach(async () => {
    await removeTempDirs(...temps.splice(0));
  });

  test('(a) cache delete → both scenes show distinct prose; copy book re-IDed', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-e2e-a-'));
    temps.push(tmp);
    const userData = path.join(tmp, 'user-data');
    const bundle = path.join(tmp, 'vault');
    const { storyVault, notesVault } = seedDuplicateV2Vault(bundle);
    fs.rmSync(path.join(storyVault, '.mythos'), { recursive: true, force: true });

    seedUserData(userData, storyVault, notesVault);
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expectAppRenders(page);
      await openStorySceneAndAssertProse(page, STORY, ORIG_SCENE_TITLE, ORIG_PROSE);
      await openStorySceneAndAssertProse(page, COPY, COPY_SCENE_TITLE, COPY_PROSE);
    } finally {
      await closeElectronApp(app);
    }

    // Disk write-back: copy book id must differ from original.
    const origBook = fs.readFileSync(path.join(storyVault, STORY, 'book.md'), 'utf-8');
    const copyBook = fs.readFileSync(path.join(storyVault, COPY, 'book.md'), 'utf-8');
    expect(origBook).toContain(`id: ${SHARED_STORY_ID}`);
    expect(copyBook).not.toContain(`id: ${SHARED_STORY_ID}`);
  });

  test('(b) poisoned cache → boot rebuild → both scenes show distinct prose', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-e2e-b-'));
    temps.push(tmp);
    const userData = path.join(tmp, 'user-data');
    const bundle = path.join(tmp, 'vault');
    const { storyVault, notesVault } = seedDuplicateV2Vault(bundle);
    writePoisonedCache(storyVault);

    seedUserData(userData, storyVault, notesVault);
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expectAppRenders(page);
      await openStorySceneAndAssertProse(page, STORY, ORIG_SCENE_TITLE, ORIG_PROSE);
      await openStorySceneAndAssertProse(page, COPY, COPY_SCENE_TITLE, COPY_PROSE);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('(c) warm cache + cp -r → boot rescan shows both stories with own prose', async () => {
    // Probe H4: normal Finder-copy after vault already opened (warm clean cache).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f6-e2e-c-'));
    temps.push(tmp);
    const userData = path.join(tmp, 'user-data');
    const bundle = path.join(tmp, 'vault');
    // Seed single story only, then warm cache, THEN Finder-copy.
    const { storyVault: sv, notesVault: nv } = seedDuplicateV2Vault(bundle);
    // Remove the pre-seeded copy — case (c) creates it after warm cache.
    fs.rmSync(path.join(sv, COPY), { recursive: true, force: true });
    writeWarmSingleStoryCache(sv);

    fs.cpSync(path.join(sv, STORY), path.join(sv, COPY), { recursive: true });
    // Distinct prose + scene title on the copy (shared ids until boot dedupe).
    const copyScenePath = path.join(sv, COPY, 'Part 1', 'Chapter 01', 'Scene 01.md');
    fs.writeFileSync(
      copyScenePath,
      [
        '---',
        `id: ${SHARED_SCENE_ID}`,
        `title: ${COPY_SCENE_TITLE}`,
        'status: draft',
        `updatedAt: ${NOW}`,
        '---',
        COPY_PROSE,
        '',
      ].join('\n'),
    );
    // Shared story/chapter ids (Finder-copy fidelity) but distinct display title
    // so the navigator can address each story without substring collisions.
    const origBook = fs.readFileSync(path.join(sv, STORY, 'book.md'), 'utf-8');
    fs.writeFileSync(
      path.join(sv, COPY, 'book.md'),
      origBook.replace(`title: ${STORY}`, `title: ${COPY}`).replace(`# ${STORY}`, `# ${COPY}`),
    );

    seedUserData(userData, sv, nv);
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expectAppRenders(page);
      await openStorySceneAndAssertProse(page, STORY, ORIG_SCENE_TITLE, ORIG_PROSE);
      await openStorySceneAndAssertProse(page, COPY, COPY_SCENE_TITLE, COPY_PROSE);
    } finally {
      await closeElectronApp(app);
    }

    // Relaunch: both stories still show with distinct prose (ids stable).
    const app2 = await launchApp(userData);
    try {
      const page = await app2.firstWindow();
      await expectAppRenders(page);
      await openStorySceneAndAssertProse(page, STORY, ORIG_SCENE_TITLE, ORIG_PROSE);
      await openStorySceneAndAssertProse(page, COPY, COPY_SCENE_TITLE, COPY_PROSE);
    } finally {
      await closeElectronApp(app2);
    }
  });
});
