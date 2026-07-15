/**
 * writing-assistant-tips.spec.ts — SKY-1618
 *
 * E2E tests for the Writing Assistant sidebar tip card panel in Normal Mode.
 * The real `writing-assistant:scan-now` IPC is replaced with a mock that
 * returns deterministic tips, so no AI provider key is required.
 *
 *   TC-WAT-01  Scan → tip card appears; Note-it removes it optimistically
 *   TC-WAT-02  Scan → tip card appears; Ignore suppresses it within the session
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/writing-assistant-tips.spec.ts --reporter=list
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
import { clickStoryNav } from '../helpers/navGuard';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

const MOCK_TIP_TEXT = 'Vary your sentence length to improve pacing momentum.';
const MOCK_TIP_ID = 'e2e-tip-pacing-001';
const SCENE_ID = 'e2e-scene-001';
const CHAPTER_ID = 'e2e-chapter-001';
const STORY_ID = 'e2e-story-001';
const SCENE_PROSE = 'The airship docked silently. The airship docked silently. The airship docked.';

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const now = new Date().toISOString();

  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    waScanInterval: 'manual' as const,
    rightSidebarVisible: true,
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 3600,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 60,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-haiku-4-5-20251001',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 60,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 3600,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 60,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    // SKY-3177: GRS replaces RightSidebar; seed it visible with WA expanded.
    rightSidebarVisible: true,
    rightSidebarPanels: [{ id: 'writing-assistant', collapsed: false }],
  };

  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );

  // Seed a story, chapter, scene in the vault manifest so the nav tree renders.
  const storyDir = path.join(vaultDir, 'stories', 'e2e-story');
  const chapterDir = path.join(storyDir, 'e2e-chapter');
  fs.mkdirSync(chapterDir, { recursive: true });

  const scenePath = 'stories/e2e-story/e2e-chapter/e2e-scene.md';
  const sceneAbsPath = path.join(vaultDir, scenePath);
  fs.writeFileSync(sceneAbsPath, SCENE_PROSE);

  const manifest = {
    schemaVersion: 1,
    version: '1.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'E2E Test Story',
        path: 'stories/e2e-story',
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: 'stories/e2e-story/e2e-chapter',
            order: 0,
            createdAt: now,
            updatedAt: now,
            scenes: [
              {
                id: SCENE_ID,
                title: 'E2E Scene',
                path: scenePath,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  {
                    id: 'block-001',
                    type: 'prose',
                    order: 0,
                    content: SCENE_PROSE,
                    updatedAt: now,
                  },
                ],
                draftState: 'in-progress',
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [
      {
        id: SCENE_ID,
        title: 'E2E Scene',
        path: scenePath,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    chapters: [],
    provenance: [],
    boards: [],
  };

  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wat-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wat-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Replace the real scan-now handler with a mock that returns a deterministic tip.
  // The cadence is 'manual' so the auto-scheduler never fires.
  await app.evaluate(
    async ({ ipcMain }, { tipId, tipText }: { tipId: string; tipText: string }) => {
      ipcMain.removeHandler('writing-assistant:scan-now');
      ipcMain.handle('writing-assistant:scan-now', async () => {
        return {
          tips: [
            {
              id: tipId,
              text: tipText,
              category: 'pacing',
              sceneAnchor: 'E2E Scene',
            },
          ],
          scannedAt: new Date().toISOString(),
        };
      });
    },
    { tipId: MOCK_TIP_ID, tipText: MOCK_TIP_TEXT },
  );

  // Navigate to the Story tab's Editor sub-view, where the editor chrome is rendered.
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();

  // Wait for the story navigator to render — stories and chapters start expanded by default.
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 4_000 });
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 4_000 });
  await sceneRow.click();

  // Wait for scene editor to load.
  await expect(page.locator('.block-editor')).toBeVisible({ timeout: 8_000 });

  // SKY-3177: RightSidebar removed; WA panel is in GlobalRightSidebar.
  await expect(page.locator('[data-testid="global-right-sidebar"]')).toBeVisible({ timeout: 6_000 });
  const waPanel = page.locator('[data-panel-id="writing-assistant"]');
  await expect(waPanel).toBeVisible({ timeout: 4_000 });
  const waPanelHeader = waPanel.locator('[aria-label="Writing Assistant panel"]');
  if ((await waPanelHeader.getAttribute('aria-expanded')) === 'false') {
    await waPanelHeader.click();
  }

  // SKY-6228: right panel is now the agent hub — the Writing Assistant chat
  // (heartbeat/scan-now) is behind the "Writing Assistant" agent row.
  await expect(page.locator('[data-testid="agent-hub-panel"]')).toBeVisible({ timeout: 4_000 });
  await page.locator('[aria-label="Open Writing Assistant chat"]').click();
  // Wait for the WA chat view (WritingAssistantPanel) to render before tests begin.
  await expect(page.locator('[aria-label="Heartbeat panel"]')).toBeVisible({ timeout: 8_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-WAT-01: Scan → tip card appears; Note-it removes it ──────────────────

test('TC-WAT-01: manual scan returns tip card; Note-it removes it optimistically', async () => {
  // SKY-3177: GRS replaces RightSidebar; WA is a panel, not a sub-tab.
  await expect(page.locator('[data-testid="global-right-sidebar"]')).toBeVisible({ timeout: 4_000 });

  // The Writing Assistant panel heartbeat section should be visible.
  await expect(page.locator('[aria-label="Heartbeat panel"]')).toBeVisible({ timeout: 4_000 });

  // "Scan now" button should be enabled (scene is selected).
  const scanNowBtn = page.locator('.wa-scan-now');
  await expect(scanNowBtn).toBeEnabled({ timeout: 4_000 });
  await scanNowBtn.click();

  // Tip card from the mock should appear.
  const tipCard = page.locator('.tc-card').first();
  await expect(tipCard).toBeVisible({ timeout: 8_000 });
  await expect(tipCard).toContainText(MOCK_TIP_TEXT);

  // The pacing category badge should be present.
  await expect(tipCard.locator('.tc-category-badge--pacing')).toBeVisible();

  // Click "Note it" — the accept action.
  const noteBtn = tipCard.locator('.tc-btn-note');
  await noteBtn.click();

  // The tip card should disappear (optimistic removal).
  await expect(page.locator('.tc-card')).not.toBeVisible({ timeout: 4_000 });

  // The heartbeat empty state should reappear.
  await expect(page.locator('.wa-heartbeat-empty')).toBeVisible({ timeout: 4_000 });
});

// ─── TC-WAT-02: Scan → tip card appears; Ignore suppresses it ─────────────────

test('TC-WAT-02: Ignore suppresses tip card for the session', async () => {
  // TC-WAT-01's "Note it" suppressed MOCK_TIP_ID; use a fresh id so this scan
  // returns an unsuppressed tip and the Ignore flow can be tested in isolation.
  await app!.evaluate(
    async ({ ipcMain }, { tipId, tipText }: { tipId: string; tipText: string }) => {
      ipcMain.removeHandler('writing-assistant:scan-now');
      ipcMain.handle('writing-assistant:scan-now', async () => ({
        tips: [{ id: tipId, text: tipText, category: 'pacing', sceneAnchor: 'E2E Scene' }],
        scannedAt: new Date().toISOString(),
      }));
    },
    { tipId: 'e2e-tip-pacing-002', tipText: MOCK_TIP_TEXT },
  );

  // Trigger another scan to get a fresh tip card.
  const scanNowBtn = page.locator('.wa-scan-now');
  await expect(scanNowBtn).toBeEnabled({ timeout: 4_000 });
  await scanNowBtn.click();

  const tipCard = page.locator('.tc-card').first();
  await expect(tipCard).toBeVisible({ timeout: 8_000 });
  await expect(tipCard).toContainText(MOCK_TIP_TEXT);

  // Click "Ignore tip" button.
  const ignoreBtn = tipCard.locator('.tc-btn-ignore');
  await ignoreBtn.click();

  // The tip card should disappear.
  await expect(page.locator('.tc-card')).not.toBeVisible({ timeout: 4_000 });

  // Trigger another scan — the same tip (same id + sceneUpdatedAt) must stay suppressed.
  await scanNowBtn.click();
  await expect(page.locator('.wa-heartbeat-empty')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.tc-card')).not.toBeVisible();
});
