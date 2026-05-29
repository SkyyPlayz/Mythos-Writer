/**
 * onboarding-import.spec.ts — SKY-12.5 / TC-OB-I01
 *
 * Path C: "Import Obsidian vault" onboarding flow.
 * Fresh userData → wizard → click card-import → IPC mocks intercept
 * vault:pick-folder / vault:obsidian-dry-run / vault:obsidian-register →
 * dry-run report renders → confirm → import-success → DesktopShell.
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
const FIXTURE_NOTE_COUNT = 2;

function buildFixtureVault(dir: string): void {
  fs.writeFileSync(
    path.join(dir, 'mira-halloway.md'),
    ['---', 'name: Mira Halloway', 'type: character', '---', '', 'Archivist turned wanderer.'].join('\n'),
  );
  fs.writeFileSync(
    path.join(dir, 'the-glass-library.md'),
    ['---', 'name: The Glass Library', 'type: location', '---', '', 'A library sealed with [[Mira Halloway]].'].join('\n'),
  );
}

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
let fixtureDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-import-ud-'));
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-import-fixture-'));
  buildFixtureVault(fixtureDir);
  app = await launchFreshApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

test('TC-OB-I01: import flow — dry-run report shown, import success, DesktopShell loads', async () => {
  await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });

  await page.locator('[data-testid="card-import"]').click();
  await expect(page.locator('[data-testid="screen-import-source"]')).toBeVisible({ timeout: 8_000 });

  const capturedFixtureDir = fixtureDir;
  await app.evaluate(
    ({ ipcMain }, { fixturePath, noteCount }) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({
        vaultRoot: fixturePath,
        cancelled: false,
        registrationToken: 'e2e-ob-import-token',
      }));
      ipcMain.removeHandler('vault:obsidian-dry-run');
      ipcMain.handle('vault:obsidian-dry-run', () => ({
        notesCount: noteCount,
        brokenLinks: [],
        nameCollisions: [],
        missingFrontmatter: [],
        fatalError: null,
        restructured: [],
        leftAsIs: [],
      }));
      ipcMain.removeHandler('vault:obsidian-register');
      ipcMain.handle('vault:obsidian-register', () => ({
        vaultRoot: fixturePath,
        notesIndexed: noteCount,
      }));
    },
    { fixturePath: capturedFixtureDir, noteCount: FIXTURE_NOTE_COUNT },
  );

  await page.locator('[data-testid="import-drop-zone-btn"]').click();

  const dryRunScreen = page.locator('[data-testid="screen-import-dryrun"]');
  await expect(dryRunScreen).toBeVisible({ timeout: 12_000 });
  await expect(dryRunScreen.locator('.dry-run-stat-value').first()).toContainText(String(FIXTURE_NOTE_COUNT), { timeout: 6_000 });

  await dryRunScreen.locator('[data-testid="confirm-import"]').click();

  await expect(page.locator('[data-testid="screen-import-success"]')).toBeVisible({ timeout: 15_000 });

  await page.locator('[data-testid="import-success-continue"]').click();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
});
