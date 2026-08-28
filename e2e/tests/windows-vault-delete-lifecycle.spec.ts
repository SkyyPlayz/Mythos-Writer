/**
 * windows-vault-delete-lifecycle.spec.ts — SKY-10910
 *
 * Native-Windows port of mythos-migration.spec.ts's TC-MV-05 (Settings →
 * Danger zone → "Clear all data"). SKY-8882 ("old vault not deleted on
 * Windows") was independently closed as fixed three separate times on the
 * strength of Linux-only E2E — POSIX allows removing a directory tree with
 * open handles inside it, Windows does not (EBUSY/EPERM), so a delete path
 * that only *appears* to work can leave the vault directory behind on disk
 * while the app reports success. This spec drives the real Settings UI →
 * real IPC → real fs.rm on a native Windows runner and asserts the vault
 * directory is actually gone, not just DB-marked or UI-hidden.
 *
 * The only mock is the native keep-vs-delete MessageBox — Playwright cannot
 * drive OS dialogs. Everything downstream (the uninstallHelper delete path)
 * is real.
 *
 * Run:
 *   npx playwright test e2e/tests/windows-vault-delete-lifecycle.spec.ts --reporter=list
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

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env },
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
}

test('SKY-8882 (native Windows): Delete Everything actually removes the vault directory from disk', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-win-delete-'));
  const userData = path.join(tmp, 'user-data');
  // Default layout: both vaults under <userData>/vaults, matching the
  // owner's real Windows machine layout that SKY-8882 was filed against.
  const bundle = path.join(userData, 'vaults', 'Mythos Vault');
  const vaultDir = path.join(bundle, 'Story Vault');
  const notesVaultDir = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // The ONLY patch: auto-answer the native keep-vs-delete MessageBox with
    // "Delete Everything" (button index 1). Everything downstream is real.
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as Record<string, unknown>).showMessageBox =
        async () => ({ response: 1, checkboxChecked: false });
    });

    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();
    const dangerZone = page.locator('[data-testid="clear-data-danger-zone"]');
    await dangerZone.scrollIntoViewIfNeeded();
    await page.locator('[data-testid="clear-data-btn"]').click();
    await page.locator('[data-testid="clear-data-confirm-btn"]').click();

    await expect(page.locator('[data-testid="clear-data-success"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="clear-data-errors"]')).toHaveCount(0);

    // The exact SKY-8882 defect class: the vault directory tree is actually
    // gone from disk on Windows, not merely unlinked from settings while an
    // open watcher/DB handle keeps the directory itself alive (EBUSY).
    expect(fs.existsSync(path.join(userData, 'vaults'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'vault-settings.json'))).toBe(false);
    expect(fs.existsSync(path.join(userData, 'app-settings.json'))).toBe(false);

    // …and stays gone — nothing resurrects a seeded vault after the delete.
    await page.waitForTimeout(2_500);
    expect(fs.existsSync(path.join(userData, 'vaults'))).toBe(false);
  } finally {
    await closeApp(app);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
