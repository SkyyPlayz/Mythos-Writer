/**
 * capture-sky-11219-provider-settings.spec.ts — SKY-11324 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the
 * SKY-11219 provider-adaptive Settings behavior:
 *   1. Anthropic selected — legacy "Anthropic API Key" section visible.
 *   2. Ollama selected — legacy API Key section hidden entirely (no cloud
 *      key implied for a local, keyless provider).
 *   3. Ollama selected, no per-agent override — the Writing Coach "Model"
 *      field inherits the provider's Default model instead of a blank box.
 *
 * Not registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky-11219-provider-settings.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11219-provider-settings');

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    provider: { kind: 'anthropic', apiKey: 'sk-ant-test-key', model: 'claude-sonnet-4-6' },
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: vaultDir }, null, 2));
}

test('capture provider-adaptive API key + agent model inherit screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-prov-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-prov-vault-'));
  seedUserData(userData, vaultDir);

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();

  // 1. Anthropic selected — legacy API Key section visible.
  await expect(page.locator('#api-key-input')).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, '1-anthropic-api-key-visible.png') });

  // 2. Switch to Ollama — legacy API Key section disappears entirely.
  const providerSelect = page.getByLabel('AI provider');
  await providerSelect.selectOption('ollama');
  await expect(page.locator('#api-key-input')).toHaveCount(0);
  await page.screenshot({ path: path.join(OUT_DIR, '2-ollama-api-key-hidden.png') });

  // 3. No-override agent Model field inherits the provider's Default model.
  const providerModelInput = page.getByLabel('Default model for this provider');
  const waModel = page.getByLabel('Writing Coach model');
  await waModel.fill('');
  await providerModelInput.fill('llama3-70b-instruct');
  await expect(waModel).toHaveAttribute('placeholder', 'Default: llama3-70b-instruct');
  await waModel.scrollIntoViewIfNeeded();
  // The "new Notes tab" upgrade toast (DesktopShell, 5s auto-dismiss) can
  // overlap this field on first boot — wait it out for a clean capture.
  await page.waitForTimeout(5_500);
  await page.screenshot({ path: path.join(OUT_DIR, '3-agent-model-inherits-provider-default.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
