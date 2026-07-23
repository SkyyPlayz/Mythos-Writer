/**
 * sky8111-error-screenshots.spec.ts — SKY-8111 evidence capture
 *
 * Not part of the CI suite. Launches the real built app twice against real
 * failing providers (no IPC mocking) and screenshots the Brainstorm error
 * banner to prove the Network vs Auth classification reaches the renderer:
 *   1. Ollama at an unreachable port  → "Network error — check your connection…"
 *   2. Provider returning HTTP 401    → "Authentication error — check your API key…"
 *
 * Run:  npx playwright test e2e/sky8111-error-screenshots.spec.ts --reporter=list
 * Output: docs/screenshots/sky-8111/{network-error,auth-error}.png
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-8111');

type ProviderSeed = { kind: string; model: string; baseUrl?: string; apiKey?: string };

function seedUserData(userData: string, vaultDir: string, provider: ProviderSeed): void {
  const agentDefaults = {
    enabled: false,
    model: 'claude-sonnet-4-6',
    autoApply: false,
    confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50,
    heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    provider,
    agents: {
      writingAssistant: { ...agentDefaults, scanIntervalSeconds: 30 },
      brainstorm: { ...agentDefaults, enabled: true, model: provider.model },
      archive: { ...agentDefaults, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: vaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function captureBrainstormError(provider: ProviderSeed, shotName: string, expectText: RegExp): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-8111-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-8111-vault-'));
  seedUserData(userData, vaultDir, provider);

  const app = await launchApp(userData);
  try {
    const page: Page = await app.firstWindow();
    page.on('dialog', (d) => { void d.accept().catch(() => undefined); });
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    await page.keyboard.press('Control+3');
    const panel = page.locator('#app-tabpanel-brainstorm');
    await expect(panel).toBeVisible({ timeout: 6_000 });

    const input = panel.getByRole('textbox', { name: 'Brainstorm prompt' });
    await input.fill('Give me a character idea');
    await panel.getByRole('button', { name: 'Send' }).click();

    const error = panel.getByText(expectText).first();
    await expect(error).toBeVisible({ timeout: 20_000 });

    fs.mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUT_DIR, `${shotName}.png`) });
  } finally {
    await app.close().catch(() => undefined);
  }
}

test.describe('SKY-8111 error classification screenshots', () => {
  test('network: Ollama unreachable port shows Network error', async () => {
    await captureBrainstormError(
      { kind: 'ollama', model: 'llama3', baseUrl: 'http://127.0.0.1:59999/v1' },
      'network-error',
      /Network error — check your connection/i,
    );
  });

  test('auth: provider rejecting the key shows Authentication error', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      await captureBrainstormError(
        { kind: 'custom', model: 'test-model', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'sk-bad-key' },
        'auth-error',
        /Authentication error — check your API key/i,
      );
    } finally {
      server.close();
    }
  });
});
