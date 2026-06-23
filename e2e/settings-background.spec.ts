/**
 * settings-background.spec.ts — SKY-3219 / SKY-3291
 *
 * Regression E2E for bug #612: Save must not reset the background-image setting.
 *
 * Root cause: SettingsPanel.handleSave called applyLiquidNeonTokens(lg, null)
 * when bgPreviewUrl was not yet loaded, which caused the function to fall through
 * to the `else` branch and reset --bg-app-image to the default gradient.
 *
 * The fix (theme.ts): when bgMode='image' but no bgDataUrl is supplied, the
 * applyLiquidNeonTokens function now skips the background branch entirely so
 * the existing CSS variable value is preserved.
 *
 * This test verifies the full IPC path:
 *   - stored value in app-settings.json survives a Settings open → Save round-trip
 *   - --bg-app-image CSS variable is not reset to the default gradient after Save
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

// Minimal valid 1×1 white PNG — sufficient for loadBgImage to read and return a data URL.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// The default gradient sentinel from theme.ts — if --bg-app-image contains this,
// the image was reset.
const DEFAULT_GRADIENT_MARKER = 'radial-gradient';

function seedUserData(
  userData: string,
  vaultDir: string,
  notesVaultDir: string,
  bgImagePath: string,
): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    liquidNeon: {
      background: bgImagePath,
      bgMode: 'image',
      glass: 0.5,
      blur: 0.5,
      neonIntensity: 0.5,
      neonAccent: 'cyan',
      textHeader: '#edecf6',
      textBody: '#bfd6e8',
      textMuted: '#8a9bb0',
    },
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
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
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

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let bgImagePath: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-settings-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bg-notes-'));

  // Create a real image file that loadBgImage can read.
  bgImagePath = path.join(userData, 'test-background.png');
  fs.writeFileSync(bgImagePath, PNG_1X1);

  seedUserData(userData, vaultDir, notesVaultDir, bgImagePath);

  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-SKY-3219-01: stored path survives Settings open → Save ────────────────
test('TC-SKY-3219-01: Save preserves background image path in stored settings', async () => {
  // Open Settings.
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });

  // Click Save without changing anything.
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 5_000 });

  // Close Settings.
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2_000 });

  // Verify app-settings.json still has the correct background path.
  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as {
    liquidNeon?: { background?: string; bgMode?: string };
  };
  expect(stored.liquidNeon?.background).toBe(bgImagePath);
  expect(stored.liquidNeon?.bgMode).toBe('image');
});

// ─── TC-SKY-3219-02: --bg-app-image is not reset to gradient after Save ───────
test('TC-SKY-3219-02: Save does not reset --bg-app-image CSS variable to default gradient', async () => {
  // Allow loadBgImage to finish setting up --bg-app-image on initial load.
  await page.waitForTimeout(500);

  const bgBefore = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--bg-app-image'),
  );
  // Initial load should have set the image (data URL), not the default gradient.
  expect(bgBefore).not.toContain(DEFAULT_GRADIENT_MARKER);
  expect(bgBefore).toContain('data:');

  // Open Settings and Save.
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 5_000 });

  // Close Settings.
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2_000 });

  // Allow async onSaved → loadBgImage → applyLiquidNeonTokens to complete.
  await page.waitForTimeout(500);

  const bgAfter = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--bg-app-image'),
  );
  // After save, the background must still be a data URL — not the default gradient.
  expect(bgAfter, 'background image was reset to gradient after Save (SKY-3219 regression)').not.toContain(DEFAULT_GRADIENT_MARKER);
  expect(bgAfter).toContain('data:');
});
