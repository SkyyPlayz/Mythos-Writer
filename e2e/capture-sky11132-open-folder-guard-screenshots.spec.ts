/**
 * capture-sky11132-open-folder-guard-screenshots.spec.ts — SKY-11132 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots for the
 * Open Vault Folder data-safety fix:
 *   1. vault-picker-relabeled — the Notes Vault picker dropdown, row now
 *      reads "Open a Mythos vault…" (was "Import a vault…", which implied
 *      copy semantics it never had).
 *   2. obsidian-vault-refused — the refusal message the new
 *      checkOpenFolderGate produces when that row is used to pick a real,
 *      non-empty Obsidian folder (the owner's exact repro shape), captured
 *      via the page-level `dialog` event since Electron's alert() renders
 *      as a native window outside the page's own screenshot surface.
 *
 * Output: docs/screenshots/sky-11132-open-folder-guard/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky11132-open-folder-guard-screenshots.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-11132-open-folder-guard');

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

test('capture SKY-11132 open-folder-guard screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-'));
  const storyVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-'));
  const notesVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-'));
  const obsidianVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-obsidian-'));

  // Owner's exact repro shape: a real, non-empty Obsidian vault.
  fs.mkdirSync(path.join(obsidianVault, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(obsidianVault, '.obsidian', 'app.json'), '{}');
  fs.writeFileSync(path.join(obsidianVault, 'Ideas.md'), '# Ideas\n');

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVault, notesVaultRoot: notesVault,
  }, null, 2));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  // Patch the OS folder picker to return the Obsidian fixture, matching the
  // owner's real click path (real IPC below this point, nothing else stubbed).
  await app.evaluate(({ dialog }, { d }: { d: string }) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [d],
    });
  }, { d: obsidianVault });

  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await applyTheme(page);

  // Notes Editor tab is Vault Browser's home (SKY-9022/M6).
  await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });

  // 1. Open the vault picker — relabeled row, no more "Import a vault…".
  await page.locator('[data-testid="vb-vault-picker"]').click();
  await expect(page.locator('[data-testid="vb-vault-picker-import"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="vb-vault-picker-import"]')).toContainText('Open a Mythos vault…');
  await shot(page, '1-vault-picker-relabeled');

  // 2. Click it — real IPC end to end (checkOpenFolderGate refuses the
  // Obsidian folder), capture the alert via the page `dialog` event since
  // Electron's alert() is a native window, not part of the page surface.
  const dialogMessage: string = await new Promise((resolve) => {
    page.once('dialog', (d) => {
      resolve(d.message());
      void d.accept().catch(() => undefined);
    });
    void page.locator('[data-testid="vb-vault-picker-import"]').click();
  });
  expect(dialogMessage).toMatch(/Obsidian vault, not a Mythos vault/);
  expect(dialogMessage).toMatch(/Import another vault/);

  // Electron's alert() is a native window layered on top of this one, so it
  // won't appear in a page-level screenshot — write the exact string a
  // sighted user sees in it alongside a screenshot of the underlying page
  // (picker closed, no vault switch happened) as the paired evidence.
  fs.writeFileSync(path.join(OUT_DIR, '2-obsidian-vault-refused-message.txt'), `${dialogMessage}\n`);
  await shot(page, '2-obsidian-vault-refused-underlying-page');

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(storyVault, { recursive: true, force: true });
  fs.rmSync(notesVault, { recursive: true, force: true });
  fs.rmSync(obsidianVault, { recursive: true, force: true });
});
