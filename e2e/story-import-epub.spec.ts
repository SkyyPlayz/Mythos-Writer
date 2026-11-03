/**
 * story-import-epub.spec.ts — #1765 import hub, ePub branch.
 *
 * Companion to e2e/story-import.spec.ts (the .docx branch of the SAME import
 * hub). This spec drives the ePub-only code that spec never touches:
 * electron-main/src/importHub/epub.ts (ZIP → container.xml → OPF → spine →
 * XHTML → RichBlocks, dc:title as the authoritative book title).
 *
 * Full real path: click "Choose a file…" → window.api.importHub.pick →
 * import:pick → importSafety / importDetect → parseEpubStory → preview →
 * click "Import" → import:commit → real v2 story files on disk.
 *
 * The only seam faked is the native file picker. Fixture:
 * e2e/fixtures/story-import.epub (built by e2e/fixtures/build-story-import-epub.cjs).
 */

import path from 'path';
import fs from 'fs';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';
import { findMdFiles, openImportSection, setUpImportVault, stubOpenDialog } from './helpers/importHub';

const FIXTURE_EPUB = path.resolve(__dirname, 'fixtures/story-import.epub');

// Must match the OPF metadata / XHTML headings baked into the fixture.
// STORY_TITLE comes from <dc:title> — asserting it proves the OPF metadata
// was parsed and kept as the book title (the first chapter heading must not
// win over it).
const STORY_TITLE = 'The Epub Import Chronicle';
const CHAPTER_TITLES = ['The Drowned Archive', 'The Lantern Road'];
const SCENE_TITLES = ['Salt in the Stacks', 'Ferry at Dusk'];
const SCENE_PROSE_SNIPPETS = [
  'spine order survived the flood intact',
  'proving the reader walked the spine in order',
];

let app: ElectronApplication | undefined;
let page: Page;
let userData: string;
let workDir: string;
let storyVaultPath: string;

test.beforeAll(async () => {
  ({ app, page, userData, workDir, storyVaultPath } = await setUpImportVault('import-hub-epub'));
});

test.afterAll(async () => {
  await closeElectronApp(app);
  removeTempDirs(userData, workDir);
});

test('Import an ePub: preview keeps dc:title and spine order, import writes real scene files', async () => {
  expect(fs.existsSync(FIXTURE_EPUB), `missing fixture: ${FIXTURE_EPUB}`).toBe(true);

  const section = await openImportSection(page);
  await stubOpenDialog(app!, FIXTURE_EPUB);
  await section.getByRole('button', { name: 'Choose a file…' }).click();

  const preview = section.locator('[data-testid="import-preview"]');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toContainText('ePub book');
  await expect(preview).toContainText(STORY_TITLE);
  for (const title of [...CHAPTER_TITLES, ...SCENE_TITLES]) await expect(preview).toContainText(title);

  await section.locator('[data-testid="import-confirm"]').click();
  const done = section.locator('[data-testid="import-done"]');
  await expect(done).toBeVisible({ timeout: 20_000 });
  await expect(done).toContainText(STORY_TITLE);
  await expect(done).toContainText('2 chapters');

  // ── Load-bearing: the REAL vault on disk ──
  const storyDir = path.join(storyVaultPath, STORY_TITLE);
  const sceneFiles = findMdFiles(path.join(storyDir, 'Part 1'));
  expect(sceneFiles.length).toBe(SCENE_TITLES.length);
  const allText = sceneFiles.map((f) => fs.readFileSync(f, 'utf-8')).join('\n---\n');
  for (const title of SCENE_TITLES) expect(allText).toContain(title);
  for (const snippet of SCENE_PROSE_SNIPPETS) expect(allText).toContain(snippet);
  // Spine order: chapter 1 holds the first spine document's scene.
  const first = fs.readFileSync(path.join(storyDir, 'Part 1', 'Chapter 01', 'Scene 01.md'), 'utf-8');
  expect(first).toContain(SCENE_TITLES[0]);
  const book = fs.readFileSync(path.join(storyDir, 'book.md'), 'utf-8');
  for (const title of CHAPTER_TITLES) expect(book).toContain(title);
});
