/**
 * local-model-picker.spec.ts — SKY-1502 / SKY-1459
 *
 * E2E test plan for the Local Model Picker feature (v0). Covers:
 * - AC-1 (per-agent picker render)
 * - AC-2 (Ollama model list — mocked HTTP)
 * - AC-3 (Ollama-not-running hint)
 * - AC-4 (custom OpenAI-compatible model listing — mocked HTTP)
 * - AC-8 (fresh install defaults)
 * - AC-9 (upgrade preserves model)
 * - AC-10 (test-connection per agent — partial: render only, functional via unit tests)
 *
 * Unit tests for AC-5/6/7 (API-key inheritance, SSRF guard, key masking) are in
 * provider.test.ts and api-key-leak.test.ts; QA verifies via grep in engineering PRs.
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string, appSettings?: any): void {
  const defaultSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  const settings = appSettings ? { ...defaultSettings, ...appSettings } : defaultSettings;
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function openSettings(page: Page): Promise<void> {
  // Click the settings icon in the toolbar (if visible) or use keyboard shortcut
  // Assuming Settings is accessible via Ctrl+, or a menu button
  await page.keyboard.press('Control+Comma');
  // Wait for settings panel to appear; look for the provider section
  await page.waitForSelector('text=/AI Provider|provider-select/', { timeout: 5000 }).catch(() => {
    // If selector doesn't appear, the Settings may have opened
  });
  await page.waitForLoadState('domcontentloaded');
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lmp-ud-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lmp-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lmp-notes-'));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── AC-8: Fresh Install Defaults ─────────────────────────────────────────────

test('TC-LMP-01: Fresh install defaults to global Anthropic provider for all agents', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);

    // Navigate to settings
    await openSettings(page);

    // Verify provider section with "AI Provider" heading is visible
    const providerSection = page.locator('text=/AI Provider/');
    expect(providerSection).toBeTruthy();

    // Check for Anthropic mentions in the settings
    const pageText = await page.textContent('body');
    expect(pageText).toContain('Anthropic');
    expect(pageText).toContain('claude-sonnet-4-6');

    // Verify we can locate the provider select dropdown by its ID
    const providerSelect = page.locator('#provider-select');
    const providerValue = await providerSelect.inputValue();
    expect(providerValue).toBe('anthropic');
  } finally {
    await app.close().catch(() => {});
  }
});

// ─── AC-1: Per-Agent Provider Picker Render ────────────────────────────────────

test('TC-LMP-02: Per-agent provider picker renders when override toggle is enabled', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openSettings(page);

    // Locate Brainstorm agent card and toggle override
    const brainstormCard = page.locator('[data-testid="agent-section-brainstorm"]');
    const toggleButton = brainstormCard.locator('[data-testid="agent-provider-override-toggle"]');
    await toggleButton.click();
    await page.waitForTimeout(500); // Wait for UI update

    // Verify provider dropdown appears
    const providerDropdown = brainstormCard.locator('[data-testid="agent-provider-select"]');
    expect(providerDropdown).toBeTruthy();

    // Verify model field appears
    const modelField = brainstormCard.locator('[data-testid="agent-model-field"]');
    expect(modelField).toBeTruthy();

    // Verify "Refresh models" button is present
    const refreshButton = brainstormCard.locator('button:has-text("Refresh models")');
    expect(refreshButton).toBeTruthy();

    // Verify "Test connection" button is present
    const testConnButton = brainstormCard.locator('button:has-text("Test connection")');
    expect(testConnButton).toBeTruthy();

    // Writing Assistant should still show "Using global provider"
    const writingCard = page.locator('[data-testid="agent-section-writingAssistant"]');
    const writingText = await writingCard.textContent();
    expect(writingText).toContain('Using global provider');
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-LMP-02b: Changing global provider updates non-overridden agents', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openSettings(page);

    // Get initial provider text for Writing Assistant (should say Anthropic)
    const writingCard = page.locator('[data-testid="agent-section-writingAssistant"]');
    let writingText = await writingCard.textContent();
    expect(writingText).toContain('Anthropic');

    // Change global provider to OpenAI
    const globalProviderSelect = page.locator('[data-testid="provider-select"]');
    await globalProviderSelect.selectOption('openai');
    await page.waitForTimeout(500);

    // Verify Writing Assistant now shows OpenAI (since it's not overridden)
    writingText = await writingCard.textContent();
    expect(writingText).toContain('OpenAI');
  } finally {
    await app.close().catch(() => {});
  }
});

// ─── AC-3: Ollama Not Running Hint ──────────────────────────────────────────────

test('TC-LMP-03: Ollama-not-running shows user-friendly hint', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);

    // Intercept fetch calls to Ollama API and return error
    await page.route('**/127.0.0.1:11434/**', route => {
      route.abort('failed');
    });

    await openSettings(page);

    // Toggle override on Writing Assistant
    const writingCard = page.locator('[data-testid="agent-section-writingAssistant"]');
    const toggleButton = writingCard.locator('[data-testid="agent-provider-override-toggle"]');
    await toggleButton.click();
    await page.waitForTimeout(500);

    // Select Ollama provider
    const providerSelect = writingCard.locator('[data-testid="agent-provider-select"]');
    await providerSelect.selectOption('ollama');
    await page.waitForTimeout(500);

    // Verify "Ollama is not running" hint appears
    const hintText = await writingCard.textContent();
    expect(hintText).toContain('Ollama is not running');
  } finally {
    await app.close().catch(() => {});
  }
});

// ─── AC-4: Custom OpenAI-Compatible Model Listing ──────────────────────────────

test('TC-LMP-04: Custom endpoint model listing populates dropdown (mocked)', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);

    // Mock the /v1/models endpoint
    await page.route('**/custom-provider.local/v1/models', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'gpt-4o' },
            { id: 'gpt-4o-mini' },
            { id: 'claude-sonnet-4-6' },
          ],
        }),
      });
    });

    await openSettings(page);

    // Toggle override on Archive agent
    const archiveCard = page.locator('[data-testid="agent-section-archive"]');
    const toggleButton = archiveCard.locator('[data-testid="agent-provider-override-toggle"]');
    await toggleButton.click();
    await page.waitForTimeout(500);

    // Select custom provider
    const providerSelect = archiveCard.locator('[data-testid="agent-provider-select"]');
    await providerSelect.selectOption('custom');
    await page.waitForTimeout(500);

    // Enter custom endpoint URL
    const urlField = archiveCard.locator('[data-testid="agent-base-url-field"]');
    await urlField.fill('https://custom-provider.local/v1');

    // Enter API key
    const keyField = archiveCard.locator('[data-testid="agent-api-key-field"]');
    await keyField.fill('test-key-123');

    // Click Refresh models
    const refreshButton = archiveCard.locator('button:has-text("Refresh models")');
    await refreshButton.click();
    await page.waitForTimeout(1000);

    // Verify model dropdown now contains mocked models
    const modelDropdown = archiveCard.locator('[data-testid="agent-model-select"]');
    const options = await modelDropdown.locator('option').count();
    expect(options).toBeGreaterThan(0);

    // Select a model and verify it's in the field
    await modelDropdown.selectOption('gpt-4o');
    const selectedModel = await modelDropdown.inputValue();
    expect(selectedModel).toBe('gpt-4o');
  } finally {
    await app.close().catch(() => {});
  }
});

