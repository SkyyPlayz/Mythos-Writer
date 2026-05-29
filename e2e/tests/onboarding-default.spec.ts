/**
 * onboarding-default.spec.ts — SKY-12.5 / TC-OB-D01
 *
 * Path A: "Use the default layout" onboarding flow.
 * Fresh userData → wizard → click card-default → type parent path →
 * create-default-vault → DesktopShell renders → SKY-15 Notes Vault scaffold exists.
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
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-default-ud-'));
  vaultParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-default-vp-'));
  app = await launchFreshApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultParent, { recursive: true, force: true });
});

test('TC-OB-D01: default layout — wizard completes, DesktopShell loads, SKY-15 scaffold created', async () => {
  await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('[data-testid="card-default"]')).toBeVisible();
  await expect(page.locator('[data-testid="card-blank"]')).toBeVisible();
  await expect(page.locator('[data-testid="card-import"]')).toBeVisible();
  await expect(page.locator('[data-testid="card-sample"]')).toBeVisible();

  await page.locator('[data-testid="card-default"]').click();
  await expect(page.locator('[data-testid="screen-default-path"]')).toBeVisible({ timeout: 8_000 });

  await page.locator('[data-testid="default-path-input"]').fill(vaultParent);

  const createBtn = page.locator('[data-testid="create-default-vault"]');
  await expect(createBtn).not.toBeDisabled({ timeout: 5_000 });
  await createBtn.click();

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

  const storyVault = path.join(vaultParent, 'Story Vault');
  expect(fs.existsSync(path.join(storyVault, 'manifest.json')), 'Story Vault/manifest.json must exist').toBe(true);

  const universeDir = path.join(vaultParent, 'Notes Vault', 'Universes', 'My First Universe');
  expect(fs.existsSync(universeDir), `Notes Vault Universes/My First Universe must exist`).toBe(true);

  for (const sub of ['Characters', 'Locations', 'Factions', 'History', 'Systems', 'Items']) {
    expect(fs.existsSync(path.join(universeDir, sub)), `Universes/My First Universe/${sub} must exist`).toBe(true);
  }

  expect(
    fs.existsSync(path.join(vaultParent, 'Notes Vault', 'Stories', 'My First Story')),
    'Notes Vault/Stories/My First Story must exist',
  ).toBe(true);
});
