/**
 * provider-settings.spec.ts — SKY-686
 *
 * E2E tests for the Settings UI provider configuration screen.
 *
 * TC-PROV-01  Ollama provider saved in app-settings seeds correct UI (text model input, base URL)
 * TC-PROV-02  Test connection with mocked local provider returns success
 * TC-PROV-03  Per-agent "Use different provider" toggle enables inline provider form
 * TC-PROV-04  Non-Anthropic global provider shows text input for per-agent model
 *
 * The real `settings:testConnection` IPC handler is replaced with a mock that
 * always succeeds so no actual Ollama/LM Studio instance is needed.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, providerKind = 'anthropic'): void {
  const provider = providerKind === 'ollama'
    ? { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3' }
    : { kind: 'anthropic', apiKey: 'sk-ant-test-key', model: 'claude-sonnet-4-6' };

  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    provider,
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: providerKind === 'ollama' ? 'llama3' : 'claude-sonnet-4-6',
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
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };

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
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Mock the settings:testConnection IPC to return immediate success. */
async function mockTestConnection(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain }) => {
    ipcMain.removeHandler('settings:testConnection');
    ipcMain.handle('settings:testConnection', async () => ({
      ok: true,
      latencyMs: 12,
    }));
  });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prov-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-prov-vault-'));
  seedUserData(userData, vaultDir, 'ollama');

  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await mockTestConnection(app);
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(vaultDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('TC-PROV-01: Ollama provider seeded in app-settings shows base URL and text model input', async () => {
  // Open settings
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });

  // Provider selector should show 'ollama'
  const providerSelect = page.getByLabel('AI provider');
  await expect(providerSelect).toHaveValue('ollama');

  // Base URL field should be pre-filled
  const baseUrlInput = page.getByLabel('Provider base URL');
  await expect(baseUrlInput).toHaveValue('http://127.0.0.1:11434/v1');

  // Model field should be a text input (not a dropdown), pre-filled with 'llama3'
  const modelInput = page.getByLabel('Default model for this provider');
  await expect(modelInput).toHaveAttribute('type', 'text');
  await expect(modelInput).toHaveValue('llama3');

  // Close settings
  await page.click('.settings-close');
});

test('TC-PROV-02: Test connection with mocked local provider shows success', async () => {
  // Open settings
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });

  // Click test connection
  await page.click('[aria-label="Test provider connection"]');

  // Should show success status
  await expect(page.locator('.settings-test-ok')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.settings-test-ok')).toContainText('Connection successful');

  // Close settings
  await page.click('.settings-close');
});

test('TC-PROV-03: "Use different provider for this agent" toggle shows inline provider form', async () => {
  // Open settings
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });

  // Find the Brainstorm agent's provider override toggle
  const toggleInput = page.getByLabel(/enable brainstorm provider override/i);
  await expect(toggleInput).not.toBeChecked();

  // Toggle it on
  await toggleInput.click();
  await expect(toggleInput).toBeChecked();

  // Inline provider form should now be visible
  await expect(page.getByLabel('Provider for brainstorm')).toBeVisible();
  await expect(page.getByLabel('Model for brainstorm')).toBeVisible();

  // Toggle off
  await toggleInput.click();
  await expect(toggleInput).not.toBeChecked();
  await expect(page.getByLabel('Provider for brainstorm')).not.toBeVisible();

  // Close settings
  await page.click('.settings-close');
});

test('TC-PROV-04: Non-Anthropic global provider shows text input for per-agent model', async () => {
  // App was seeded with Ollama → per-agent model should be text input
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });

  // Writing Assistant model input should be a text input (not a select)
  const waModel = page.getByLabel('Writing Coach model');
  await expect(waModel).toHaveAttribute('type', 'text');

  // Brainstorm model input should be text input
  const brainstormModel = page.getByLabel('Brainstorm Agent model');
  await expect(brainstormModel).toHaveAttribute('type', 'text');

  // Archive model input should be text input
  const archiveModel = page.getByLabel('Archive Agent model');
  await expect(archiveModel).toHaveAttribute('type', 'text');

  // Close settings
  await page.click('.settings-close');
});
