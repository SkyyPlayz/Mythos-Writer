/**
 * windows-quit-teardown-after-vault-ops.spec.ts — SKY-10910
 *
 * SKY-10902 fixed "app can't be closed" by giving every quit-teardown step
 * (watchers, DB close, lockfile release) its own bounded timeout so a single
 * hung step — observed as a Windows fs.watch handle that never settles after
 * a failed vault-move — can't hold the process hostage. quitTeardown.test.ts
 * covers the timeout/isolation logic with MOCKED timers, which proves the
 * function's contract but cannot catch a real hang: a mocked clock never
 * actually blocks. This spec is the regression guard mocked timers can't be —
 * it runs each vault-lifecycle operation for real on native Windows, then
 * closes every window and asserts the real Electron process actually exits
 * within a bounded wall-clock window.
 *
 * Deliberately scoped to one operation per test (move, delete, rename,
 * migration) rather than one long chained run — an isolated app instance per
 * op keeps a hang in one teardown path from masking a hang in another, and
 * keeps failures attributable.
 *
 * Run:
 *   npx playwright test e2e/tests/windows-quit-teardown-after-vault-ops.spec.ts --reporter=list
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
// Generous relative to quitTeardown's per-step 3s default timeout (7 steps,
// worst case ~21s if every single one hung) — a real regression here would
// blow well past this, an app closing normally lands in well under a second.
const QUIT_BOUND_MS = 25_000;

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

function seedMinimalStory(vaultDir: string): void {
  fs.mkdirSync(path.join(vaultDir, 'stories', 'story-1', 'chapters', 'chapter-1', 'scenes'), { recursive: true });
  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1, version: 1, vaultRoot: vaultDir,
      stories: [{
        id: 'story-1', title: 'Vault Chronicles',
        chapters: [{
          id: 'chapter-1', title: 'The First Chamber',
          scenes: [{ id: 'scene-1', title: 'Opening', path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md' }],
        }],
      }],
      entities: [], suggestions: [], provenance: [], boards: [],
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, 'stories', 'story-1', 'chapters', 'chapter-1', 'scenes', 'Opening.md'),
    'The vault held every secret the kingdom had ever kept.\n',
  );
}

async function launchApp(userData: string, envOverrides: Record<string, string> = {}): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...envOverrides }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env,
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

/**
 * Close every window and wait for the underlying OS process to actually
 * exit, with a bound. Returns the elapsed ms, or throws if the bound is
 * exceeded — the exact "app can't be closed" failure mode.
 */
async function closeAllWindowsAndAwaitExit(app: ElectronApplication, boundMs: number): Promise<number> {
  const proc = app.process();
  const start = Date.now();
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((r) => setTimeout(() => r(true), boundMs)),
  ]);
  if (timedOut) {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    throw new Error(`Electron process did not exit within ${boundMs}ms of window close`);
  }
  return Date.now() - start;
}

