/**
 * onboarding-sample.spec.ts — SKY-12.5 / TC-OB-S01
 *
 * Path D: "Open sample project" onboarding flow.
 * Fresh userData → wizard → click card-sample → type parent path →
 * open-sample (IPC mocked to copy from repo sample-project/) →
 * DesktopShell renders → Story Vault/The Glass Library exists on disk.
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
const SAMPLE_PROJECT_DIR = path.resolve(__dirname, '../../sample-project');

async function launchFreshApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

let userData: string;
let vaultParent: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-sample-ud-'));
  vaultParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-sample-vp-'));
  app = await launchFreshApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultParent, { recursive: true, force: true });
});

test('TC-OB-S01: sample project — wizard completes, DesktopShell loads, Glass Library story on disk', async () => {
  await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });

  await page.locator('[data-testid="card-sample"]').click();
  await expect(page.locator('[data-testid="screen-sample-path"]')).toBeVisible({ timeout: 8_000 });

  await app.evaluate(
    ({ app: electronApp, ipcMain }, { sampleDir }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fsModule = require('fs') as typeof import('fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pathModule = require('path') as typeof import('path');

      ipcMain.removeHandler('vault:load-sample-twovault');
      ipcMain.handle('vault:load-sample-twovault', (_: unknown, payload: { parentPath: string }) => {
        const storyVaultPath = pathModule.join(payload.parentPath, 'Story Vault');
        const notesVaultPath = pathModule.join(payload.parentPath, 'Notes Vault');
        fsModule.cpSync(pathModule.join(sampleDir, 'story-vault'), storyVaultPath, { recursive: true, force: false });
        fsModule.cpSync(pathModule.join(sampleDir, 'notes-vault'), notesVaultPath, { recursive: true, force: false });
        const userData = electronApp.getPath('userData');
        fsModule.writeFileSync(
          pathModule.join(userData, 'vault-settings.json'),
          JSON.stringify({ vaultRoot: storyVaultPath, notesVaultRoot: notesVaultPath, layoutMode: 'default' }),
        );
        return { storyVaultPath, notesVaultPath };
      });
    },
    { sampleDir: SAMPLE_PROJECT_DIR },
  );

  await page.locator('[data-testid="sample-path-input"]').fill(vaultParent);

  const openBtn = page.locator('[data-testid="open-sample"]');
  await expect(openBtn).not.toBeDisabled({ timeout: 5_000 });
  await openBtn.click();

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

  const storyVault = path.join(vaultParent, 'Story Vault');
  const notesVault = path.join(vaultParent, 'Notes Vault');

  expect(fs.existsSync(path.join(storyVault, 'The Glass Library')), 'Story Vault must contain The Glass Library').toBe(true);

  const glManuscript = path.join(storyVault, 'The Glass Library', 'Manuscript');
  expect(fs.existsSync(glManuscript), 'The Glass Library/Manuscript must exist').toBe(true);

  const ch1 = path.join(glManuscript, '01 - Opening');
  const ch1Scenes = fs.existsSync(ch1) ? fs.readdirSync(ch1).filter((f) => f.endsWith('.md')) : [];
  expect(ch1Scenes.length, 'At least one .md scene in Opening chapter').toBeGreaterThan(0);

  const argentDir = path.join(notesVault, 'Universes', 'Argent');
  expect(fs.existsSync(argentDir), 'Notes Vault must contain Universes/Argent from sample bundle').toBe(true);
});
