/**
 * story-import.spec.ts — #1765 "Import before release" (import hub).
 *
 * REAL end-to-end coverage for Settings → Vault & Files → "Import your
 * writing" (frontend/src/components/SettingsPanel/sections/ImportSection.tsx):
 * click "Choose a file…" → window.api.importHub.pick → native dialog → the
 * real import:pick handler (electron-main/src/importHub/importHubIpc.ts) →
 * importSafety → importDetect → buildPlan (docx → mammoth → RichBlocks →
 * chapters/scenes) → preview in the UI → click "Import" → import:commit →
 * real v2 story files (book.md + Part 1/Chapter NN/Scene NN.md), the
 * manifest cache, mythos.json, and a Story Plan note.
 *
 * The only seam faked is the native file picker. The vault is created
 * through the real vault-creation IPC (setup, not under test); the
 * manuscript is synthesized at run time from
 * electron-main/src/importHub/testFixtures/manuscriptDocx.ts — no binary
 * manuscript is committed.
 *
 * Set IMPORT_SHOTS_DIR=<dir> to also save screenshots of each step.
 */

import path from 'path';
import fs from 'fs';
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';
import { findMdFiles, openImportSection, setUpImportVault, stubOpenDialog } from './helpers/importHub';
import {
  buildHeadedManuscriptDocx,
  HEADED_MANUSCRIPT_OUTLINE,
} from '../electron-main/src/importHub/testFixtures/manuscriptDocx';

const SHOTS_DIR = process.env.IMPORT_SHOTS_DIR;

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS_DIR) return;
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
}

let app: ElectronApplication | undefined;
let page: Page;
let userData: string;
let workDir: string;
let mythosRoot: string;
let storyVaultPath: string;
let notesVaultPath: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ({ app, page, userData, workDir, mythosRoot, storyVaultPath, notesVaultPath } = await setUpImportVault('import-hub'));
});

test.afterAll(async () => {
  await closeElectronApp(app);
  removeTempDirs(userData, workDir);
});

test('pick a multi-chapter .docx → preview → import writes chapters/scenes with bold + italics', async () => {
  const outline = HEADED_MANUSCRIPT_OUTLINE;
  const docxPath = path.join(workDir, `${outline.title}.docx`);
  fs.writeFileSync(docxPath, await buildHeadedManuscriptDocx());

  const section = await openImportSection(page);
  await expect(section.getByText('Drop a file or folder here')).toBeVisible();
  await shot(page, '01-import-idle');

  await stubOpenDialog(app!, docxPath);
  await section.getByRole('button', { name: 'Choose a file…' }).click();

  // ── Preview: shown before anything is written ──
  const preview = section.locator('[data-testid="import-preview"]');
  await expect(preview).toBeVisible({ timeout: 20_000 });
  await expect(preview).toContainText(outline.title);
  await expect(preview).toContainText('Chapters found from your headings');
  for (const ch of outline.chapters) await expect(preview).toContainText(ch.title);
  const excerpt = preview.locator('[data-testid="import-excerpt"]');
  await expect(excerpt.locator('strong', { hasText: 'iron gate' })).toBeVisible();
  await expect(excerpt.locator('em', { hasText: 'lanterns' })).toBeVisible();
  await expect(excerpt).not.toContainText('**');
  await preview.scrollIntoViewIfNeeded();
  await shot(page, '02-import-preview');

  const storyDir = path.join(storyVaultPath, outline.title);
  expect(fs.existsSync(storyDir), 'preview must not write the story').toBe(false);
  const mdBefore = findMdFiles(storyVaultPath).length;

  // ── Confirm ──
  await section.locator('[data-testid="import-confirm"]').click();
  const done = section.locator('[data-testid="import-done"]');
  await expect(done).toBeVisible({ timeout: 20_000 });
  const sceneTotal = outline.chapters.reduce((n, c) => n + c.scenes.length, 0);
  await expect(done).toContainText(outline.title);
  await expect(done).toContainText(`${outline.chapters.length} chapters`);
  await expect(done).toContainText(`${sceneTotal} scenes`);
  await shot(page, '03-import-done');

  // ── Load-bearing: the REAL vault on disk ──
  expect(fs.existsSync(path.join(storyDir, 'book.md')), 'book.md missing').toBe(true);
  const sceneFiles = findMdFiles(path.join(storyDir, 'Part 1'));
  expect(sceneFiles.length).toBe(sceneTotal);
  expect(findMdFiles(storyVaultPath).length).toBe(mdBefore + sceneTotal + 1); // + book.md

  const arrival = fs.readFileSync(path.join(storyDir, 'Part 1', 'Chapter 01', 'Scene 01.md'), 'utf-8');
  expect(arrival).toContain('Arrival');
  expect(arrival).toContain('**iron gate**');
  expect(arrival).toContain('*lanterns*');
  const keeper = fs.readFileSync(path.join(storyDir, 'Part 1', 'Chapter 01', 'Scene 02.md'), 'utf-8');
  expect(keeper).toContain('***Who goes there?***');
  const allProse = sceneFiles.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
  expect(allProse).toContain('<u>never</u>');
  expect(allProse).toContain('~~closed~~');
  expect(allProse, 'an in-run page break must not glue words together').not.toContain('lowand');

  const book = fs.readFileSync(path.join(storyDir, 'book.md'), 'utf-8');
  for (const ch of outline.chapters) expect(book).toContain(ch.title);
  const mythosJson = fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8');
  expect(mythosJson).toContain(outline.title);
  const plans = findMdFiles(path.join(notesVaultPath, 'Plans'));
  expect(plans.some((p) => path.basename(p).includes(outline.title))).toBe(true);

  // The open window sees the story without a restart.
  const stories = await page.evaluate(async () => {
    const m = await (window as unknown as { api: { readManifest: () => Promise<{ stories: { title: string }[] }> } })
      .api.readManifest();
    return m.stories.map((s) => s.title);
  });
  expect(stories).toContain(outline.title);

  // ── Spot-check like a writer: close Settings, find the book in the Story
  // Navigator, open its first scene and see the formatting in the editor. ──
  await page.locator('.settings-panel-close, [aria-label="Close settings"]').first().click()
    .catch(() => page.keyboard.press('Escape'));
  await expect(page.getByText(`Scene 1 · ${outline.chapters[0].scenes[0]}`)).toBeVisible({ timeout: 10_000 });
  for (const ch of outline.chapters) await expect(page.getByText(ch.title, { exact: true }).first()).toBeVisible();
  await page.getByText(`Scene 1 · ${outline.chapters[0].scenes[0]}`).click();
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('strong', { hasText: 'iron gate' })).toBeVisible({ timeout: 10_000 });
  await expect(editor.locator('em', { hasText: 'lanterns' })).toBeVisible();
  await expect(editor.locator('u', { hasText: 'never' })).toBeVisible();
  await expect(editor.locator('s', { hasText: 'closed' })).toBeVisible();
  await shot(page, '05-imported-scene-in-editor');
});

