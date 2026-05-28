/**
 * depth-slider.spec.ts — MYT-780 smoke hook
 *
 * Verifies the DepthSlider bar renders when a scene is active and that
 * depth buttons switch the editor view. Real writing-mode E2E coverage
 * lives in QA's MYT-768 spec.
 *
 *   TC-DS-01  Slider visible   — depth-slider bar renders when a scene is selected
 *   TC-DS-02  Depth switch     — clicking "Chapter" switches view to chapter outline
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/depth-slider.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const STORY_TITLE = 'Depth Slider Story';
const CHAPTER_TITLE = 'Chapter One';
const SCENE_TITLE = 'Opening Scene';

function seedUserData(userData: string, vaultDir: string): void {
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
    notesVaultRoot: path.join(vaultDir, 'notes'),
  };

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
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
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-depth-slider-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-depth-vault-'));
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Wait for shell to load and build a story → chapter → scene
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);

  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);

  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);

  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.click();
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

test('TC-DS-01: depth slider bar visible when scene is selected', async () => {
  await expect(page.locator('[data-testid="depth-slider"]')).toBeVisible({ timeout: 8_000 });

  // All three depth buttons present
  await expect(page.locator('.depth-slider-btn', { hasText: 'Full Book' })).toBeVisible();
  await expect(page.locator('.depth-slider-btn', { hasText: 'Chapter' })).toBeVisible();
  await expect(page.locator('.depth-slider-btn', { hasText: 'Scene' })).toBeVisible();
});

test('TC-DS-02: clicking Chapter depth button switches to chapter outline view', async () => {
  await page.locator('.depth-slider-btn', { hasText: 'Chapter' }).click();

  // Chapter view renders a chapter document
  await expect(page.locator('.chapter-doc-view, .chapter-outline')).toBeVisible({ timeout: 6_000 });
});
