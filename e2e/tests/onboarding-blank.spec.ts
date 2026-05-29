/**
 * onboarding-blank.spec.ts — SKY-12.5 / TC-OB-B01
 *
 * Path B: "Start blank" onboarding flow.
 * Fresh userData → wizard → click card-blank → type parent path →
 * create-blank-vault → DesktopShell renders → vault roots exist with only
 * manifest.json, no SKY-15 scaffold dirs.
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-blank-ud-'));
  vaultParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-blank-vp-'));
  app = await launchFreshApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultParent, { recursive: true, force: true });
});

test('TC-OB-B01: blank layout — wizard completes, DesktopShell loads, no scaffold created', async () => {
  await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });

  await page.locator('[data-testid="card-blank"]').click();
  await expect(page.locator('[data-testid="screen-blank-path"]')).toBeVisible({ timeout: 8_000 });

  await page.locator('[data-testid="blank-path-input"]').fill(vaultParent);

  const createBtn = page.locator('[data-testid="create-blank-vault"]');
  await expect(createBtn).not.toBeDisabled({ timeout: 5_000 });
  await createBtn.click();

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

  const storyVault = path.join(vaultParent, 'Story Vault');
  const notesVault = path.join(vaultParent, 'Notes Vault');

  expect(fs.existsSync(storyVault), 'Story Vault root must exist').toBe(true);
  expect(fs.existsSync(notesVault), 'Notes Vault root must exist').toBe(true);
  expect(fs.existsSync(path.join(storyVault, 'manifest.json')), 'Story Vault/manifest.json must exist').toBe(true);

  expect(fs.existsSync(path.join(notesVault, 'Universes')), 'Notes Vault must NOT have Universes/ in blank mode').toBe(false);
  expect(fs.existsSync(path.join(notesVault, 'Stories')), 'Notes Vault must NOT have Stories/ in blank mode').toBe(false);
  expect(fs.existsSync(path.join(storyVault, 'My First Story')), 'Story Vault must NOT have My First Story/ in blank mode').toBe(false);
});
