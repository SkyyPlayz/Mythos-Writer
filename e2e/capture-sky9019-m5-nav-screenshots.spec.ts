/**
 * capture-sky9019-m5-nav-screenshots.spec.ts — SKY-9742 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the M5 nav
 * rail/sub-tab orthogonality change (SKY-9019): drawn glyph icons replacing
 * emoji, and Vault Graph as a standalone rail destination. Not registered in
 * package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky9019-m5-nav-screenshots.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky9019-m5-nav');
const STORY_ID = 'nav5-story-0001';
const CHAPTER_ID = 'nav5-chapter-0001';
const SCENE_ID = 'nav5-scene-0001';

test('capture SKY-9019 M5 nav rail + Vault Graph screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nav5-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nav5-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nav5-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
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
  fs.writeFileSync(path.join(sceneDir, `${SCENE_ID}.md`), '---\ntitle: "The Gate"\n---\n\nShe crossed the threshold.\n', 'utf8');
  const manifest = {
    version: 1,
    stories: [{
      id: STORY_ID, title: 'Nav Rail Demo', path: `stories/${STORY_ID}`, order: 0,
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

  // A couple of cross-linked notes so the Vault Graph isn't an empty state.
  const charDir = path.join(notesVaultDir, 'Characters');
  fs.mkdirSync(charDir, { recursive: true });
  fs.writeFileSync(path.join(charDir, 'Aria Voss.md'), '# Aria Voss\n\nAllied with [[Kael Dorn]].', 'utf8');
  fs.writeFileSync(path.join(charDir, 'Kael Dorn.md'), '# Kael Dorn\n\nAllied with [[Aria Voss]].', 'utf8');

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Default nav rail on the Story tab — drawn SVG glyph icons (no emoji).
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT_DIR, '1-nav-rail-glyph-icons.png') });

  // 2. Standalone Vault Graph destination — its own top-level tab, not nested
  //    under Notes.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
  await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="vault-graph-view"], .vgv-state').first()).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT_DIR, '2-vault-graph-standalone-tab.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