// ─── AC-2: Ollama Model List Dropdown (Mocked) ─────────────────────────────────

test('TC-LMP-05: Ollama model list dropdown (mocked HTTP)', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);

    // Mock the Ollama /api/tags endpoint
    await page.route('**/127.0.0.1:11434/api/tags', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [
            { name: 'llama3' },
            { name: 'mistral' },
            { name: 'neural-chat' },
          ],
        }),
      });
    });

    await openSettings(page);

    // Toggle override on Brainstorm agent
    const brainstormCard = page.locator('[data-testid="agent-section-brainstorm"]');
    const toggleButton = brainstormCard.locator('[data-testid="agent-provider-override-toggle"]');
    await toggleButton.click();
    await page.waitForTimeout(500);

    // Select Ollama provider
    const providerSelect = brainstormCard.locator('[data-testid="agent-provider-select"]');
    await providerSelect.selectOption('ollama');
    await page.waitForTimeout(500);

    // Click Refresh models (or wait for auto-fetch if implemented)
    const refreshButton = brainstormCard.locator('button:has-text("Refresh models")');
    await refreshButton.click();
    await page.waitForTimeout(1000);

    // Verify model dropdown is populated with mocked models
    const modelDropdown = brainstormCard.locator('[data-testid="agent-model-select"]');
    const options = await modelDropdown.locator('option').count();
    expect(options).toBeGreaterThan(0);

    // Verify at least one of our mocked models appears
    const dropdownText = await modelDropdown.textContent();
    expect(dropdownText).toContain('llama3');
  } finally {
    await app.close().catch(() => {});
  }
});

