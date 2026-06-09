/**
 * provider-settings.spec.ts — SKY-902 / GH#308
 *
 * Regression tests verifying unique accessible names in the Settings provider
 * section, preventing Playwright strict-mode failures from ambiguous getByLabel
 * matches.
 *
 *   TC-PROV-01  No "AI provider" ambiguity — getByLabel('AI provider') must
 *               resolve to exactly the provider select, not also the section
 *               region heading ("AI Providers").
 *   TC-PROV-03  No "Provider for brainstorm" ambiguity — the per-agent override
 *               toggle ("Override provider for brainstorm") and the inline
 *               provider select ("Brainstorm provider") have distinct names.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/provider-settings.spec.ts --reporter=list
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
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
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
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prov-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prov-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prov-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

async function openSettings(): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.locator('[aria-label="Open settings"]').click();
  await expect(page.locator('[aria-label="Settings"][role="dialog"]')).toBeVisible({ timeout: 6_000 });
}

// ─── TC-PROV-01: no "AI provider" strict-mode ambiguity ──────────────────────
//
// Before this fix, both the section region ("AI Provider" via aria-labelledby)
// and the provider select (aria-label="AI provider") shared the same accessible
// name, causing getByLabel to find two elements.  The section heading is now
// "AI Providers" (plural) so the names are distinct.

test('TC-PROV-01: getByLabel("AI provider") resolves to exactly the provider select', async () => {
  await openSettings();

  // Strict mode: must resolve to exactly one element — the <select>, not the section.
  const providerSelect = page.getByLabel('AI provider');
  await expect(providerSelect).toBeVisible();
  await expect(providerSelect).toHaveCount(1);

  // The section heading must use the distinct plural form.
  await expect(page.getByRole('heading', { name: 'AI Providers' })).toBeVisible();
});

// ─── TC-PROV-03: brainstorm override toggle and select have distinct names ────
//
// The per-agent provider override toggle ("Override provider for brainstorm")
// and the inline provider select ("Brainstorm provider") must have different
// accessible names so each getByLabel call resolves to exactly one element.

test('TC-PROV-03: brainstorm override toggle and select have distinct accessible names', async () => {
  // Settings should already be open from TC-PROV-01; ensure it's still visible.
  const dialog = page.locator('[aria-label="Settings"][role="dialog"]');
  if (!(await dialog.isVisible())) {
    await openSettings();
  }

  // The toggle must resolve to exactly one element.
  const overrideToggle = page.getByLabel('Override provider for brainstorm');
  await expect(overrideToggle).toBeVisible();
  await expect(overrideToggle).toHaveCount(1);

  // Enable the override so the per-agent provider select becomes visible.
  await overrideToggle.check();

  // The per-agent provider select must resolve to exactly one element and be
  // distinct from the toggle (different accessible name).
  const brainstormProviderSelect = page.getByLabel('Brainstorm provider');
  await expect(brainstormProviderSelect).toBeVisible();
  await expect(brainstormProviderSelect).toHaveCount(1);
});
