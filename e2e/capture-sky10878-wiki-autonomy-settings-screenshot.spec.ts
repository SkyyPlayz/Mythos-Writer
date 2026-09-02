/**
 * capture-sky10878-wiki-autonomy-settings-screenshot.spec.ts — SKY-10878 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence for the wiki-autonomy
 * tri-state Settings control: Settings → Agents → Agent Index card →
 * "When the wiki spots a new name" select. Not registered in
 * package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky10878-wiki-autonomy-settings-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10878-wiki-autonomy-settings');

test('capture wiki-autonomy tri-state setting in Agents settings', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiki-autonomy-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiki-autonomy-shots-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiki-autonomy-shots-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });

  await page.locator('button[aria-label="Settings"]').click();
  await expect(page.locator('[data-testid="settings-cat-agents"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const wikiAutonomySelect = page.locator('[data-testid="wiki-autonomy-select"]');
  await wikiAutonomySelect.scrollIntoViewIfNeeded();
  await expect(wikiAutonomySelect).toBeVisible({ timeout: 8_000 });
  await expect(wikiAutonomySelect).toHaveValue('ask');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, '01-wiki-autonomy-default-always-ask.png') });

  // Also capture the auto option's helper text for evidence of the tri-state.
  await wikiAutonomySelect.selectOption('auto');
  await expect(page.locator('.settings-hint', { hasText: 'duplicate / junk checks' })).toBeVisible({ timeout: 8_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '02-wiki-autonomy-auto-stub.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