test('a later layout save from the open window keeps the imported book (no stale-manifest overwrite)', async () => {
  const title = HEADED_MANUSCRIPT_OUTLINE.title;
  const cachePath = path.join(storyVaultPath, '.mythos', 'manifest-cache.json');
  const readCache = () => JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as {
    stories: { title: string }[]; layout?: { writingMode?: string };
  };
  expect(readCache().stories.map((s) => s.title)).toContain(title);

  // Writing-mode switches persist the layout through the renderer's own
  // manifest copy — the save that used to drop a book imported from main.
  await page.locator('[data-testid="writing-mode-focus"]').click();
  await expect.poll(() => readCache().layout?.writingMode, { timeout: 10_000 }).toBe('focus');
  await page.locator('[data-testid="writing-mode-normal"]').click();
  await expect.poll(() => readCache().layout?.writingMode, { timeout: 10_000 }).toBe('normal');

  expect(readCache().stories.map((s) => s.title)).toContain(title);
  expect(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8')).toContain(title);
});

test('a dangerous file is refused before it is read, and nothing is written', async () => {
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(512)]);
  const doubleExt = path.join(workDir, 'Chapter 1.docx.exe');
  const disguised = path.join(workDir, 'Notes.docx');
  fs.writeFileSync(doubleExt, exe);
  fs.writeFileSync(disguised, exe);

  const section = await openImportSection(page);
  const filesBefore = findMdFiles(storyVaultPath).length + findMdFiles(notesVaultPath).length;

  for (const file of [doubleExt, disguised]) {
    await stubOpenDialog(app!, file);
    await section.getByRole('button', { name: 'Choose a file…' }).click();
    await expect(section.locator('[data-testid="import-refused"]')).toBeVisible({ timeout: 10_000 });
    await expect(section.locator('[data-testid="import-preview"]')).toHaveCount(0);
  }
  await shot(page, '04-import-refused');

  expect(findMdFiles(storyVaultPath).length + findMdFiles(notesVaultPath).length).toBe(filesBefore);
});
