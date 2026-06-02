/**
 * a11y-focus.spec.ts — SKY-143
 *
 * Regression tests verifying keyboard tab-focus navigation through VaultBrowser.
 *
 *   TC-A11Y-01  Scope bar tab order    — Tab cycles through Story/Notes/Both buttons
 *   TC-A11Y-02  Section button reachable — Tab after scope bar reaches the section "+" button
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/a11y-focus.spec.ts --reporter=list
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
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-A11Y-01: VaultBrowser scope bar tab order ────────────────────────────
//
// Verifies all three scope buttons (Story / Notes / Both) are in the tab order
// and that Tab moves focus through them in DOM order.

test('TC-A11Y-01: VaultBrowser scope bar buttons are keyboard-focusable via Tab', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate to the Vault tab in the LeftRail
  await page.locator('.rail-tab', { hasText: 'Vault' }).click();

  const storyScopeBtn = page.locator('[data-testid="vb-scope-story"]');
  await expect(storyScopeBtn).toBeVisible({ timeout: 6_000 });

  // Focus the first scope button to anchor the traversal
  await storyScopeBtn.focus();
  await expect(storyScopeBtn).toBeFocused();

  // Tab → Notes scope button
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="vb-scope-notes"]')).toBeFocused();

  // Tab → Both scope button
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-testid="vb-scope-both"]')).toBeFocused();
});

// ─── TC-A11Y-02: VaultBrowser section action button reachable by Tab ─────────
//
// Verifies that Tab navigation past the scope bar reaches the first section
// action button (Story Vault "New Story" +), confirming VaultBrowser items
// beyond the scope bar are part of the natural tab order.

test('TC-A11Y-02: Tab past scope bar reaches the Story Vault "New Story" button', async () => {
  // Navigate to Vault tab and switch to story-only scope for a deterministic DOM
  await page.locator('.rail-tab', { hasText: 'Vault' }).click();
  await page.locator('[data-testid="vb-scope-story"]').click();

  // Anchor on the Story scope button, then Tab through Notes and Both buttons
  const storyScopeBtn = page.locator('[data-testid="vb-scope-story"]');
  await storyScopeBtn.focus();
  await page.keyboard.press('Tab'); // → Notes scope btn
  await page.keyboard.press('Tab'); // → Both scope btn
  await page.keyboard.press('Tab'); // → Story Vault "New Story" (+) button

  // The focused element should be the section-add button inside Story Vault
  const newStoryBtn = page.locator('.vb-section-add').first();
  await expect(newStoryBtn).toBeFocused();
});
