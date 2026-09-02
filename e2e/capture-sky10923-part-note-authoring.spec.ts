/**
 * capture-sky10923-part-note-authoring.spec.ts — SKY-10923 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the M2
 * Part/note authoring fix: the "+ Part" flow and the new note-slot editing
 * UI (empty affordance -> editable field -> committed epigraph). Not
 * registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky10923-part-note-authoring.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10923-part-note-authoring');
const STORY_ID = 'sky10923-story-0001';
const CHAPTER_ID = 'sky10923-chapter-0001';
const SCENE_ID = 'sky10923-scene-0001';
const PART_ID = 'sky10923-part-0001';

test('capture SKY-10923 Part/note authoring screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10923-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10923-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10923-notes-'));

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
  const manifest = {
    version: 1,
    stories: [{
      id: STORY_ID, title: 'Part/Note Authoring Demo', path: `stories/${STORY_ID}`, order: 0,
      createdAt: now, updatedAt: now,
      chapters: [chapter],
      parts: [{ id: PART_ID, title: '', order: 0, note: [], chapters: [chapter], createdAt: now, updatedAt: now }],
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

  // Boot lands on the "select a scene" empty state (no lastOpenedScene) —
  // select the seeded scene, then step out to book zoom, the depth where
  // the H1/H2/note-slot chrome (and the +Part / note affordances) render
  // (scene zoom shows the block editor instead).
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1000);
  await page.getByText('Scene 1 · The Gate').click();
  const bookZoomBtn = page.getByTestId('msv-zoom-book');
  await bookZoomBtn.click({ timeout: 8_000 });
  await expect(page.getByTestId(`msv-h2-${CHAPTER_ID}`)).toBeVisible({ timeout: 8_000 });

  // 1. Empty chapter-note affordance.
  const affordance = page.getByTestId(`msv-note-affordance-chapter-${CHAPTER_ID}`);
  await expect(affordance).toBeVisible();
  await affordance.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT_DIR, '1-chapter-note-affordance.png') });

  // 2. Click it open, type text — the editable field, nothing persisted yet.
  await affordance.click();
  const field = page.getByTestId(`msv-note-edit-note-chapter-${CHAPTER_ID}`);
  await expect(field).toBeVisible();
  await field.click();
  await page.keyboard.type('A storm was coming, and no one in the city noticed.');
  await page.screenshot({ path: path.join(OUT_DIR, '2-chapter-note-editing.png') });

  // 3. Commit (blur) — the epigraph renders, the affordance is gone.
  await page.keyboard.press('Tab');
  const epigraph = page.getByTestId(`msv-note-chapter-${CHAPTER_ID}`);
  await expect(epigraph).toBeVisible();
  await expect(epigraph).toContainText('A storm was coming');
  await page.screenshot({ path: path.join(OUT_DIR, '3-chapter-note-committed.png') });

  // 4. "+ Part" — titles the still-implicit first part, promoting the story
  // out of the single-implicit-part shape (proof the H1/Part chrome + the
  // pre-existing chapter both survive the reconcileParts self-heal).
  await page.getByTestId('msv-add-part').click();
  const promptInput = page.locator('.prompt-modal-input');
  await expect(promptInput).toBeVisible({ timeout: 5_000 });
  await promptInput.fill('Part One: The Awakening');
  await promptInput.press('Enter');
  await expect(page.getByTestId(`msv-h1-${PART_ID}`)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId(`msv-h1-${PART_ID}`)).toContainText('Part One: The Awakening');
  await expect(page.getByTestId(`msv-h2-${CHAPTER_ID}`)).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, '4-part-titled-chapter-preserved.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
