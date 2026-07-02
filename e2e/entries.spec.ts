/**
 * entries.spec.ts — SKY-898 / GH-305
 *
 * E2E tests for the Entries quick-capture workflow in the Notes tab:
 *   TC-ENT-01  Navigate — Notes tab exposes the Quick Entry controls
 *   TC-ENT-01b Create   — type a raw entry + submit → markdown file written to notes vault
 *   TC-ENT-02  Undo     — undo removes the saved entry note
 *
 * The real AI stream is mocked so the capture path remains deterministic.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/entries.spec.ts --reporter=list
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
const MOCK_EXPANDED_NOTE = 'Expanded entry note: a mysterious forest library that invites future scene development.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant...-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function installStreamMock(app: ElectronApplication, expandedText: string): Promise<void> {
  await app.evaluate(
    async ({ ipcMain }, text: string) => {
      ipcMain.removeHandler('stream:start');
      ipcMain.handle('stream:start', async (event) => {
        const streamId = `entries-e2e-${Date.now()}`;

        void (async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream:token', { streamId, token: text });
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream:end', { streamId });
          }
        })();

        return { streamId };
      });
    },
    expandedText,
  );
}

async function openQuickEntry(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
  await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="entries-qa-textarea"]')).toBeVisible({ timeout: 5_000 });
}

async function savedEntryFiles(): Promise<string[]> {
  const entriesDir = path.join(vaultDir, 'Entries');
  if (!fs.existsSync(entriesDir)) return [];
  return fs.readdirSync(entriesDir).filter((f) => f.endsWith('.md'));
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ent-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ent-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await installStreamMock(app, MOCK_EXPANDED_NOTE);
  await openQuickEntry(page);
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
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-ENT-01: Quick entry surface ───────────────────────────────────────────

test('TC-ENT-01: Notes tab shows the Quick Entry surface in the Brainstorm panel', async () => {
  await openQuickEntry(page);
  await expect(page.locator('[data-testid="entries-qa-save-btn"]')).toBeVisible({ timeout: 4_000 });
});

test('TC-ENT-01b: saves an AI-expanded quick entry to the notes vault', async () => {
  const body = 'A mysterious library appears in the forest';

  await openQuickEntry(page);
  await page.fill('[data-testid="entries-qa-textarea"]', body);
  await page.click('[data-testid="entries-qa-save-btn"]');

  await expect(page.locator('[data-testid="entries-qa-toast"]')).toBeVisible({ timeout: 6_000 });
  await expect
    .poll(async () => (await savedEntryFiles()).length, { timeout: 5_000 })
    .toBeGreaterThan(0);

  const entriesDir = path.join(vaultDir, 'Entries');
  const files = await savedEntryFiles();
  const content = fs.readFileSync(path.join(entriesDir, files[0]), 'utf8');
  expect(content).toContain('entry: true');
  expect(content).toContain('source: quick-add');
  expect(content).toContain(MOCK_EXPANDED_NOTE);
});

// ─── TC-ENT-02: Undo saved quick entry ─────────────────────────────────────────

test('TC-ENT-02: Undo removes the saved quick-entry note', async () => {
  await openQuickEntry(page);
  const undoBtn = page.locator('[data-testid="entries-qa-undo-btn"]');
  await expect(undoBtn).toBeVisible({ timeout: 4_000 });
  await undoBtn.click();

  await expect(page.locator('[data-testid="entries-qa-toast"]')).not.toBeVisible({ timeout: 4_000 });
  await expect
    .poll(async () => (await savedEntryFiles()).length, { timeout: 5_000 })
    .toBe(0);
});
