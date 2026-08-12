/**
 * story-tab-subview.spec.ts — SKY-2095, SKY-9019
 *
 * E2E tests for Story tab sub-view bar: defaults, switching, and round-trip persistence.
 *
 *   AC-SV-01  Story tab is active by default on launch
 *   AC-SV-02  Sub-view bar is visible inside the Story tab
 *   AC-SV-03  Default sub-view is Editor (aria-selected=true); exactly four tabs in strip
 *   AC-SV-04  Clicking Scene Crafter RAIL item switches to kanban view; sub-view bar hidden
 *             (SKY-9019/M5: Scene Crafter is a rail destination, no longer a sub-tab)
 *   AC-SV-05  Story Writer rail click after a Notes round-trip lands on the
 *             editor (Beta 4 M3 — Scene Crafter has its own rail module now)
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
import { clickStoryNav } from './helpers/navGuard';

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
  const storyTab = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
  await expect(storyTab).toBeVisible({ timeout: 10_000 });
  await expect(storyTab).toHaveAttribute('aria-current', 'page');
});

// ─── AC-SV-02: Sub-view bar visible in Story tab ─────────────────────────────

test('AC-SV-02: Story sub-view bar is visible', async () => {
  const bar = page.locator('[data-testid="story-subview-bar"]');
  await expect(bar).toBeVisible({ timeout: 5_000 });
});

// ─── AC-SV-03: Default sub-view is Editor; exactly four tabs ─────────────────
// SKY-9019/M5: Scene Crafter and Timeline are rail destinations only —
// exactly four tabs remain in the strip: Editor, Coach, Structure, Book.

test('AC-SV-03: Editor sub-view is selected by default; strip has exactly four tabs', async () => {
  const editorTab = page.locator('[data-testid="story-subview-editor"]');
  await expect(editorTab).toBeVisible({ timeout: 5_000 });
  await expect(editorTab).toHaveAttribute('aria-selected', 'true');

  // Exactly four tabs — Scene Crafter and Timeline removed from strip.
  const allTabs = page.locator('[data-testid="story-subview-bar"] [role="tab"]');
  await expect(allTabs).toHaveCount(4);

  // Scene Crafter and Timeline must NOT be in the sub-tab strip (rail only).
  await expect(page.locator('[data-testid="story-subview-kanban"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="story-subview-timeline"]')).toHaveCount(0);
});

// ─── AC-SV-04: Scene Crafter rail item switches to kanban; sub-view bar hidden ──
// SKY-9019/M5: Scene Crafter is a standalone rail destination.
// Clicking it navigates to the kanban canvas; the story sub-view bar is hidden
// because kanban has no sub-tabs of its own.

test('AC-SV-04: clicking Scene Crafter RAIL item switches to kanban; sub-view bar hidden', async () => {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const sceneCrafterRailBtn = nav.locator('button[aria-label="Scene Crafter"]');
  await expect(sceneCrafterRailBtn).toBeVisible({ timeout: 5_000 });
  await sceneCrafterRailBtn.click();

  // Kanban content renders.
  await expect(page.locator('.shell-kanban')).toBeVisible({ timeout: 5_000 });

  // Sub-view bar is hidden when on a rail-only destination.
  await expect(page.locator('[data-testid="story-subview-bar"]')).not.toBeVisible({ timeout: 3_000 });
});

// ─── AC-SV-05: Story Writer rail click lands on the editor (Beta 4 M3) ───────
// Scene Crafter has its own rail module now (BETA-REFINE M3 / FULL-SPEC §4),
// so clicking the Story Writer rail item after a Notes round-trip lands on
// the EDITOR sub-view — kanban no longer piggybacks on the Story restore.

test('AC-SV-05: Story Writer rail click lands on the editor after a Notes round-trip', async () => {
  // Precondition: Scene Crafter should be active from AC-SV-04; confirm kanban content visible.
  await expect(page.locator('.shell-kanban')).toBeVisible({ timeout: 3_000 });

  // Switch to Notes tab.
  const notesTab = page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]');
  await notesTab.click();
  await expect(notesTab).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });

  // Story sub-view bar should be gone while Notes tab is active.
  const bar = page.locator('[data-testid="story-subview-bar"]');
  await expect(bar).not.toBeVisible({ timeout: 2_000 });

  // Switch back via the Story Writer rail item.
  const storyTab = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
  await clickStoryNav(page);
  await expect(storyTab).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });

  // Story Writer is the editor module — the editor sub-view is selected and bar is visible.
  await expect(bar).toBeVisible({ timeout: 3_000 });
  const editorTab = page.locator('[data-testid="story-subview-editor"]');
  await expect(editorTab).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
});
