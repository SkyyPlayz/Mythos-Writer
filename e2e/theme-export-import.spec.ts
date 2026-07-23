/**
 * theme-export-import.spec.ts — FULL-SPEC §14 item 9
 *
 * Real e2e round-trip for the Liquid Neon theme preset export/import feature
 * (Settings → Appearance → Color theme card,
 * frontend/src/components/SettingsPanel/sections/LiquidNeonAppearanceSection.tsx):
 *
 *   1. Select a non-default preset (Cyberpunk) — live-applies --n1 on <html>.
 *   2. Export it — downloads a real mythos-theme-preset.json file (captured
 *      via Playwright's download event).
 *   3. Switch to a different preset (Neon Classic) to prove the state actually
 *      changed away from Cyberpunk.
 *   4. File-import — feed the downloaded JSON back in via the hidden
 *      lnas-import-file input and re-apply the preset.
 *   5. Assert the Cyberpunk preset is selected again and --n1 matches its
 *      first slot color, proving the export → import round-trip is lossless.
 *
 * Uses the file-import path rather than "Paste" (clipboard-read): this app's
 * session denies every permission except 'media'
 * (electron-main/src/main.ts setPermissionRequestHandler), so
 * navigator.clipboard.readText() always resolves empty here — that's a real
 * product constraint, not a test artifact. See PR description.
 *
 * No IPC mocks: this exercises the real UI → filesystem → UI path, no
 * window.api stubbing.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/theme-export-import.spec.ts --reporter=list
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

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
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
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function readNeonVar(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--n1').trim());
}

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-theme-io-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-theme-io-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-theme-io-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
});

test('theme preset export → clipboard → import round-trips the selected preset', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Open Settings and go to the Appearance category.
  const settingsBtn = page.locator('button[aria-label*="ettings"], button:has-text("Settings")').first();
  await settingsBtn.click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  const appearanceTab = dialog.locator('.settings-cat-nav [role="tab"]', { hasText: 'Appearance' });
  await expect(appearanceTab).toBeVisible({ timeout: 3_000 });
  await appearanceTab.click();

  const cyberPreset = dialog.locator('[data-testid="lnas-preset-cyber"]');
  const classicPreset = dialog.locator('[data-testid="lnas-preset-classic"]');
  await expect(cyberPreset).toBeVisible({ timeout: 5_000 });

  // 1. Select Cyberpunk — a non-default preset with a distinctive --n1 color.
  await cyberPreset.click();
  await expect(cyberPreset).toHaveAttribute('aria-pressed', 'true', { timeout: 3_000 });
  await expect.poll(() => readNeonVar(page), { timeout: 3_000 }).toBe('#ff2d95');

  // 2. Export — this app's hardened session denies the clipboard-read
  // permission outright (electron-main/src/main.ts setPermissionRequestHandler
  // only allows 'media'), so navigator.clipboard.readText() used by the
  // "Paste" import button always resolves empty — that path can't round-trip
  // here. Export still writes a real mythos-theme-preset.json download
  // (clipboard-write succeeds via transient user-activation, independent of
  // the read permission gate); use that file for the import half instead.
  //
  // Playwright's page.waitForEvent('download') relies on a CDP download
  // event that Electron's anchor-click blob download doesn't reliably emit
  // (Electron routes downloads through session.will-download in the main
  // process instead). Hook will-download directly via app.evaluate — this is
  // the standard Electron+Playwright pattern and keeps the capture entirely
  // in the test harness, not app code.
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-theme-io-download-'));
  await app.evaluate(({ session }, dir) => {
    // No `require(...)` here: this callback runs in the Electron main process
    // via Playwright's serialization, which does not carry `require` into
    // scope. A throwing listener leaves `setSavePath` uncalled, so Electron
    // falls back to its native save-file dialog -- which hangs forever with
    // no one to dismiss it under headless/xvfb, freezing the whole app.
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(`${dir}/${item.getFilename()}`);
    });
  }, downloadDir);
  await dialog.locator('[data-testid="lnas-export"]').click();
  const exportedPath = path.join(downloadDir, 'mythos-theme-preset.json');
  await expect.poll(() => fs.existsSync(exportedPath), { timeout: 10_000 }).toBe(true);

  // 3. Switch away to Neon Classic, proving state actually changes.
  await classicPreset.click();
  await expect(classicPreset).toHaveAttribute('aria-pressed', 'true', { timeout: 3_000 });
  await expect(cyberPreset).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => readNeonVar(page), { timeout: 3_000 }).toBe('#00f0ff');

  // 4. File-import — feed the exported JSON back in via the hidden file input.
  await dialog.locator('[data-testid="lnas-import-file"]').setInputFiles(exportedPath as string);

  // 5. The Cyberpunk preset must be selected again, with its color restored —
  // the export → import round-trip is lossless.
  await expect(cyberPreset).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await expect(classicPreset).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => readNeonVar(page), { timeout: 5_000 }).toBe('#ff2d95');
});