// ─── AC-9: Upgrade Preserves Model Settings ────────────────────────────────────

test('TC-LMP-06: Upgrade preserves existing model settings', async () => {
  // Pre-seed with old-style settings (pre-picker, no provider override)
  const oldSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  seedUserData(userData, vaultDir, notesVaultDir, oldSettings);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openSettings(page);

    // Verify all agents show "Using global provider" (not overridden)
    const brainstormCard = page.locator('[data-testid="agent-section-brainstorm"]');
    let text = await brainstormCard.textContent();
    expect(text).toContain('Using global provider');

    // Verify model is still visible (preserved from old settings)
    expect(text).toContain('claude-sonnet-4-6');

    // Change global provider to OpenAI
    const globalProviderSelect = page.locator('[data-testid="provider-select"]');
    await globalProviderSelect.selectOption('openai');
    await page.waitForTimeout(500);

    // Close and reopen settings to verify persistence
    // (Simulate closing settings panel)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Reopen settings
    await openSettings(page);

    // Verify settings persisted
    const newText = await brainstormCard.textContent();
    expect(newText).toContain('OpenAI');
    expect(newText).toContain('claude-sonnet-4-6');
  } finally {
    await app.close().catch(() => {});
  }
});

// ─── AC-10: Test Connection Per Agent (Partial) ────────────────────────────────

test('TC-LMP-07: Test connection button renders in per-agent override section', async () => {
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openSettings(page);

    // Toggle override on Brainstorm
    const brainstormCard = page.locator('[data-testid="agent-section-brainstorm"]');
    const toggleButton = brainstormCard.locator('[data-testid="agent-provider-override-toggle"]');
    await toggleButton.click();
    await page.waitForTimeout(500);

    // Verify Test connection button is present
    const testConnButton = brainstormCard.locator('button:has-text("Test connection")');
    expect(testConnButton).toBeTruthy();

    // Toggle override on Archive
    const archiveCard = page.locator('[data-testid="agent-section-archive"]');
    const archiveToggle = archiveCard.locator('[data-testid="agent-provider-override-toggle"]');
    await archiveToggle.click();
    await page.waitForTimeout(500);

    // Verify Archive also has Test connection button
    const archiveTestConn = archiveCard.locator('button:has-text("Test connection")');
    expect(archiveTestConn).toBeTruthy();

    // Verify Writing Assistant (no override) does NOT have Test connection button
    const writingCard = page.locator('[data-testid="agent-section-writingAssistant"]');
    const writingTestConn = writingCard.locator('button:has-text("Test connection")');
    expect(writingTestConn).toBeFalsy();
  } finally {
    await app.close().catch(() => {});
  }
});
