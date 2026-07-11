/**
 * word-count.spec.ts — SKY-615 (retargeted for Beta 4 M2)
 *
 * Verifies the real-time word count surfaces. Beta 4 M2 deleted the in-editor
 * `.be-wordcount` badge — the app-level status bar (BottomBar) is the ONE stat
 * surface (FULL-SPEC §4 / GAP #10):
 *   TC-WC-01  Status-bar stats show the typed word count
 *   TC-WC-02  Navigator scene badge shows a word count
 *   TC-WC-03  Status-bar stats update when more words are typed
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'Word Count Chronicle';
const CHAPTER_TITLE = 'Opening Act';
const SCENE_TITLE = 'First Scene';
// 10 words — easily counted and verified
const PROSE_10 = 'The quick brown fox jumps over the lazy dog now';

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
  const vaultSettings = { vaultRoot: vaultDir };

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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wc-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wc-vault-'));
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Wait for the app shell to be ready
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Create story → chapter → scene via the StoryNavigator (Stories tab is default)
  await page.locator('[aria-label="New story"]').click();
  await fillPrompt(page, STORY_TITLE);

  await page.locator(`[aria-label="Add chapter"]`).first().click();
  await fillPrompt(page, CHAPTER_TITLE);

  await page.locator(`[aria-label="Add scene"]`).first().click();
  await fillPrompt(page, SCENE_TITLE);

  // Open the scene
  await page.locator('.nav-scene-row', { hasText: SCENE_TITLE }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// TC-WC-01: the app status bar shows the typed word count (Beta 4 M2: the
// in-editor badge is gone — one status bar in the DOM).
test('TC-WC-01: status bar shows word count after typing', async () => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.type(PROSE_10);

  const stats = page.locator('[data-testid="bottom-live-stats"]');
  await expect(stats).toBeVisible({ timeout: 3_000 });
  await expect(stats).toContainText('10 words', { timeout: 3_000 });
  // Regression (M2 acceptance): the deleted in-editor stat row must not return.
  await expect(page.locator('.be-wordcount')).toHaveCount(0);
});

// TC-WC-02: Navigator scene badge reflects the word count
test('TC-WC-02: navigator scene badge shows a word count for the active scene', async () => {
  // The nav-scene-row for our scene should now show a word count badge
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow.locator('.nav-wordcount')).toBeVisible({ timeout: 4_000 });
  await expect(sceneRow.locator('.nav-wordcount')).not.toBeEmpty();
});

// TC-WC-03: status-bar stats update when more words are typed
test('TC-WC-03: status bar word count updates when additional words are typed', async () => {
  const stats = page.locator('[data-testid="bottom-live-stats"]');
  const countBefore = await stats.textContent();

  const editor = page.locator('.ProseMirror');
  await editor.click();
  // Move to end and add five more words
  await editor.press('End');
  await editor.type(' one two three four five');

  // Stats should show a higher number after the editor flush
  await expect(stats).not.toHaveText(countBefore ?? '', { timeout: 3_000 });
  await expect(stats).toContainText('15 words', { timeout: 3_000 });
});
