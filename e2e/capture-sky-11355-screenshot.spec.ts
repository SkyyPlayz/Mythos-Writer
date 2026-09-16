/**
 * capture-sky-11355-screenshot.spec.ts — SKY-11355 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots for
 * "per-agent Model must default to Default (provider model) + get the
 * auto-detected dropdown":
 *
 *   1. 1-fresh-install-default-selected — fresh install (agent model saved
 *      as '', the new out-of-box value) on LM Studio: the Writing Coach
 *      Model field is a dropdown, not free text, and its selected option is
 *      "Default (<resolved model>)" — no typing required, nothing hardcoded
 *      to an Anthropic model name.
 *   2. 2-explicit-override-only-this-agent — the same dropdown open, showing
 *      the auto-detected LM Studio models alongside "Default" and "Custom…",
 *      i.e. the same list the provider's own Default model field offers.
 *
 * Output: pr-screenshots/sky-11355-agent-model-default/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-11355-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11355-agent-model-default');

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

test('capture SKY-11355 agent-model-default screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11355-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11355-vault-'));

  // Seed a fresh-install-shaped settings file: global provider is LM Studio,
  // every agent's model is '' — the new out-of-box default this ticket adds.
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    provider: { kind: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen/qwen3.6-35b-a3b' },
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true, model: '', scanIntervalSeconds: 30, autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true, model: '', autoApply: false, confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: true, model: '', continuityCheckIntervalSeconds: 60, autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      betaReader: {
        enabled: true, model: '', autoApply: false, confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
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

  // Open Settings -> AI Agents.
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');
  await expect(providerSelect).toHaveValue('lmstudio');

  // Real LM Studio instance on this machine — let the auto-fetch settle so
  // the provider's own Default model field resolves to a real model name.
  await expect(page.locator('[data-testid="model-list-loading"]')).toHaveCount(0, { timeout: 8_000 });

  // 1. Writing Coach (no per-agent override) — Model field is a dropdown
  // whose selected option is "Default (<resolved model>)", not a free-text
  // box pre-filled with a hardcoded Anthropic model name.
  const waModel = page.getByLabel('Writing Coach model');
  await expect(waModel).toHaveValue('');
  await expect(waModel.locator('option:checked')).toHaveText(/^Default \(.+\)$/);
  await shot(page, '1-fresh-install-default-selected');

  // 2. Open the dropdown to show it lists the same auto-detected models as
  // the provider's own Default model field, plus "Default" and "Custom…".
  const optionLabels = await waModel.locator('option').allTextContents();
  expect(optionLabels.some((t) => /^Default/.test(t))).toBe(true);
  expect(optionLabels).toContain('Custom…');
  await waModel.evaluate((el: HTMLSelectElement) => { el.size = Math.min(el.options.length, 6); });
  await shot(page, '2-dropdown-lists-autodetected-models');

  await page.click('.settings-close');
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
