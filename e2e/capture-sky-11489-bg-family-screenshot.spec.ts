/**
 * capture-sky-11489-bg-family-screenshot.spec.ts — SKY-11489 PR evidence (not part of CI)
 *
 * Visual verification for the retired dead `--bg` / `--bg-control` /
 * `--bg-control-hover` / `--bg-overlay` / `--background-primary` /
 * `--background-secondary` / `--bg-dark` orphan cluster (DesktopShell.css,
 * PageChromeToolbar.css, WritingAssistantPanel.css, DraftHistoryPanel.css).
 *
 * Opens a seeded scene so the scene-history controls (now on --bg-elevated /
 * --bg-hover) and the book outline sidebar (now on --bg-hover / --bg-active)
 * are visible, screenshots at the default Liquid Neon preset, then switches
 * to the "cyber" accent preset and re-screenshots to prove these surfaces
 * repaint instead of staying frozen on their old literal fallbacks.
 *
 * Run: xvfb-run -a npx playwright test e2e/capture-sky-11489-bg-family-screenshot.spec.ts
 * Output: docs/screenshots/sky-11489-dead-bg-family/*.png
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-11489-dead-bg-family');

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

test('capture SKY-11489 dead --bg family fix repaints on accent change', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11489-bg-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11489-bg-vault-'));

  const storyId = 'e2e-story-bg';
  const chapterId = 'e2e-chapter-bg';
  const sceneId = 'e2e-scene-bg';
  const now = new Date().toISOString();

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    gettingStartedDismissed: true, notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir,
  }, null, 2));

  const manifest = {
    version: '1',
    vaultRoot: vaultDir,
    stories: [{
      id: storyId, title: 'Dead Token Diagnostics', path: `stories/${storyId}`,
      chapters: [{
        id: chapterId, title: 'Chapter One', path: `stories/${storyId}/chapters/${chapterId}`, order: 0,
        scenes: [{
          id: sceneId, title: 'Scene One', path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
          order: 0, chapterId, storyId, draftState: 'in-progress',
          blocks: [{ id: 'b1', type: 'prose', content: 'A scene with a saved history of drafts.', order: 0, updatedAt: now }],
          createdAt: now, updatedAt: now,
        }],
        createdAt: now, updatedAt: now,
      }],
      createdAt: now, updatedAt: now,
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), [
    '---', `id: ${sceneId}`, 'title: "Scene One"', 'draftState: in-progress', `updatedAt: ${now}`, '---', '',
    'A scene with a saved history of drafts.', '',
  ].join('\n'));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  const page: Page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });

  // Open the seeded story → chapter → scene so the book outline sidebar
  // (.book-outline-scene) and scene-history controls are on screen.
  const storyRow = page.locator('.nav-story-row').first();
  if (await storyRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
    const expandStory = storyRow.locator('.nav-expand-btn, button').first();
    if (await expandStory.isVisible()) await expandStory.click({ force: true });
    await page.waitForTimeout(200);
    const chapterRow = page.locator('.nav-chapter-row').first();
    if (await chapterRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const expandChapter = chapterRow.locator('.nav-expand-btn, button').first();
      if (await expandChapter.isVisible()) await expandChapter.click({ force: true });
      await page.waitForTimeout(200);
    }
    const sceneRow = page.locator('.nav-scene-row').first();
    if (await sceneRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await sceneRow.click({ force: true });
      await page.waitForTimeout(500);
    }
  }
  await shot(page, 'default');

  // Switch to the "cyber" Liquid Neon accent preset and confirm the
  // now-fixed surfaces repaint.
  const gearBtn = page.locator('.app-menu-gear-btn');
  if (await gearBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await gearBtn.click();
    await page.waitForTimeout(500);
  }
  const appearanceTab = page.getByRole('tab', { name: /appearance/i });
  if (await appearanceTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await appearanceTab.click();
    await page.waitForTimeout(200);
  }
  const cyberPreset = page.getByTestId('lnas-preset-cyber');
  if (await cyberPreset.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await cyberPreset.click();
    await page.waitForTimeout(400);
  }
  const closeBtn = page.locator('.settings-close');
  if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(300);
  }
  await shot(page, 'cyber-accent');

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