test.describe('SKY-10902 (native Windows): app quits within bounded time after real vault ops', () => {
  test('after a local-folder vault move', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-win-quit-move-'));
    const userData = path.join(tmp, 'user-data');
    const storyVault = path.join(tmp, 'Story Vault');
    const notesVault = path.join(tmp, 'Notes Vault');
    const targetVault = path.join(tmp, 'Moved Vault');
    fs.mkdirSync(notesVault, { recursive: true });
    fs.mkdirSync(targetVault, { recursive: true });
    seedMinimalStory(storyVault);
    seedUserData(userData, storyVault, notesVault);
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

      await app.evaluate(({ dialog }, target: string) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
      }, targetVault);

      await page.locator('.app-menu-gear-btn').click();
      await page.getByRole('tab', { name: 'Sync & Backup' }).click();
      await page.locator('[data-testid="sync-move-vault"]').click();
      await page.locator('[data-testid="mv-browse"]').click();
      await page.locator('[data-testid="mv-next-folder"]').click();
      await page.locator('[data-testid="mv-proceed-confirm"]').click();
      await expect(page.locator('[data-testid="mv-test-ok"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="mv-migrate"]').click();
      await expect(page.locator('[data-testid="mv-success-message"]')).toBeVisible({ timeout: 15_000 });

      // This is the exact SKY-10895/SKY-10902 sequence: the move just rebound
      // the Story Vault watcher/DB to the new path, and quit must still be
      // able to tear that down cleanly within the bound.
      const elapsed = await closeAllWindowsAndAwaitExit(app, QUIT_BOUND_MS);
      console.log(`[quit-teardown] move: exited in ${elapsed}ms`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('after Clear all data (delete)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-win-quit-delete-'));
    const userData = path.join(tmp, 'user-data');
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

      await app.evaluate(({ dialog }) => {
        (dialog as unknown as Record<string, unknown>).showMessageBox =
          async () => ({ response: 1, checkboxChecked: false });
      });
      await page.locator('.app-menu-gear-btn').click();
      await page.getByRole('tab', { name: 'Vault & Files' }).click();
      await page.locator('[data-testid="clear-data-danger-zone"]').scrollIntoViewIfNeeded();
      await page.locator('[data-testid="clear-data-btn"]').click();
      await page.locator('[data-testid="clear-data-confirm-btn"]').click();
      await expect(page.locator('[data-testid="clear-data-success"]')).toBeVisible({ timeout: 20_000 });

      const elapsed = await closeAllWindowsAndAwaitExit(app, QUIT_BOUND_MS);
      console.log(`[quit-teardown] delete: exited in ${elapsed}ms`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('after an in-vault folder rename', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-win-quit-rename-'));
    const userData = path.join(tmp, 'user-data');
    const vaultDir = path.join(tmp, 'Story Vault');
    const notesVaultDir = path.join(tmp, 'Notes Vault');
    fs.mkdirSync(vaultDir, { recursive: true });
    fs.mkdirSync(path.join(notesVaultDir, 'Worldbuilding'), { recursive: true });
    seedUserData(userData, vaultDir, notesVaultDir);
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      // Vault Browser's one home is the Notes Editor tab (SKY-9022/M6).
      await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
      await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });
      await expect(page.locator('[data-testid="vb-row-Worldbuilding"]')).toBeVisible({ timeout: 10_000 });

      await page.locator('[data-testid="vb-row-Worldbuilding"]').click({ button: 'right' });
      await page.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-rename"]').click();
      const input = page.locator('.vb-rename-input');
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill('Cosmology');
      await input.press('Enter');
      await expect(page.locator('[data-testid="vb-row-Cosmology"]')).toBeVisible({ timeout: 10_000 });

      const elapsed = await closeAllWindowsAndAwaitExit(app, QUIT_BOUND_MS);
      console.log(`[quit-teardown] rename: exited in ${elapsed}ms`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('after a silent boot migration', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-win-quit-migrate-'));
    const userData = path.join(tmp, 'user-data');
    const bundle = path.join(tmp, 'My Vault');
    const vaultDir = path.join(bundle, 'Story Vault');
    const notesVaultDir = path.join(bundle, 'Notes Vault');
    fs.mkdirSync(path.join(vaultDir, 'Manuscript'), { recursive: true });
    fs.mkdirSync(notesVaultDir, { recursive: true });
    seedUserData(userData, vaultDir, notesVaultDir);
    fs.writeFileSync(
      path.join(vaultDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1, version: '2.0.0', vaultRoot: vaultDir,
        stories: [], entities: [], suggestions: [], scenes: [], chapters: [],
        provenance: {}, boardReferences: [],
      }),
    );
    const app = await launchApp(userData, { MYTHOS_DISABLE_BOOT_MIGRATION: '0' });
    try {
      const page = await firstWindow(app);
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);

      const elapsed = await closeAllWindowsAndAwaitExit(app, QUIT_BOUND_MS);
      console.log(`[quit-teardown] migration: exited in ${elapsed}ms`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
