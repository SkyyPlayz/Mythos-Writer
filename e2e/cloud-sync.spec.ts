/**
 * cloud-sync.spec.ts — SKY-865
 *
 * E2E coverage for the Wave 2.B Cloud-Sync flow:
 * - Settings → Move vault wizard happy path with mocked folder picker and move IPC
 * - Dropbox-style conflict warning with archive messaging
 * - Stale lockfile/concurrent-session warning with explicit user override
 * - In-app setup/troubleshooting help copy in Settings
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/cloud-sync.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

type ConflictMode = 'none' | 'dropbox' | 'lockfile';

interface TestDirs {
  userData: string;
  storyVault: string;
  notesVault: string;
  targetVault: string;
}

function makeDirs(prefix: string): TestDirs {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const userData = path.join(root, 'user-data');
  const storyVault = path.join(root, 'Story Vault');
  const notesVault = path.join(root, 'Notes Vault');
  const targetVault = path.join(root, 'Dropbox', 'Mythos Story Vault');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.mkdirSync(targetVault, { recursive: true });
  fs.writeFileSync(
    path.join(storyVault, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, stories: [], scenes: [] }, null, 2),
  );
  return { userData, storyVault, notesVault, targetVault };
}

function cleanupDirs(dirs: TestDirs): void {
  fs.rmSync(path.dirname(dirs.userData), { recursive: true, force: true });
}

function seedUserData(dirs: TestDirs): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(dirs.userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(dirs.userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: dirs.storyVault, notesVaultRoot: dirs.notesVault }, null, 2),
  );
}

async function launchApp(dirs: TestDirs, conflictMode: ConflictMode): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${dirs.userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, HOME: dirs.userData },
    timeout: 60_000,
  });

  await app.evaluate(
    ({ ipcMain }, args: { storyVault: string; notesVault: string; targetVault: string; conflictMode: ConflictMode }) => {
      (globalThis as any).__cloudSyncDismissCalls = 0;

      ipcMain.removeHandler('vault:getPaths');
      ipcMain.handle('vault:getPaths', () => ({
        storyVaultPath: args.storyVault,
        notesVaultPath: args.notesVault,
      }));

      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({
        cancelled: false,
        vaultRoot: args.targetVault,
        registrationToken: 'e2e-registration-token',
      }));

      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: true, isEmpty: true, writable: true }));

      ipcMain.removeHandler('vault:guidedFolderMove');
      ipcMain.handle('vault:guidedFolderMove', (_event, payload) => ({
        moved: true,
        newVaultPath: payload.targetPath,
      }));

      ipcMain.removeHandler('vault:check-conflicts');
      ipcMain.handle('vault:check-conflicts', () => {
        if (args.conflictMode === 'dropbox') {
          return {
            dismissed: false,
            resolved: [
              {
                conflictPath: 'Manuscript/Ch01/Opening (conflicted copy 2026-06-10).md',
                originalPath: 'Manuscript/Ch01/Opening.md',
                provider: 'dropbox',
                keptPath: 'Manuscript/Ch01/Opening.md',
                archivedPath: '.mythos/.archive/2026-06-10T18-00-00Z/Opening (conflicted copy 2026-06-10).md',
                resolvedAt: '2026-06-10T18:00:00.000Z',
              },
            ],
          };
        }
        if (args.conflictMode === 'lockfile') {
          return {
            dismissed: false,
            resolved: [],
            lockfileConflict: {
              hostname: 'other-laptop.local',
              pid: 4242,
              timestamp: '2026-06-10T18:00:00.000Z',
            },
          };
        }
        return { dismissed: true, resolved: [] };
      });

      ipcMain.removeHandler('vault:dismiss-sync-warning');
      ipcMain.handle('vault:dismiss-sync-warning', () => {
        (globalThis as any).__cloudSyncDismissCalls += 1;
        return { ok: true };
      });
    },
    {
      storyVault: dirs.storyVault,
      notesVault: dirs.notesVault,
      targetVault: dirs.targetVault,
      conflictMode,
    },
  );

  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  return page;
}

async function openSettings(page: Page): Promise<void> {
  // SKY-3177: AppNavRail adds a second "Open settings" button; target the menu bar one.
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
}

test('cloud sync help is visible from Settings with setup and troubleshooting copy', async () => {
  const dirs = makeDirs('mythos-cloud-help');
  seedUserData(dirs);
  const app = await launchApp(dirs, 'none');
  try {
    const page = await firstWindow(app);
    await openSettings(page);

    await expect(page.getByText(/Setup guide/i)).toBeVisible();
    await expect(page.getByText(/Vault not found/i)).toBeVisible();
    await expect(page.getByText(/Permission denied/i)).toBeVisible();
    await expect(page.getByText(/Sync client not detected/i)).toBeVisible();
    await expect(page.getByText(/Dropbox, iCloud, OneDrive, or Google Drive/i)).toBeVisible();
  } finally {
    await app.close().catch(() => {});
    cleanupDirs(dirs);
  }
});

test('wizard happy path chooses Dropbox, picks a folder, migrates, and reports the new vault', async () => {
  const dirs = makeDirs('mythos-cloud-happy');
  seedUserData(dirs);
  const app = await launchApp(dirs, 'none');
  try {
    const page = await firstWindow(app);
    await openSettings(page);

    await page.locator('[data-testid="move-vault-btn"]').click();
    await expect(page.getByRole('dialog', { name: /move vault to cloud sync/i })).toBeVisible();

    await page.locator('[data-testid="provider-option-dropbox"]').click();
    await page.locator('[data-testid="mv-next-provider"]').click();
    await page.locator('[data-testid="mv-browse"]').click();
    await expect(page.locator('[data-testid="mv-folder-display"]')).toHaveValue(dirs.targetVault);
    await page.locator('[data-testid="mv-next-folder"]').click();

    await expect(page.locator('[data-testid="mv-from-path"]')).toContainText(dirs.storyVault);
    await expect(page.locator('[data-testid="mv-to-path"]')).toContainText(dirs.targetVault);
    await page.locator('[data-testid="mv-confirm-checkbox"]').check();
    await page.locator('[data-testid="mv-proceed-confirm"]').click();

    await expect(page.locator('[data-testid="mv-test-ok"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="mv-migrate"]').click();
    await expect(page.locator('[data-testid="mv-success-message"]')).toContainText(/vault moved successfully/i);
    await expect(page.locator('[data-testid="mv-new-path"]')).toContainText(dirs.targetVault);
    await page.locator('[data-testid="mv-done"]').click();

    await expect(page.locator('[data-testid="cloud-sync-status"]')).toContainText('Synced via Dropbox');
    await expect(page.locator('#story-vault-path-input')).toHaveValue(dirs.targetVault);
  } finally {
    await app.close().catch(() => {});
    cleanupDirs(dirs);
  }
});

test('Dropbox-style conflict warning shows archive details and can be suppressed', async () => {
  const dirs = makeDirs('mythos-cloud-conflict');
  seedUserData(dirs);
  const app = await launchApp(dirs, 'dropbox');
  try {
    const page = await firstWindow(app);

    const dialog = page.getByRole('dialog', { name: /sync conflict detected/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Dropbox')).toBeVisible();
    await expect(dialog.getByText(/last-modified wins/i)).toBeVisible();
    await expect(dialog.getByText(/\.mythos\/\.archive\//i)).toBeVisible();
    await expect(dialog.getByText(/archived older copy/i)).toBeVisible();
    await expect(dialog.locator('.scm-provider-badge--dropbox')).toHaveText('Dropbox');

    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: /continue/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    const dismissCalls = await app.evaluate(() => (globalThis as any).__cloudSyncDismissCalls);
    expect(dismissCalls).toBe(1);
  } finally {
    await app.close().catch(() => {});
    cleanupDirs(dirs);
  }
});

test('stale lockfile warning identifies the other host and lets the user continue', async () => {
  const dirs = makeDirs('mythos-cloud-lockfile');
  seedUserData(dirs);
  const app = await launchApp(dirs, 'lockfile');
  try {
    const page = await firstWindow(app);

    const dialog = page.getByRole('dialog', { name: /sync conflict detected/i });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(/Concurrent session warning/i)).toBeVisible();
    await expect(dialog.getByText(/other-laptop\.local/i)).toBeVisible();
    await expect(dialog.getByText(/4242/)).toBeVisible();

    await dialog.getByRole('button', { name: /continue/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await app.close().catch(() => {});
    cleanupDirs(dirs);
  }
});
