/**
 * wallpaper-picker.spec.ts — SKY-11589 (owner directive)
 *
 * Real e2e for the Theme match wallpaper cycle in Settings → Appearance →
 * Background (frontend/src/components/SettingsPanel/sections/
 * LiquidNeonAppearanceSection.tsx), reached from a fresh profile by clicks
 * only — nothing under test is pre-seeded:
 *
 *   1. The renamed preset reads "Neon Nebula"; "No background" is gone.
 *   2. The Theme match tile shows arrows + "1/N" for the default preset.
 *   3. Clicking → moves to "2/N" and repaints the live --wp token on <html>
 *      to the first bundled pack image.
 *   4. The pick reaches app-settings.json under the per-vault appearance
 *      store (SKY-11237) via the Appearance tab's live persistence.
 *   5. Relaunch: the wallpaper is applied at boot (before Settings opens) and
 *      the tile still reads "2/N" — the choice survives the process boundary.
 *
 * No IPC mocks. Run (after `npm run build:electron`):
 *   npx playwright test e2e/wallpaper-picker.spec.ts --reporter=list
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

async function readWp(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wp').trim());
}

async function openAppearance(page: Page) {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await page.locator('button[aria-label*="ettings"], button:has-text("Settings")').first().click();
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const appearanceTab = dialog.locator('.settings-cat-nav [role="tab"]', { hasText: 'Appearance' });
  await expect(appearanceTab).toBeVisible({ timeout: 3_000 });
  await appearanceTab.click();
  await expect(dialog.locator('[data-testid="lnas-wp-match"]')).toBeVisible({ timeout: 5_000 });
  return dialog;
}

interface StoredSettings {
  liquidNeonV2?: { wp?: string; wpPick?: Record<string, number> };
  vaultAppearance?: Record<string, { liquidNeonV2?: { wp?: string; wpPick?: Record<string, number> } }>;
}

function readStored(userData: string): StoredSettings {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as StoredSettings;
}

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-pick-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-pick-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-pick-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
});

test('Theme match arrows cycle the preset wallpapers and the pick survives a relaunch (per vault)', async () => {
  const dialog = await openAppearance(page);

  // 1. Rename + removal are visible at the surface.
  await expect(dialog.locator('[data-testid="lnas-preset-classic"]')).toContainText('Neon Nebula');
  await expect(dialog.locator('[data-testid="lnas-wp-none"]')).toHaveCount(0);
  await expect(dialog.getByText('No background')).toHaveCount(0);

  // 2. Fresh profile: default preset, built-in wallpaper first → "1/N".
  const count = dialog.locator('[data-testid="lnas-wp-match-count"]');
  await expect(count).toBeVisible();
  const total = Number((await count.textContent())!.split('/')[1]);
  expect(total).toBeGreaterThan(1);
  await expect(count).toHaveText(`1/${total}`);
  expect(await readWp(page)).toContain('cosmic-bg');

  // 3. Next → second entry (first bundled Neon Nebula image), live repaint.
  await dialog.locator('[data-testid="lnas-wp-match-next"]').click();
  await expect(count).toHaveText(`2/${total}`, { timeout: 3_000 });
  await expect(dialog.locator('[data-testid="lnas-wp-match"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => readWp(page), { timeout: 3_000 }).toContain('classic-1');

  // 4. Persisted under the per-vault appearance store (SKY-11237), no Save click.
  await expect.poll(() => {
    const s = readStored(userData);
    const perVault = Object.values(s.vaultAppearance ?? {}).some((v) => v.liquidNeonV2?.wpPick?.classic === 1);
    return perVault && s.liquidNeonV2?.wpPick?.classic === 1 && s.liquidNeonV2?.wp === 'match';
  }, { timeout: 10_000 }).toBe(true);

  // 5. Relaunch — the pick is applied at boot and still shown in Settings.
  await app.close();
  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => readWp(page), { timeout: 10_000 }).toContain('classic-1');

  const dialog2 = await openAppearance(page);
  await expect(dialog2.locator('[data-testid="lnas-wp-match-count"]')).toHaveText(`2/${total}`, { timeout: 5_000 });

  // Previous from index 1 returns to the built-in wallpaper.
  await dialog2.locator('[data-testid="lnas-wp-match-prev"]').click();
  await expect(dialog2.locator('[data-testid="lnas-wp-match-count"]')).toHaveText(`1/${total}`, { timeout: 3_000 });
  await expect.poll(() => readWp(page), { timeout: 3_000 }).toContain('cosmic-bg');
});
