/**
 * capture-sky11356-chapter-note-order.spec.ts — SKY-11356 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots for the
 * chapter-note-below-heading fix: recreates the owner's repro (part note +
 * chapter note, typed through the real affordance -> edit -> commit flow) and
 * shots the Editor at book + chapter zoom next to the Book view, proving both
 * surfaces now agree on heading-first order. Not registered in package.json/CI
 * — run manually:
 *   npx playwright test e2e/capture-sky11356-chapter-note-order.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11356-chapter-note-order');
const STORY_ID = 'sky11356-story-0001';
const CHAPTER_ID = 'sky11356-chapter-0001';
const SCENE_ID = 'sky11356-scene-0001';
const PART_ID = 'sky11356-part-0001';

test('capture SKY-11356 chapter-note order screenshots (Editor vs Book view)', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11356-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11356-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11356-notes-'));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    onboardingComplete: true, theme: 'dark',
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const now = new Date().toISOString();
  const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    '---\ntitle: "The Gate"\n---\n\nShe crossed the threshold.\n',
    'utf8'
  );
  const chapter = {
    id: CHAPTER_ID, title: 'Chapter One', storyId: STORY_ID, order: 0,
    createdAt: now, updatedAt: now,
    scenes: [{
      id: SCENE_ID, title: 'The Gate', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
      chapterId: CHAPTER_ID, storyId: STORY_ID, order: 0,
      draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
    }],
  };
  // A titled part -> the story is not "simple", so the Editor renders the full
  // H1/part-note chrome the owner's screenshots show.
  const manifest = {
    version: 1,
    stories: [{
      id: STORY_ID, title: 'Chapter Note Order Demo', path: `stories/${STORY_ID}`, order: 0,
      createdAt: now, updatedAt: now,
      chapters: [chapter],
      parts: [{ id: PART_ID, title: 'Part One', order: 0, note: [], chapters: [chapter], createdAt: now, updatedAt: now }],
    }],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.setViewportSize({ width: 1440, height: 900 });

  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1000);
  await page.getByText('Scene 1 · The Gate').click();
  await page.getByTestId('msv-zoom-book').click({ timeout: 8_000 });
  await expect(page.getByTestId(`msv-h2-${CHAPTER_ID}`)).toBeVisible({ timeout: 8_000 });

  // Author both notes through the real affordance -> edit -> commit flow so
  // they persist and the Book view sees the same content (owner's repro text).
  await page.getByTestId(`msv-note-affordance-part-${PART_ID}`).click();
  const partField = page.getByTestId(`msv-note-edit-note-part-${PART_ID}`);
  await expect(partField).toBeVisible();
  await partField.click();
  await page.keyboard.type('this looks right!');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId(`msv-note-part-${PART_ID}`)).toContainText('this looks right!');

  await page.getByTestId(`msv-note-affordance-chapter-${CHAPTER_ID}`).click();
  const chapterField = page.getByTestId(`msv-note-edit-note-chapter-${CHAPTER_ID}`);
  await expect(chapterField).toBeVisible();
  await chapterField.click();
  await page.keyboard.type('and now this does too — the chapter note goes under the chapter.');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId(`msv-note-chapter-${CHAPTER_ID}`)).toContainText('goes under the chapter');

  // 1. Editor, book zoom: chapter note sits BELOW "CHAPTER 1", not orphaned
  //    above it between the part note and the heading.
  await page.screenshot({ path: path.join(OUT_DIR, '1-editor-book-zoom.png') });

  // 2. Editor, chapter zoom: same heading-first order at chapter depth (AC5).
  await page.getByTestId('msv-zoom-chapter').click();
  await expect(page.getByTestId(`msv-h2-${CHAPTER_ID}`)).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId(`msv-note-chapter-${CHAPTER_ID}`)).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, '2-editor-chapter-zoom.png') });

  // 3. Book view: the reference surface — heading then epigraph (AC4/AC6).
  await page.getByTestId('story-subview-book').click();
  const bookEpigraph = page.locator('.book-preview__epigraph--chapter');
  await expect(bookEpigraph).toBeVisible({ timeout: 8_000 });
  await expect(bookEpigraph).toContainText('goes under the chapter');
  await page.screenshot({ path: path.join(OUT_DIR, '3-book-view.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
