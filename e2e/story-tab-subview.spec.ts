/**
 * story-tab-subview.spec.ts — SKY-2095
 *
 * E2E tests for Story tab sub-view bar: defaults, switching, and round-trip persistence.
 *
 *   AC-SV-01  Story tab is active by default on launch
 *   AC-SV-02  Sub-view bar is visible inside the Story tab
 *   AC-SV-03  Default sub-view is Editor (aria-selected=true)
 *   AC-SV-04  Clicking Scene Crafter switches to kanban view
 *   AC-SV-05  Switching to Notes tab then back restores Scene Crafter sub-view
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

function baseSettings() {
  return {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
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
        model: 'claude-haiku-4-5-20251001',
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
}

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = baseSettings();
  const vaultSettings = { vaultRoot: vaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-subview-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-subview-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* already exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── AC-SV-01: Story tab active by default ───────────────────────────────────

test('AC-SV-01: Story tab is active by default', async () => {
  const storyTab = page.locator('[data-testid="app-tab-story"]');
  await expect(storyTab).toBeVisible({ timeout: 10_000 });
  await expect(storyTab).toHaveAttribute('aria-selected', 'true');
});

// ─── AC-SV-02: Sub-view bar visible in Story tab ─────────────────────────────

test('AC-SV-02: Story sub-view bar is visible', async () => {
  const bar = page.locator('[data-testid="story-subview-bar"]');
  await expect(bar).toBeVisible({ timeout: 5_000 });
});

// ─── AC-SV-03: Default sub-view is Editor ────────────────────────────────────

test('AC-SV-03: Editor sub-view is selected by default', async () => {
  const editorTab = page.locator('[data-testid="story-subview-editor"]');
  await expect(editorTab).toBeVisible({ timeout: 5_000 });
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');

  const sceneTab = page.locator('[data-testid="story-subview-kanban"]');
  await expect(sceneTab).toHaveAttribute('aria-selected', 'false');
});

// ─── AC-SV-04: Clicking Scene Crafter switches sub-view ──────────────────────

test('AC-SV-04: clicking Scene Crafter switches to kanban view', async () => {
  const kanbanTab = page.locator('[data-testid="story-subview-kanban"]');
  await kanbanTab.click();
  await expect(kanbanTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

  const editorTab = page.locator('[data-testid="story-subview-editor"]');
  await expect(editorTab).toHaveAttribute('aria-selected', 'false');
});

// ─── AC-SV-05: Sub-view persists through Notes tab round-trip ────────────────

test('AC-SV-05: Scene Crafter sub-view persists after Notes tab round-trip', async () => {
  // Precondition: Scene Crafter should be active from AC-SV-04; confirm it.
  const kanbanTab = page.locator('[data-testid="story-subview-kanban"]');
  await expect(kanbanTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

  // Switch to Notes tab.
  const notesTab = page.locator('[data-testid="app-tab-notes"]');
  await notesTab.click();
  await expect(notesTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

  // Story sub-view bar should be gone while Notes tab is active.
  const bar = page.locator('[data-testid="story-subview-bar"]');
  await expect(bar).not.toBeVisible({ timeout: 2_000 });

  // Switch back to Story tab.
  const storyTab = page.locator('[data-testid="app-tab-story"]');
  await storyTab.click();
  await expect(storyTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

  // Scene Crafter sub-view should still be selected.
  await expect(bar).toBeVisible({ timeout: 3_000 });
  await expect(kanbanTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
});
