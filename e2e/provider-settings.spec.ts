/**
 * provider-settings.spec.ts — SKY-686
 *
 * E2E tests for the Settings UI provider configuration screen.
 *
 * TC-PROV-01  Ollama provider saved in app-settings seeds correct UI (text model input, base URL)
 * TC-PROV-02  Test connection with mocked local provider returns success
 * TC-PROV-03  Per-agent "Use different provider" toggle enables inline provider form
 * TC-PROV-04  Non-Anthropic global provider shows text input for per-agent model
 * TC-PROV-05  Switching the global provider dropdown fills Base URL with that
 *              provider's default (SKY-6941 regression — it used to keep the
 *              previously-selected provider's URL/placeholder)
 * TC-PROV-07  Legacy API Key section only renders for providers that need a
 *              key (SKY-11219 AC-1/AC-2)
 * TC-PROV-08  No-override agent Model field inherits and live-tracks the
 *              global provider's Default model (SKY-11219 AC-3)
 * TC-PROV-09  Editing Base URL for an already-selected listable provider
 *              re-fetches models after a debounce (SKY-11219 AC-4)
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
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

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
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

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
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  // Find the Brainstorm agent's provider override toggle. The native
  // checkbox itself is visually hidden (opacity:0; width/height:0) — the
  // visible clickable control is the sibling `.settings-toggle-track` span
  // inside the same `<label>` (SettingsPanel.css `.settings-toggle input`).
  const toggleInput = page.getByLabel(/enable brainstorm provider override/i);
  const toggleTrack = toggleInput.locator('xpath=following-sibling::span[contains(@class, "settings-toggle-track")]');
  await expect(toggleInput).not.toBeChecked();

  // Toggle it on
  await toggleTrack.click();
  await expect(toggleInput).toBeChecked();

  // Inline provider form should now be visible
  await expect(page.getByLabel('Provider for brainstorm')).toBeVisible();
  await expect(page.getByLabel('Model for brainstorm')).toBeVisible();

  // Toggle off
  await toggleTrack.click();
  await expect(toggleInput).not.toBeChecked();
  await expect(page.getByLabel('Provider for brainstorm')).not.toBeVisible();

  // Close settings
  await page.click('.settings-close');
});

test('TC-PROV-04: Non-Anthropic global provider shows text input for per-agent model', async () => {
  // App was seeded with Ollama → per-agent model should be text input
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

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

test('TC-PROV-05: switching global provider fills Base URL with that provider\'s default', async () => {
  // App was seeded with Ollama (http://127.0.0.1:11434/v1) — switch to llama.cpp
  // and confirm the Base URL updates to llama.cpp's own default rather than
  // keeping Ollama's URL/placeholder (SKY-6941).
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');
  const baseUrlInput = page.getByLabel('Provider base URL');
  await expect(baseUrlInput).toHaveValue('http://127.0.0.1:11434/v1');

  await providerSelect.selectOption('llamacpp');
  await expect(baseUrlInput).toHaveValue('http://127.0.0.1:8080/v1');

  await providerSelect.selectOption('lmstudio');
  await expect(baseUrlInput).toHaveValue('http://127.0.0.1:1234/v1');

  // Close settings
  await page.click('.settings-close');
});

// ─── TC-PROV-06: real UI → IPC → disk persistence (SKY-8446) ──────────────────
//
// The tests above only assert in-memory UI state. `settings:testConnection`
// is the only mocked IPC handler in this suite — `settings:set` hits the real
// main-process handler, so a Save here exercises the actual write path
// (SettingsPanel.handleSave → window.api.settingsSet → saveAppSettings →
// fs.writeFileSync(app-settings.json)). This asserts the change survives on
// disk, not just in the DOM.

test('TC-PROV-06: Save persists global provider config to app-settings.json on disk', async () => {
  // Open settings
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');
  await providerSelect.selectOption('lmstudio');

  const baseUrlInput = page.getByLabel('Provider base URL');
  await baseUrlInput.fill('http://127.0.0.1:9999/v1');

  const modelInput = page.getByLabel('Default model for this provider');
  await modelInput.fill('e2e-persisted-model');

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 5_000 });

  // Close settings
  await page.click('.settings-close');

  // Assert the change actually landed on disk, not just in the DOM.
  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as {
    provider?: { kind?: string; baseUrl?: string; model?: string };
  };
  expect(stored.provider?.kind).toBe('lmstudio');
  expect(stored.provider?.baseUrl).toBe('http://127.0.0.1:9999/v1');
  expect(stored.provider?.model).toBe('e2e-persisted-model');
});

// ─── TC-PROV-07/08: SKY-11219 provider-adaptive settings ──────────────────────
//
// Each test below explicitly selects its starting provider rather than
// relying on whatever a prior test left selected, matching TC-PROV-01's
// pattern of asserting the exact starting state.

test('TC-PROV-07: legacy API Key section only renders for providers that need one', async () => {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');

  // Ollama is keyless — the legacy top-level API Key field must not render
  // at all, not just be hidden/disabled.
  await providerSelect.selectOption('ollama');
  await expect(page.locator('#api-key-input')).toHaveCount(0);

  // Switch to OpenAI (needsKey) — field reappears with provider-specific copy.
  await providerSelect.selectOption('openai');
  await expect(page.locator('#api-key-input')).toBeVisible();
  await expect(page.locator('label[for="api-key-input"]')).toHaveText('OpenAI API Key');
  await expect(page.locator('#api-key-input')).toHaveAttribute('placeholder', 'Paste API key…');

  // Switch to Ollama (keyless) again — hides.
  await providerSelect.selectOption('ollama');
  await expect(page.locator('#api-key-input')).toHaveCount(0);

  // Switch to Anthropic (needsKey) — field reappears with the original copy.
  await providerSelect.selectOption('anthropic');
  await expect(page.locator('#api-key-input')).toBeVisible();
  await expect(page.locator('label[for="api-key-input"]')).toHaveText('Anthropic API Key');

  await page.click('.settings-close');
});

test('TC-PROV-08: no-override agent Model field inherits & live-tracks the provider Default model', async () => {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');
  await providerSelect.selectOption('ollama');

  const providerModelInput = page.getByLabel('Default model for this provider');
  const waModel = page.getByLabel('Writing Coach model');

  // SKY-11355: "no override" is now an explicit empty-string "Default"
  // sentinel, not a copy of the provider's model string — the visible value
  // stays '' and the resolved model surfaces via the placeholder instead.
  await waModel.fill('');
  await expect(waModel).toHaveValue('');

  // The field must reflect the provider's Default model instead of sitting
  // blank/stale (SKY-11219 AC-3).
  await providerModelInput.fill('llama3-70b-instruct');
  await expect(waModel).toHaveValue('');
  await expect(waModel).toHaveAttribute('placeholder', 'Default: llama3-70b-instruct');

  // Live-tracks: editing the provider default again updates the agent field's
  // placeholder, since no override was ever typed into it.
  await providerModelInput.fill('mixtral-8x7b');
  await expect(waModel).toHaveAttribute('placeholder', 'Default: mixtral-8x7b');

  // Once the user types their own value into the agent field, it wins over
  // the provider default and stops tracking further edits.
  await waModel.fill('custom-agent-only-model');
  await providerModelInput.fill('yet-another-provider-default');
  await expect(waModel).toHaveValue('custom-agent-only-model');

  await page.click('.settings-close');
});

// ─── TC-PROV-09: SKY-11219 AC-4 — Base URL edit debounce re-fetch ─────────────
//
// Prior to SKY-11219 the model list only re-fetched on a provider *switch*;
// editing the Base URL for an already-selected listable provider (e.g.
// pointing the same LM Studio dropdown at a different running endpoint) did
// nothing until a manual "Refresh models" click. The fix debounces a
// re-fetch 400ms after the last keystroke — verified here against a real
// `provider:listModels` IPC handler mock with call tracking, not a fixed sleep.

test('TC-PROV-09: editing Base URL for a listable provider re-fetches models after a debounce', async () => {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  // SKY-10668: the panel now opens on Appearance — go to the AI Agents page.
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const providerSelect = page.getByLabel('AI provider');
  await providerSelect.selectOption('lmstudio');

  await app!.evaluate(async ({ ipcMain }) => {
    (globalThis as Record<string, unknown>).__e2eListModelsCalls = [];
    ipcMain.removeHandler('provider:listModels');
    ipcMain.handle('provider:listModels', async (_event, payload: unknown) => {
      (((globalThis as Record<string, unknown>).__e2eListModelsCalls) as unknown[]).push(payload);
      return { ok: true, models: ['e2e-debounced-model'] };
    });
  });

  const baseUrlInput = page.getByLabel('Provider base URL');
  await baseUrlInput.fill('http://127.0.0.1:5555/v1');

  // Poll past the 400ms debounce instead of a single fixed wait.
  await expect(async () => {
    const calls = await app!.evaluate(
      () => (globalThis as Record<string, unknown>).__e2eListModelsCalls as { baseUrl?: string }[],
    );
    expect(calls.some((c) => c.baseUrl === 'http://127.0.0.1:5555/v1')).toBe(true);
  }).toPass({ timeout: 3_000 });

  await page.click('.settings-close');
});
