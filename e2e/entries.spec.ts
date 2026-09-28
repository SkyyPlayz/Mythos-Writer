/**
 * Slice A2 — Quick Entry removed. Prove the surface and its entry points are gone.
 * Former TC-ENT-* coverage targeted EntriesQuickAdd; those paths no longer exist.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/entries.spec.ts --reporter=list
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

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant...-e2e',
    onboardingComplete: true,
    notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true,
    vaultUpgradePromptShown: true,
    ai: { enabled: true },
    agents: {
      brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir,
    notesVaultRoot: path.join(vaultDir, 'notes'),
  }, null, 2));
  fs.mkdirSync(path.join(vaultDir, 'notes'), { recursive: true });
}

test.describe('A2 Quick Entry absent', () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a2-qe-'));
    const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));
    seedUserData(userData, vaultDir);
    app = await electron.launch({
      args: [MAIN_JS],
      env: { ...process.env, MYTHOS_USER_DATA: userData, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
  });

  test('TC-ENT-A2: Quick Entry UI and entry points are absent', async () => {
    await expect(page.getByTestId('entries-qa-root')).toHaveCount(0);
    await expect(page.getByText('Quick Entry')).toHaveCount(0);
    // Partner rail (formerly Idea Board) must not resurrect Quick Entry chrome.
    const partner = page.locator('[data-testid="nav-rail-item-brainstorm"], .rail-item', { hasText: /Partner|Idea Board|Brainstorm/i }).first();
    if (await partner.isVisible({ timeout: 2000 }).catch(() => false)) {
      await partner.click();
      await page.waitForTimeout(500);
    }
    await expect(page.getByTestId('entries-qa-root')).toHaveCount(0);
    await expect(page.getByText('Quick Entry')).toHaveCount(0);
  });
});
