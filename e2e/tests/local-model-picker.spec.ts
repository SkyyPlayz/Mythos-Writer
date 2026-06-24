/**
 * local-model-picker.spec.ts — SKY-1502 / SKY-1459
 *
 * E2E coverage for the Local Model Picker v0 acceptance criteria:
 * - AC-1: per-agent picker render
 * - AC-2: Ollama model list dropdown (mocked IPC)
 * - AC-3: Ollama-not-running hint (mocked IPC failure)
 * - AC-4: Custom OpenAI-compatible model listing (mocked IPC)
 * - AC-8: fresh install defaults
 * - AC-9: upgrade preserves existing model settings
 * - AC-10: per-agent test-connection independence (mocked IPC)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
  type Locator,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

type ProviderListResponse = { ok: true; models: string[] } | { ok: false; error: string };
type ProviderResponses = Record<string, ProviderListResponse>;

type AgentSettings = {
  enabled: boolean;
  model: string;
  scanIntervalSeconds?: number;
  continuityCheckIntervalSeconds?: number;
  autoApply: boolean;
  confidenceThreshold: number;
  maxTokensPerHour: number;
  maxSuggestionsPerHour: number;
  heartbeatIntervalMinutes: number;
  maxTokensPerDay: number;
  provider?: {
    kind: string;
    apiKey?: string;
    baseUrl?: string;
    model: string;
  };
};

type AppSettingsSeed = {
  apiKey: string;
  onboardingComplete: boolean;
  provider?: {
    kind: string;
    apiKey?: string;
    baseUrl?: string;
    model: string;
  };
  agents: {
    writingAssistant: AgentSettings;
    brainstorm: AgentSettings;
    archive: AgentSettings;
  };
  theme: string;
  snapshots: { maxPerScene: number; maxAgeDays: number };
};

const budgets = {
  autoApply: false,
  confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000,
  maxSuggestionsPerHour: 50,
  heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500_000,
};

function baseSettings(): AppSettingsSeed {
  return {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        ...budgets,
      },
      brainstorm: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        ...budgets,
      },
      archive: {
        enabled: true,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        ...budgets,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
}

function seedUserData(
  userData: string,
  storyVault: string,
  notesVault: string,
  settings: AppSettingsSeed = baseSettings(),
): void {
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const proc = app.process();
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch {
    // Already exited.
  }
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return page;
}

async function installProviderMocks(app: ElectronApplication, responses: ProviderResponses = {}): Promise<void> {
  await app.evaluate(async ({ ipcMain }, providerResponses: ProviderResponses) => {
    ipcMain.removeHandler('provider:listModels');
    ipcMain.handle('provider:listModels', async (_event, payload: { kind?: string }) => {
      const kind = String(payload?.kind ?? '');
      return providerResponses[kind] ?? { ok: true, models: [] };
    });

    ipcMain.removeHandler('settings:testConnection');
    ipcMain.handle('settings:testConnection', async (_event, payload: { provider?: { kind?: string } }) => {
      const kind = payload?.provider?.kind;
      if (kind === 'ollama') return { ok: false, latencyMs: 9, error: 'Mock Ollama connection failed' };
      return { ok: true, latencyMs: 12 };
    });
  }, responses);
}

async function openSettings(page: Page): Promise<void> {
  // SKY-3177: AppNavRail adds a second "Open settings" button; target the menu bar one.
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Provider Configuration' })).toBeVisible();
}

function agentCard(page: Page, name: 'Writing Assistant' | 'Brainstorm Agent' | 'Archive Agent'): Locator {
  return page.locator('.settings-agent-card').filter({ hasText: name });
}

async function enableAgentOverride(card: Locator, agentName: string): Promise<void> {
  const toggle = card.getByLabel(`Enable ${agentName} provider override`);
  // The actual checkbox is visually hidden behind the custom toggle track, so
  // dispatch the same change event React receives from a real toggle click.
  await toggle.evaluate((input: HTMLInputElement) => input.click());
  await expect(toggle).toBeChecked();
}

let userData: string;
let storyVault: string;
let notesVault: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lmp-ud-'));
  storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lmp-story-'));
  notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-lmp-notes-'));
});

test.afterEach(async () => {
  await closeApp(app);
  app = undefined;
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(storyVault, { recursive: true, force: true });
  fs.rmSync(notesVault, { recursive: true, force: true });
});

test('TC-LMP-01 / AC-8: fresh install defaults all agents to the global Anthropic provider', async () => {
  seedUserData(userData, storyVault, notesVault);
  app = await launchApp(userData);
  await installProviderMocks(app);
  page = await firstWindow(app);

  await openSettings(page);

  await expect(page.getByLabel('AI provider')).toHaveValue('anthropic');
  for (const [cardName, modelLabel] of [
    ['Writing Assistant', 'Writing Assistant model'],
    ['Brainstorm Agent', 'Brainstorm Agent model'],
    ['Archive Agent', 'Archive Agent model'],
  ] as const) {
    const card = agentCard(page, cardName);
    await expect(card).toContainText('Using global provider (Anthropic (Claude))');
    await expect(card.getByLabel(modelLabel)).toHaveValue('claude-sonnet-4-6');
    await expect(card.getByLabel(`Enable ${cardName === 'Writing Assistant' ? 'writingAssistant' : cardName === 'Brainstorm Agent' ? 'brainstorm' : 'archive'} provider override`)).not.toBeChecked();
  }
});

test('TC-LMP-02 / AC-1: per-agent picker renders and global provider changes only non-overridden agents', async () => {
  seedUserData(userData, storyVault, notesVault);
  app = await launchApp(userData);
  await installProviderMocks(app);
  page = await firstWindow(app);

  await openSettings(page);

  const brainstorm = agentCard(page, 'Brainstorm Agent');
  await enableAgentOverride(brainstorm, 'brainstorm');
  await expect(brainstorm.getByLabel('Provider for brainstorm')).toBeVisible();
  await expect(brainstorm.getByLabel('Model for brainstorm')).toBeVisible();
  await expect(brainstorm.getByRole('button', { name: 'Test provider connection for brainstorm' })).toBeVisible();
  await expect(brainstorm.getByRole('button', { name: 'Refresh models for brainstorm' })).not.toBeVisible();

  await brainstorm.getByLabel('Provider for brainstorm').selectOption('openai');
  await expect(brainstorm.getByRole('button', { name: 'Refresh models for brainstorm' })).toBeVisible();

  const writing = agentCard(page, 'Writing Assistant');
  const archive = agentCard(page, 'Archive Agent');
  await expect(writing).toContainText('Using global provider (Anthropic (Claude))');
  await expect(archive).toContainText('Using global provider (Anthropic (Claude))');

  await page.getByLabel('AI provider').selectOption('openai');
  await expect(writing).toContainText('Using global provider (OpenAI)');
  await expect(archive).toContainText('Using global provider (OpenAI)');
  await expect(brainstorm.getByLabel('Provider for brainstorm')).toHaveValue('openai');
});

test('TC-LMP-03 / AC-3: Ollama-not-running shows an inline user-friendly hint', async () => {
  seedUserData(userData, storyVault, notesVault);
  app = await launchApp(userData);
  await installProviderMocks(app, {
    ollama: { ok: false, error: 'ECONNREFUSED 127.0.0.1:11434' },
  });
  page = await firstWindow(app);

  await openSettings(page);

  const writing = agentCard(page, 'Writing Assistant');
  await enableAgentOverride(writing, 'writingAssistant');
  await writing.getByLabel('Provider for writingAssistant').selectOption('ollama');

  await expect(writing.getByLabel('Base URL for writingAssistant')).toHaveValue('http://127.0.0.1:11434/v1');
  await expect(writing).toContainText('Ollama is not running. Start it with ollama serve.');
  await expect(writing.getByText(/ECONNREFUSED|fetch failed|network/i)).not.toBeVisible();
});

test('TC-LMP-04 / AC-4: custom OpenAI-compatible endpoint populates model dropdown from mocked IPC', async () => {
  seedUserData(userData, storyVault, notesVault);
  app = await launchApp(userData);
  await installProviderMocks(app, {
    custom: { ok: true, models: ['gpt-4o', 'gpt-4o-mini'] },
  });
  page = await firstWindow(app);

  await openSettings(page);

  const archive = agentCard(page, 'Archive Agent');
  await enableAgentOverride(archive, 'archive');
  await archive.getByLabel('Provider for archive').selectOption('custom');
  await archive.getByLabel('Base URL for archive').fill('https://api.custom-provider.local/v1');
  await archive.getByLabel('API key for archive').fill('test-key-123');
  await archive.getByRole('button', { name: 'Refresh models for archive' }).click();

  const model = archive.getByLabel('Model for archive');
  await expect(model).toHaveJSProperty('tagName', 'SELECT');
  await expect(model.locator('option')).toHaveText(['gpt-4o', 'gpt-4o-mini', 'Custom…']);
  await model.selectOption('gpt-4o-mini');
  await expect(model).toHaveValue('gpt-4o-mini');
});

test('TC-LMP-05 / AC-2: Ollama model list populates a per-agent dropdown from mocked IPC', async () => {
  seedUserData(userData, storyVault, notesVault);
  app = await launchApp(userData);
  await installProviderMocks(app, {
    ollama: { ok: true, models: ['llama3', 'mistral', 'neural-chat'] },
  });
  page = await firstWindow(app);

  await openSettings(page);

  const brainstorm = agentCard(page, 'Brainstorm Agent');
  await enableAgentOverride(brainstorm, 'brainstorm');
  await brainstorm.getByLabel('Provider for brainstorm').selectOption('ollama');
  await brainstorm.getByRole('button', { name: 'Refresh models for brainstorm' }).click();

  const model = brainstorm.getByLabel('Model for brainstorm');
  await expect(model).toHaveJSProperty('tagName', 'SELECT');
  await expect(model.locator('option')).toContainText(['llama3', 'mistral', 'neural-chat', 'Custom…']);
  await model.selectOption('llama3');
  await expect(model).toHaveValue('llama3');
});

test('TC-LMP-06 / AC-9: upgrade preserves old model settings while using global provider', async () => {
  const settings = baseSettings();
  settings.agents.writingAssistant.model = 'claude-opus-4-7';
  settings.agents.brainstorm.model = 'claude-opus-4-7';
  settings.agents.archive.model = 'claude-opus-4-7';
  seedUserData(userData, storyVault, notesVault, settings);
  app = await launchApp(userData);
  await installProviderMocks(app);
  page = await firstWindow(app);

  await openSettings(page);

  const brainstorm = agentCard(page, 'Brainstorm Agent');
  await expect(brainstorm).toContainText('Using global provider (Anthropic (Claude))');
  await expect(brainstorm.getByLabel('Brainstorm Agent model')).toHaveValue('claude-opus-4-7');
  await expect(brainstorm.getByLabel('Enable brainstorm provider override')).not.toBeChecked();

  await page.getByLabel('AI provider').selectOption('openai');
  await expect(brainstorm).toContainText('Using global provider (OpenAI)');
  await expect(brainstorm.getByLabel('Brainstorm Agent model')).toHaveValue('claude-opus-4-7');

  await page.getByLabel('Save settings').click();
  await expect(page.getByLabel('Save settings')).toHaveText('Save');
  await page.getByLabel('Close settings').click();

  await openSettings(page);
  const reopenedBrainstorm = agentCard(page, 'Brainstorm Agent');
  await expect(page.getByLabel('AI provider')).toHaveValue('openai');
  await expect(reopenedBrainstorm).toContainText('Using global provider (OpenAI)');
  await expect(reopenedBrainstorm.getByLabel('Brainstorm Agent model')).toHaveValue('claude-opus-4-7');
});

test('TC-LMP-07 / AC-10: per-agent test-connection results are independent', async () => {
  seedUserData(userData, storyVault, notesVault);
  app = await launchApp(userData);
  await installProviderMocks(app, {
    ollama: { ok: true, models: ['llama3'] },
  });
  page = await firstWindow(app);

  await openSettings(page);

  const brainstorm = agentCard(page, 'Brainstorm Agent');
  await enableAgentOverride(brainstorm, 'brainstorm');
  await brainstorm.getByLabel('Provider for brainstorm').selectOption('openai');
  await brainstorm.getByRole('button', { name: 'Test provider connection for brainstorm' }).click();
  await expect(brainstorm.getByRole('status')).toHaveText('Connection successful');

  const archive = agentCard(page, 'Archive Agent');
  await enableAgentOverride(archive, 'archive');
  await archive.getByLabel('Provider for archive').selectOption('ollama');
  await archive.getByRole('button', { name: 'Test provider connection for archive' }).click();
  await expect(archive.getByRole('alert')).toHaveText('Mock Ollama connection failed');

  await expect(brainstorm.getByRole('status')).toHaveText('Connection successful');
  await expect(agentCard(page, 'Writing Assistant').getByRole('button', { name: /Test provider connection/ })).not.toBeVisible();
});
