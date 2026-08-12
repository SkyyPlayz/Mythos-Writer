/**
 * capture-sky9022-m6-sidebars.spec.ts — SKY-9022 (not part of CI)
 *
 * One-off Playwright script to capture PR fidelity evidence (P0.3) for M6:
 * both sidebars rebuilt to the prototype spec (panel system removed). Shoots
 * the prototype and the real app side by side, at the editor default view
 * (both sidebars) and with the right sidebar's Scenes tab active. Not
 * registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky9022-m6-sidebars.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { serveProto, chromiumLaunchOptions } from './fidelity/lib.mjs';
import { chromium } from 'playwright';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky9022-m6-sidebars');
const STORY_ID = 'm6-story-0001';
const CHAPTER_ID = 'm6-chapter-0001';
const SCENE_ID = 'm6-scene-0001';

test('capture prototype sidebars (left + right, default and Scenes tab)', async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const proto = await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(3500);

  await page.screenshot({ path: path.join(OUT_DIR, '1-proto-editor-both-sidebars.png') });

  // Prototype right panel "Scenes" tab — plain text nodes, click by exact text.
  const clickText = async (label: string) => page.evaluate((lbl) => {
    const els = [...document.querySelectorAll('div,span,button,a,li')];
    const hit = els.filter((e) => {
      const t = (e as HTMLElement).innerText?.trim();
      return t === lbl && getComputedStyle(e).cursor === 'pointer';
    });
    if (!hit.length) return false;
    (hit[0] as HTMLElement).click();
    return true;
  }, label);
  await clickText('Scenes');
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(OUT_DIR, '2-proto-right-sidebar-scenes-tab.png') });

  await browser.close();
  await proto.close();
});

test('capture app sidebars (left + right, default and Scenes tab)', async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    gettingStartedProgress: { completedItems: ['write-scene', 'add-character', 'brainstorm', 'notes-vault'], dismissed: true },
    notesTabUpgradeToastShown: true, vaultUpgradePromptShown: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const now = new Date().toISOString();
  const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${SCENE_ID}.md`), '---\ntitle: "The Gate"\n---\n\nShe crossed the threshold. The city held its breath below her.\n', 'utf8');
  const manifest = {
    version: 1,
    stories: [{
      id: STORY_ID, title: 'The Last City of Veynn', genre: 'Fantasy', path: `stories/${STORY_ID}`, order: 0,
      createdAt: now, updatedAt: now,
      chapters: [{
        id: CHAPTER_ID, title: 'Chapter One', storyId: STORY_ID, order: 0,
        createdAt: now, updatedAt: now,
        scenes: [{
          id: SCENE_ID, title: 'The Gate', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
          chapterId: CHAPTER_ID, storyId: STORY_ID, order: 0,
          draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
        }],
      }],
    }],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Open the seeded scene so both sidebars render with real content.
  const storyRow = page.locator('.nav-story-row').first();
  if (await storyRow.isVisible({ timeout: 4000 }).catch(() => false)) {
    await storyRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
    await page.waitForTimeout(500);
    const chRow = page.locator('.nav-chapter-row').first();
    if (await chRow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await chRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
    }
    await page.waitForTimeout(500);
    const scene = page.locator('.nav-scene-row').first();
    if (await scene.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scene.click();
      await page.waitForTimeout(1500);
    }
  }
  await expect(page.locator('[data-testid="left-rail"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="global-right-sidebar"]')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, '3-app-editor-both-sidebars.png') });

  await page.locator('[data-testid="global-right-sidebar"]').getByRole('tab', { name: 'Scenes' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, '4-app-right-sidebar-scenes-tab.png') });

  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
