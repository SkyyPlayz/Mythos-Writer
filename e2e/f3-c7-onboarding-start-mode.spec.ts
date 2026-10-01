/**
 * Probe C7 — onboardingStartMode on disk after Template / Blank / Import.
 * Reads app-settings.json for real (settings write not mocked). Relaunch check.
 * H10-1: blank path unconditionally clicks nav-rail + GRS hide (shell writers),
 * returns to Story Writer, then asserts CTA + disk blank.
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

async function launchFresh(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, HOME: userData, MYTHOS_E2E: '1' },
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function patchOpenDialog(app: ElectronApplication, srcDir: string): Promise<void> {
  await app.evaluate(({ dialog }, { dir }: { dir: string }) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dir],
    });
  }, { dir: srcDir });
}

function readStartMode(userData: string): string | null | undefined {
  const p = path.join(userData, 'app-settings.json');
  if (!fs.existsSync(p)) return undefined;
  return (JSON.parse(fs.readFileSync(p, 'utf-8')) as {
    onboardingStartMode?: string | null;
  }).onboardingStartMode;
}

async function expectStartMode(userData: string, mode: string): Promise<void> {
  await expect.poll(() => readStartMode(userData), { timeout: 20_000 }).toBe(mode);
}

test.describe('C7 onboardingStartMode on disk', () => {
  test('template path writes onboardingStartMode=template; relaunch keeps it', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-c7-tpl-'));
    const app = await launchFresh(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-template').click();
      await expect(page.locator('#create-vault-name')).toBeVisible({ timeout: 15_000 });
      await page.locator('#create-vault-name').fill('C7 Template');
      await page.getByTestId('create-vault-submit').click();
      await expect(page.locator('.app-menu-bar, .desktop-shell').first()).toBeVisible({ timeout: 45_000 });
      await expectStartMode(userData, 'template');
    } finally {
      await app.close().catch(() => {});
    }
    // Relaunch — mode still on disk; Welcome must not require vault again.
    const app2 = await launchFresh(userData);
    try {
      const page = await firstWindow(app2);
      await expectStartMode(userData, 'template');
      await expect(page.getByTestId('welcome-overlay')).toHaveCount(0);
    } finally {
      await app2.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('blank path writes onboardingStartMode=blank (not template)', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-c7-blank-'));
    const app = await launchFresh(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-blank').click();
      await expect(page.locator('#create-vault-name')).toBeVisible({ timeout: 15_000 });
      await page.locator('#create-vault-name').fill('C7 Blank');
      await page.getByTestId('create-vault-submit').click();
      await expect(page.locator('.app-menu-bar, .desktop-shell').first()).toBeVisible({ timeout: 45_000 });
      await expectStartMode(userData, 'blank');
      expect(readStartMode(userData)).not.toBe('template');
      // H10-1: nav-rail clicks are shell writers — assert visible then click
      // (never isVisible()-guarded no-ops). Labels are "Notes Editor" / "Story Writer".
      const nav = page.locator('nav[aria-label="Main navigation"]');
      const notes = nav.getByRole('button', { name: 'Notes Editor' });
      await expect(notes).toBeVisible({ timeout: 15_000 });
      await notes.click();
      await page.waitForTimeout(200);
      const boards = nav.getByRole('button', { name: 'Boards' });
      await expect(boards).toBeVisible({ timeout: 15_000 });
      await boards.click();
      await page.waitForTimeout(200);
      const story = nav.getByRole('button', { name: 'Story Writer' });
      await expect(story).toBeVisible({ timeout: 15_000 });
      await story.click();
      await page.waitForTimeout(200);
      // Definite shell full-object writer (GRS visibility) before disk assert.
      const hideSidebar = page.getByRole('button', { name: /Hide right sidebar/i });
      await expect(hideSidebar).toBeVisible({ timeout: 15_000 });
      await hideSidebar.click();
      await page.waitForTimeout(300);
      await expectStartMode(userData, 'blank');
      // CTA lives in StoryNavigator — must be back on Story Writer (above).
      await expect(page.getByTestId('vs-template-cta')).toBeVisible({ timeout: 15_000 });
    } finally {
      await app.close().catch(() => {});
    }
    // Relaunch — blank still on disk after shell writers.
    const app2 = await launchFresh(userData);
    try {
      const page = await firstWindow(app2);
      await expectStartMode(userData, 'blank');
      await expect(page.getByTestId('welcome-overlay')).toHaveCount(0);
    } finally {
      await app2.close().catch(() => {});
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('import path writes onboardingStartMode=import after dry-run confirm', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-c7-imp-'));
    const userData = path.join(tempRoot, 'userData');
    const fixture = path.join(tempRoot, 'src');
    fs.mkdirSync(path.join(fixture, 'Characters'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'Characters', 'A.md'), '# A\n');
    fs.mkdirSync(userData, { recursive: true });

    const app = await launchFresh(userData);
    try {
      const page = await firstWindow(app);
      await patchOpenDialog(app, fixture);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('welcome-path-import').click();
      await expect(page.getByTestId('rail-vault-mode-import')).toHaveAttribute('aria-checked', 'true');
      await page.locator('#create-vault-name').fill('C7 Import');
      const notesBrowse = page
        .locator('[data-testid="create-vault-import-path"]')
        .locator('..')
        .getByRole('button', { name: /Browse/i });
      await notesBrowse.click();
      await expect(page.getByTestId('create-vault-dryrun-notes')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('create-vault-submit').click();
      await expect(page.locator('.app-menu-bar, .desktop-shell').first()).toBeVisible({ timeout: 60_000 });
      await expectStartMode(userData, 'import');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
