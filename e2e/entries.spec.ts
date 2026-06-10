/**
 * entries.spec.ts — SKY-898 / GH-305
 *
 * E2E tests for the Entries quick-capture workflow:
 *   TC-ENT-01  Create  — type a body + submit → entry appears in list
 *   TC-ENT-02  Promote — click "Promote to Note" → markdown file written to notes vault
 *
 * No AI streaming is involved; tests focus on the capture → promote path
 * which requires only the notesVault IPC handlers (no stream:start mock needed).
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
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
});

test.afterAll(async () => {
  await app.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-ENT-01: Create entry ──────────────────────────────────────────────────

test('TC-ENT-01: navigates to Entries view and shows empty state', async () => {
  await page.click('[data-testid="view-btn-entries"]');
  await expect(page.locator('[data-testid="entries-panel"]')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-testid="entries-empty"]')).toBeVisible({ timeout: 4_000 });
});

test('TC-ENT-01b: creates an entry and it appears in the list', async () => {
  const body = 'A mysterious library appears in the forest';

  await page.fill('[data-testid="entry-body-input"]', body);
  await page.fill('[data-testid="entry-tags-input"]', 'setting, mystery');
  await page.click('[data-testid="entry-add-btn"]');

  // Entry should appear in list
  const list = page.locator('[data-testid="entries-list"]');
  await expect(list).toContainText(body, { timeout: 6_000 });

  // Empty state should be gone
  await expect(page.locator('[data-testid="entries-empty"]')).not.toBeVisible();

  // Entry file should exist in vault
  const entriesDir = path.join(vaultDir, 'Entries');
  await expect
    .poll(() => fs.existsSync(entriesDir) && fs.readdirSync(entriesDir).length > 0, { timeout: 5_000 })
    .toBe(true);

  const files = fs.readdirSync(entriesDir).filter((f) => f.endsWith('.md'));
  expect(files.length).toBeGreaterThan(0);

  const content = fs.readFileSync(path.join(entriesDir, files[0]), 'utf8');
  expect(content).toContain('entry: true');
  expect(content).toContain(body);
});

// ─── TC-ENT-02: Promote to Note ───────────────────────────────────────────────

test('TC-ENT-02: promotes entry directly to a notes vault file', async () => {
  // Click the "Promote to Note" button on the first entry
  const promoteBtn = page.locator('[data-testid="entry-promote-btn"]').first();
  await expect(promoteBtn).toBeVisible({ timeout: 4_000 });
  await promoteBtn.click();

  // Feedback message should appear
  await expect(page.locator('[data-testid="entries-feedback"]')).toBeVisible({ timeout: 5_000 });

  // A note file should be created in the notes directory
  const notesDir = path.join(vaultDir, 'notes');
  await expect
    .poll(() => fs.existsSync(notesDir) && fs.readdirSync(notesDir).filter((f) => f.endsWith('.md')).length > 0, { timeout: 6_000 })
    .toBe(true);

  const noteFiles = fs.readdirSync(notesDir).filter((f) => f.endsWith('.md'));
  expect(noteFiles.length).toBeGreaterThan(0);

  const noteContent = fs.readFileSync(path.join(notesDir, noteFiles[0]), 'utf8');
  expect(noteContent).toContain('source: promoted-entry');
  expect(noteContent).toContain('sourceEntry: Entries/');

  // Entry in the list should show "Promoted" badge
  await expect(page.locator('.entries-promoted-badge').first()).toBeVisible({ timeout: 5_000 });
});
