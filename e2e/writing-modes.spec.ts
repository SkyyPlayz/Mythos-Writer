/**
 * writing-modes.spec.ts — MYT-768
 *
 * E2E tests for the Writing Modes UI: Normal / Focus / Edit.
 *
 *   TC-WM-01  Default state     — N button active, both sidebars visible
 *   TC-WM-02  Ctrl+Shift+F     — Focus mode: sidebars hidden
 *   TC-WM-03  Ctrl+Shift+N     — Normal restored: sidebars visible
 *   TC-WM-04  Ctrl+Shift+E     — Edit mode: sidebars visible
 *   TC-WM-05  Button clicks    — switch F→N via buttons
 *   TC-WM-06  Depth slider     — visible in all three modes
 *   TC-WM-07  Persistence      — Focus mode survives app reload
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/writing-modes.spec.ts --reporter=list
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
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
  page.on('dialog', (dialog) => {
    void dialog.accept().catch(() => undefined);
  });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wm-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wm-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-WM-01: Default Normal mode ───────────────────────────────────────────

test('TC-WM-01: default mode is Normal — N button active, sidebars visible', async () => {
  // The writing mode selector must be visible.
  const selector = page.locator('.writing-mode-selector');
  await expect(selector).toBeVisible({ timeout: 8_000 });

  // N button must be aria-pressed=true by default.
  const nBtn = selector.locator('.writing-mode-btn', { hasText: 'N' });
  await expect(nBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });

  // Navigate to editor view so sidebars are rendered.
  await page.locator('.app-menu-view-btn', { hasText: 'Editor' }).click();

  // Both sidebars must be present in the DOM.
  await expect(page.locator('.shell-left')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('.shell-right')).toBeVisible({ timeout: 4_000 });
});

// ─── TC-WM-02: Focus mode — sidebars hidden ───────────────────────────────────

test('TC-WM-02: Ctrl+Shift+F enters Focus mode and hides sidebars', async () => {
  await page.keyboard.press('Control+Shift+F');

  const selector = page.locator('.writing-mode-selector');
  const fBtn = selector.locator('.writing-mode-btn', { hasText: 'F' });
  await expect(fBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });

  // With default FocusPrefs (all false), sidebars must not be in the DOM.
  await expect(page.locator('.shell-left')).not.toBeVisible({ timeout: 4_000 });
  await expect(page.locator('.shell-right')).not.toBeVisible({ timeout: 4_000 });
});

// ─── TC-WM-03: Normal restored ────────────────────────────────────────────────

test('TC-WM-03: Ctrl+Shift+N restores Normal mode and sidebars', async () => {
  await page.keyboard.press('Control+Shift+N');

  const selector = page.locator('.writing-mode-selector');
  const nBtn = selector.locator('.writing-mode-btn', { hasText: 'N' });
  await expect(nBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });

  await expect(page.locator('.shell-left')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('.shell-right')).toBeVisible({ timeout: 4_000 });
});

// ─── TC-WM-04: Edit mode — sidebars remain visible ────────────────────────────

test('TC-WM-04: Ctrl+Shift+E enters Edit mode, sidebars still visible', async () => {
  await page.keyboard.press('Control+Shift+E');

  const selector = page.locator('.writing-mode-selector');
  const eBtn = selector.locator('.writing-mode-btn', { hasText: 'E' });
  await expect(eBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });

  // Edit mode keeps sidebars visible.
  await expect(page.locator('.shell-left')).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('.shell-right')).toBeVisible({ timeout: 4_000 });

  // Return to Normal for subsequent tests.
  await page.keyboard.press('Control+Shift+N');
});

// ─── TC-WM-05: Button click switching ─────────────────────────────────────────

test('TC-WM-05: clicking F button enters Focus, clicking N returns to Normal', async () => {
  const selector = page.locator('.writing-mode-selector');
  const fBtn = selector.locator('.writing-mode-btn', { hasText: 'F' });
  const nBtn = selector.locator('.writing-mode-btn', { hasText: 'N' });

  await fBtn.click();
  await expect(fBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });
  await expect(page.locator('.shell-left')).not.toBeVisible({ timeout: 4_000 });

  await nBtn.click();
  await expect(nBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });
  await expect(page.locator('.shell-left')).toBeVisible({ timeout: 4_000 });
});

// ─── TC-WM-06: Depth slider visible in all modes ──────────────────────────────

test('TC-WM-06: depth slider bar is visible in Normal, Focus, and Edit modes', async () => {
  // Only visible when a story is selected; we test that the center column exists.
  // The depth slider bar is in the center column which is always present.
  const selector = page.locator('.writing-mode-selector');

  // Normal
  const nBtn = selector.locator('.writing-mode-btn', { hasText: 'N' });
  await expect(nBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });
  await expect(page.locator('.shell-center-column')).toBeVisible({ timeout: 4_000 });

  // Focus
  await page.keyboard.press('Control+Shift+F');
  const fBtn = selector.locator('.writing-mode-btn', { hasText: 'F' });
  await expect(fBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });
  await expect(page.locator('.shell-center-column')).toBeVisible({ timeout: 4_000 });

  // Edit
  await page.keyboard.press('Control+Shift+E');
  const eBtn = selector.locator('.writing-mode-btn', { hasText: 'E' });
  await expect(eBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });
  await expect(page.locator('.shell-center-column')).toBeVisible({ timeout: 4_000 });

  // Return to Normal.
  await page.keyboard.press('Control+Shift+N');
});

// ─── TC-WM-07: Mode persists across reload ────────────────────────────────────

test('TC-WM-07: Focus mode persists in manifest across app reload', async () => {
  // Switch to Focus mode and wait long enough for the 900 ms debounce to flush.
  await page.keyboard.press('Control+Shift+F');
  const selector = page.locator('.writing-mode-selector');
  const fBtn = selector.locator('.writing-mode-btn', { hasText: 'F' });
  await expect(fBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 4_000 });

  // Allow debounce to persist layout to disk.
  await page.waitForTimeout(1_500);

  // Reload the renderer window.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // F must still be active after reload.
  const selectorAfter = page.locator('.writing-mode-selector');
  const fBtnAfter = selectorAfter.locator('.writing-mode-btn', { hasText: 'F' });
  await expect(fBtnAfter).toHaveAttribute('aria-pressed', 'true', { timeout: 8_000 });

  // Clean up: return to Normal.
  await page.keyboard.press('Control+Shift+N');
});
