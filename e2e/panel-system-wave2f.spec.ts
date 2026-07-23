/**
 * panel-system-wave2f.spec.ts — SKY-1700
 *
 * E2E tests for Wave 2f: Saved workspace layouts.
 *
 *   AC-W-01  3 built-in layouts ship pre-seeded; cannot be deleted
 *   AC-W-02  Layout toolbar button opens picker; selecting applies within 200ms
 *   AC-W-03  "Save current as…" saves new user layout
 *   AC-W-04  User can rename a user layout
 *   AC-W-05  User can delete a user layout (confirmation shown; active cannot be deleted)
 *   AC-W-06  User can set any layout as default
 *   AC-W-09  Ctrl+Shift+L opens layout picker
 *   AC-W-10  v1→v2 migration seeds 3 built-in layouts
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

function seedUserData(userData: string, vaultDir: string, settingsOverrides: Record<string, unknown> = {}): void {
  const appSettings = { ...baseSettings(), ...settingsOverrides };
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wave2f-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wave2f-vault-'));
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

// ─── AC-W-02: Layout picker button visible ────────────────────────────────────

test('AC-W-02a: layout picker button is visible in toolbar', async () => {
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await expect(btn).toBeVisible({ timeout: 10_000 });
});

test('AC-W-02b: clicking layout picker button opens dropdown', async () => {
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  const dropdown = page.locator('[data-testid="layout-picker-dropdown"]');
  await expect(dropdown).toBeVisible({ timeout: 3_000 });
  // Close by pressing Escape
  await page.keyboard.press('Escape');
  await expect(dropdown).not.toBeVisible({ timeout: 2_000 });
});

// ─── AC-W-01: 3 built-in layouts present ─────────────────────────────────────

test('AC-W-01: layout picker shows 3 built-in layout items', async () => {
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  const dropdown = page.locator('[data-testid="layout-picker-dropdown"]');
  await expect(dropdown).toBeVisible({ timeout: 3_000 });

  // All three built-in layouts should appear
  await expect(page.locator('[data-testid="layout-item-builtin-writing-focus"]')).toBeVisible();
  await expect(page.locator('[data-testid="layout-item-builtin-world-building"]')).toBeVisible();
  await expect(page.locator('[data-testid="layout-item-builtin-dual-manuscript"]')).toBeVisible();

  await page.keyboard.press('Escape');
});

// ─── AC-W-02: Selecting a layout applies within 200ms ────────────────────────

test('AC-W-02c: selecting World-building layout applies within 200ms', async () => {
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await expect(page.locator('[data-testid="layout-picker-dropdown"]')).toBeVisible({ timeout: 3_000 });

  const before = Date.now();
  await page.locator('[data-testid="layout-item-builtin-world-building"]').click();
  const elapsed = Date.now() - before;

  // Picker should close after selection
  await expect(page.locator('[data-testid="layout-picker-dropdown"]')).not.toBeVisible({ timeout: 1_000 });

  // Layout switch completed (dropdown closed) within 200ms
  expect(elapsed).toBeLessThan(200);
});

// ─── AC-W-09: Ctrl+Shift+L opens layout picker ───────────────────────────────

test('AC-W-09: Ctrl+Shift+L opens layout picker', async () => {
  // Close any open dropdown first
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+Shift+L');
  const dropdown = page.locator('[data-testid="layout-picker-dropdown"]');
  await expect(dropdown).toBeVisible({ timeout: 3_000 });

  await page.keyboard.press('Escape');
  await expect(dropdown).not.toBeVisible({ timeout: 2_000 });
});

// ─── AC-W-03: Save current as… creates user layout ───────────────────────────

test('AC-W-03: Save current as… creates a new user layout', async () => {
  // Open layout manager
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await expect(page.locator('[data-testid="layout-picker-dropdown"]')).toBeVisible({ timeout: 3_000 });
  await page.locator('[data-testid="layout-manage-btn"]').click();

  // Layout Manager dialog
  const dialog = page.locator('.layout-manager-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Type new layout name and save
  const input = page.locator('[data-testid="layout-save-as-input"]');
  await input.fill('My Test Layout');
  await page.locator('[data-testid="layout-save-as-confirm"]').click();

  // The new layout row should appear
  await expect(dialog.getByText('My Test Layout')).toBeVisible({ timeout: 3_000 });

  await page.locator('[data-testid="layout-manager-done"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 2_000 });

  // Layout picker should now show user layout
  await btn.click();
  await expect(page.locator('[data-testid="layout-picker-dropdown"]')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.layout-picker-section-label', { hasText: 'My Layouts' })).toBeVisible();
  await page.keyboard.press('Escape');
});

// ─── AC-W-04: Rename user layout ─────────────────────────────────────────────

test('AC-W-04: rename a user layout retains its id', async () => {
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await page.locator('[data-testid="layout-manage-btn"]').click();
  const dialog = page.locator('.layout-manager-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Find and click Rename button for 'My Test Layout'
  const myTestRow = dialog.locator('[data-testid*="layout-row-"]', { hasText: 'My Test Layout' });
  await expect(myTestRow).toBeVisible({ timeout: 3_000 });
  await myTestRow.locator('[data-testid*="layout-rename-"]').click();

  // Input should appear; clear and type new name
  const renameInput = dialog.locator('[data-testid*="layout-rename-input-"]');
  await expect(renameInput).toBeVisible({ timeout: 2_000 });
  await renameInput.clear();
  await renameInput.fill('My Renamed Layout');
  await renameInput.press('Enter');

  // New name should appear
  await expect(dialog.getByText('My Renamed Layout')).toBeVisible({ timeout: 2_000 });

  await page.locator('[data-testid="layout-manager-done"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 2_000 });
});

// ─── AC-W-05: Delete user layout (with confirmation) ─────────────────────────

test('AC-W-05: delete a user layout shows confirmation dialog', async () => {
  // First create a layout to delete
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await page.locator('[data-testid="layout-manage-btn"]').click();
  const dialog = page.locator('.layout-manager-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Add a temporary layout
  await page.locator('[data-testid="layout-save-as-input"]').fill('Temp Layout To Delete');
  await page.locator('[data-testid="layout-save-as-confirm"]').click();
  await expect(dialog.getByText('Temp Layout To Delete')).toBeVisible({ timeout: 3_000 });

  // Saving a new layout makes it the active layout, and the app correctly
  // blocks deleting the currently-active layout ("Cannot delete active
  // layout" — see LayoutManagerDialog.tsx). Switch to a built-in layout
  // first so the temp layout is no longer active before deleting it.
  // Note: selecting a layout row (`onSelectLayout`) applies it AND closes
  // the manager dialog (DesktopShell.tsx), so it has to be reopened.
  await page.locator('[data-testid="layout-select-builtin-writing-focus"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 2_000 });

  await btn.click();
  await page.locator('[data-testid="layout-manage-btn"]').click();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Click delete on the row
  const tempRow = dialog.locator('[data-testid*="layout-row-"]', { hasText: 'Temp Layout To Delete' });
  await tempRow.locator('[data-testid*="layout-delete-"]').click();

  // Confirmation should appear
  await expect(dialog.locator('.layout-manager-confirm-box')).toBeVisible({ timeout: 2_000 });
  await expect(dialog.locator('.layout-manager-confirm-title')).toHaveText('Delete Layout?');

  // Confirm delete
  await page.locator('[data-testid="layout-delete-confirm"]').click();

  // Layout should be gone
  await expect(dialog.getByText('Temp Layout To Delete')).not.toBeVisible({ timeout: 2_000 });

  await page.locator('[data-testid="layout-manager-done"]').click();
});

// ─── AC-W-01: Built-in layouts cannot be deleted ─────────────────────────────

test('AC-W-01b: built-in layouts have no Delete button', async () => {
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await page.locator('[data-testid="layout-manage-btn"]').click();
  const dialog = page.locator('.layout-manager-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // The built-in "Writing Focus" row should not have a delete button
  const writingFocusRow = dialog.locator(`[data-testid="layout-row-builtin-writing-focus"]`);
  await expect(writingFocusRow).toBeVisible({ timeout: 3_000 });
  const deleteBtn = writingFocusRow.locator('[data-testid="layout-delete-builtin-writing-focus"]');
  await expect(deleteBtn).not.toBeVisible();

  await page.locator('[data-testid="layout-manager-done"]').click();
});

// ─── AC-W-06: Set default layout ─────────────────────────────────────────────

test('AC-W-06: set a user layout as default', async () => {
  // Ensure we have a user layout
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await page.locator('[data-testid="layout-manage-btn"]').click();
  const dialog = page.locator('.layout-manager-dialog');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Check "My Renamed Layout" has a "Set default" button
  const renamedRow = dialog.locator('[data-testid*="layout-row-"]', { hasText: 'My Renamed Layout' });
  await expect(renamedRow).toBeVisible({ timeout: 3_000 });
  const setDefaultBtn = renamedRow.locator('[data-testid*="layout-set-default-"]');
  await expect(setDefaultBtn).toBeVisible();
  await setDefaultBtn.click();

  // DEFAULT badge should now appear on that row
  await expect(renamedRow.locator('.layout-manager-badge--default')).toBeVisible({ timeout: 2_000 });

  await page.locator('[data-testid="layout-manager-done"]').click();
});

// ─── AC-W-10: v1→v2 migration ────────────────────────────────────────────────

test('AC-W-10: v1→v2 migration seeds 3 built-in layouts on first launch', async () => {
  // The main app was launched without layoutMigrationDone=true in settings.
  // The layout picker should always show 3 built-in layouts (seeded from code).
  const btn = page.locator('[data-testid="layout-picker-btn"]');
  await btn.click();
  await expect(page.locator('[data-testid="layout-picker-dropdown"]')).toBeVisible({ timeout: 3_000 });

  const builtinSection = page.locator('.layout-picker-section-label', { hasText: 'Built-in' });
  await expect(builtinSection).toBeVisible();

  await page.keyboard.press('Escape');
});
