/**
 * smoke.spec.ts — MYT-255
 *
 * Automated smoke covering TC-01, TC-02, TC-03 from plans/SMOKE_TEST_PLAN.md:
 *   TC-01  Open vault   — app boots past onboarding into DesktopShell
 *   TC-02  Write scene  — create story → chapter → scene → type text
 *   TC-03  Save snapshot — "Save snapshot now" → autosave indicator appears
 *
 * Run:
 *   npm run build:electron          # produces out/main/main.js
 *   npx playwright install chromium # first time only
 *   npx playwright test e2e/smoke.spec.ts --reporter=list
 *
 * Requires @playwright/test in devDependencies:
 *   npm install -D @playwright/test
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

// ─── Test-suite-wide helpers ──────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

/**
 * Seed a fresh userData directory so the app boots directly into DesktopShell
 * (onboardingComplete: true) with an in-memory vault at vaultDir.
 */
function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, // disabled — no API key in CI
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };

  const vaultSettings = { vaultRoot: vaultDir };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-e2e-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-01: Open vault ────────────────────────────────────────────────────────
//
// With onboardingComplete: true pre-seeded, the app should land directly on
// the DesktopShell rather than showing the OnboardingWizard.

test('TC-01: app boots past onboarding into DesktopShell', async () => {
  // Onboarding wizard must NOT be present
  await expect(
    page.getByRole('dialog', { name: 'Onboarding wizard' }),
  ).not.toBeVisible({ timeout: 8_000 });

  // AppMenuBar is visible — confirms DesktopShell rendered
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 8_000 });

  // Brand name is rendered
  await expect(page.locator('.app-menu-brand')).toHaveText('Mythos');
});

// ─── TC-02: Write a scene ─────────────────────────────────────────────────────
//
// Creates a story → chapter → scene via the StoryNavigator, opens it in the
// BlockEditor, types a sentence, and asserts the text is in the editor.

test('TC-02: create story → chapter → scene and type text', async () => {
  // Ensure left rail is showing the Stories tab
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  // Create a new story
  await page.locator('.nav-add-btn').first().click();
  // StoryNavigator inserts a default story; wait for it to appear
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 5_000 });

  // Expand the story and add a chapter
  const chapterAddBtn = storyRow.locator('.nav-add-btn').first();
  await chapterAddBtn.click();
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 5_000 });

  // Expand the chapter and add a scene
  const sceneAddBtn = chapterRow.locator('.nav-add-btn').first();
  await sceneAddBtn.click();
  const sceneItem = page.locator('.nav-scene-row').first();
  await expect(sceneItem).toBeVisible({ timeout: 5_000 });

  // Click the scene to open it in the editor
  await sceneItem.click();

  // Wait for the BlockEditor to appear
  await expect(page.locator('.block-editor')).toBeVisible({ timeout: 8_000 });

  // TipTap mounts a contenteditable div with class ProseMirror
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 5_000 });

  // Type a sentence into the editor
  const SCENE_TEXT = 'The dragon soared over the Foundry as dawn broke.';
  await editor.click();
  await editor.type(SCENE_TEXT);

  // Confirm the text landed in the editor
  await expect(editor).toContainText(SCENE_TEXT);
});

// ─── TC-03: Save snapshot ─────────────────────────────────────────────────────
//
// Clicks "Save snapshot now" and asserts the autosave indicator updates.
// Also opens the History panel to verify a snapshot entry was recorded.

test('TC-03: save snapshot and verify in history panel', async () => {
  // The "Save snapshot now" button is in the SceneEditor toolbar.
  // It is only rendered when a scene is open (carried over from TC-02).
  const saveBtn = page.getByText('Save snapshot now');
  await expect(saveBtn).toBeVisible({ timeout: 5_000 });
  await saveBtn.click();

  // The autosave indicator should update to "Snapshot saved HH:MM:SS"
  const autosaveIndicator = page.locator('.scene-autosave');
  await expect(autosaveIndicator).toContainText('Snapshot saved', { timeout: 10_000 });

  // Open the History panel
  const historyBtn = page.locator('.btn-history').first();
  await historyBtn.click();

  // SceneHistory panel must appear with at least one snapshot listed
  const historyPanel = page.getByRole('dialog', { name: 'Scene History' });
  await expect(historyPanel).toBeVisible({ timeout: 5_000 });

  const snapshotEntries = historyPanel.locator('.history-item');
  await expect(snapshotEntries.first()).toBeVisible({ timeout: 5_000 });

  // Close the history panel
  const closeBtn = historyPanel.getByRole('button', { name: 'Close history' });
  if (await closeBtn.isVisible()) await closeBtn.click();
});
