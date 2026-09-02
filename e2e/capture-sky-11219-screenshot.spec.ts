/**
 * capture-sky-11219-screenshot.spec.ts — SKY-11219 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots for
 * "provider settings adapt to non-Anthropic providers":
 *
 *   1. 1-anthropic-key-shown — global provider = Anthropic: the legacy
 *      top-level "API Key" section is visible (needsKey provider).
 *   2. 2-lmstudio-key-hidden-model-inherited — global provider switched to
 *      LM Studio (a keyless local provider): the legacy API Key section is
 *      now hidden entirely (not just disabled), and the Writing Coach
 *      agent's Model field (no per-agent override) already shows the
 *      provider's live Default model instead of a blank/stale box.
 *
 * Output: pr-screenshots/sky-11219-provider-settings-adaptive/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-11219-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11219-provider-settings-adaptive');

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

test('capture SKY-11219 provider-settings-adaptive screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11219-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11219-vault-'));

  // Seed with Anthropic as the global provider + onboarding already complete
  // so the first screenshot shows the "before" (needsKey) state.
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: 'sk-ant-test-key-for-e2e',
    provider: { kind: 'anthropic', apiKey: 'sk-ant-test-key-for-e2e', model: 'claude-sonnet-4-6' },
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        // Seeded blank on purpose (AC-3 regression case): a no-override
        // agent whose per-agent model was never set must inherit the
        // global provider's live Default model rather than sitting on an
        // empty/stale box after a provider switch.
        model: '',
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
        model: 'claude-sonnet-4-6',
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
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: vaultDir,
  }, null, 2));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  app.process().stdout?.on('data', () => undefined);

  const page: Page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await applyTheme(page);

  // Open Settings -> AI Agents (SKY-10668: panel now opens on Appearance).
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');
  await expect(providerSelect).toHaveValue('anthropic');

  // 1. Anthropic (needsKey): legacy API Key section renders with
  // Anthropic-specific label/placeholder.
  await expect(page.locator('#api-key-input')).toBeVisible();
  await expect(page.locator('label[for="api-key-input"]')).toHaveText('Anthropic API Key');
  await shot(page, '1-anthropic-key-shown');

  // 2. Switch to LM Studio — a keyless local provider.
  await providerSelect.selectOption('lmstudio');
  await expect(providerSelect).toHaveValue('lmstudio');

  // Legacy API Key section must be gone entirely (not disabled/hidden via
  // CSS) — a local provider needs no cloud key.
  await expect(page.locator('#api-key-input')).toHaveCount(0);

  // Switching providers auto-fires a real listModels() fetch against
  // 127.0.0.1:1234 (SKY-1501) — this environment happens to have an LM
  // Studio instance actually listening there, so it resolves to a real
  // fetched model dropdown rather than the free-text fallback. Let the
  // in-flight request settle before interacting.
  const providerModelField = page.locator('#provider-model');
  await expect(page.locator('[data-testid="model-list-loading"]')).toHaveCount(0, { timeout: 8_000 });
  const tagName = await providerModelField.evaluate((el) => el.tagName);

  // No-override agent Model field (Writing Coach) inherits/live-tracks the
  // provider's Default model instead of sitting blank/stale.
  const waModel = page.getByLabel('Writing Coach model');
  if (tagName === 'SELECT') {
    const options = await providerModelField.locator('option').allTextContents();
    const realModel = options.find((o) => o && o !== 'Custom…') ?? options[0];
    await providerModelField.selectOption({ label: realModel });
    await expect(waModel).toHaveValue(realModel);
  } else {
    await providerModelField.fill('llama-3.1-8b-instruct');
    await expect(waModel).toHaveValue('llama-3.1-8b-instruct');
  }

  await shot(page, '2-lmstudio-key-hidden-model-inherited');

  await page.click('.settings-close');
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
