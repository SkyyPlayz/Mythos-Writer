/**
 * bg-scrim-slider.spec.ts — SKY-3220 regression
 *
 * Verifies that moving the light↔dark scrim slider in Settings → Advanced UI →
 * Background (image mode) actually updates the --bg-scrim-alpha CSS custom property
 * on the document root.
 *
 * Root cause (fixed in theme.ts): applyLiquidNeonTokens only updated --bg-scrim-alpha
 * when bgDataUrl was truthy. The SettingsPanel loads the data URL asynchronously on
 * mount, so any slider movement before that resolved (or when no file is on disk) fell
 * through to the else branch, which hardcoded --bg-scrim-alpha to '0'. The slider
 * appeared to do nothing.
 *
 * Fix: in image mode, always apply the scrim alpha (and layout tokens); only overwrite
 * --bg-app-image when a fresh data URL is available.
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

function seedUserData(
  userData: string,
  vaultDir: string,
  notesVaultDir: string,
): void {
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
    // Pre-seed bgMode=image with bgScrim=0 so the slider starts at the "Light" extreme.
    // No background file path — bgPreviewUrl will be null in the SettingsPanel, which is
    // exactly the condition that triggered the original bug.
    liquidNeon: {
      bgMode: 'image',
      bgScrim: 0,
    },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
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
  const extraArgs = process.env.CI ? ['--disable-gpu', '--no-sandbox'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-scrim-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vault-scrim-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-scrim-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
});

// ─── SKY-3220: Scrim slider visibly changes --bg-scrim-alpha ────────────────────────────
test('SKY-3220: bg scrim slider updates --bg-scrim-alpha in image mode', async () => {
  // Open settings dialog
  const settingsBtn = page.locator('button[aria-label*="ettings"], button:has-text("Settings")').first();
  await settingsBtn.click();

  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Open the Advanced UI settings popover
  const advancedBtn = dialog.locator('button:has-text("Advanced…")');
  await expect(advancedBtn).toBeVisible({ timeout: 3_000 });
  await advancedBtn.click();

  const popover = page.locator('[role="dialog"][aria-labelledby="lg-popover-title"]');
  await expect(popover).toBeVisible({ timeout: 3_000 });

  // The background mode should already be 'image' (seeded). Confirm the scrim slider is visible.
  const scrimSlider = popover.locator('input[aria-label="Background scrim light to dark"]');
  await expect(scrimSlider).toBeVisible({ timeout: 3_000 });

  // Read initial scrim alpha — bgScrim=0 → lerp(0.20, 0.85, 0) = 0.200
  const initialAlpha = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--bg-scrim-alpha').trim(),
  );
  // Allow some tolerance: may be 0 if not yet applied on startup (no real image), but
  // after our fix the seeded bgScrim=0 should produce 0.200 on settings open.
  const initialNumeric = parseFloat(initialAlpha) || 0;

  // Move slider to max (100) → lerp(0.20, 0.85, 1.0) = 0.850
  await scrimSlider.fill('100');
  await scrimSlider.dispatchEvent('input');
  await page.waitForTimeout(100);

  const darkAlpha = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--bg-scrim-alpha').trim(),
  );
  const darkNumeric = parseFloat(darkAlpha);

  expect(darkNumeric).toBeCloseTo(0.85, 1);
  expect(darkNumeric).toBeGreaterThan(initialNumeric + 0.1);

  // Move slider back to min (0) → 0.200
  await scrimSlider.fill('0');
  await scrimSlider.dispatchEvent('input');
  await page.waitForTimeout(100);

  const lightAlpha = await page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--bg-scrim-alpha').trim(),
  );
  const lightNumeric = parseFloat(lightAlpha);

  expect(lightNumeric).toBeCloseTo(0.2, 1);
  expect(lightNumeric).toBeLessThan(darkNumeric - 0.1);
});
