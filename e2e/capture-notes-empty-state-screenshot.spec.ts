/**
 * capture-notes-empty-state-screenshot.spec.ts — SKY-9710 (M8f, not part of CI)
 *
 * One-off Playwright script to capture a PR evidence screenshot of the
 * Notes editor empty state: glyph + one-line hint + primary "Create note"
 * action button (GAP-REPORT-v2 #12 pattern). Not registered in
 * package.json/CI — run manually:
 *   npx playwright test e2e/capture-notes-empty-state-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/pr-sky9710');

test('capture Notes editor empty-state screenshot', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    onboardingComplete: true, theme: 'dark',
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });

  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-editor-placeholder"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="notes-editor-placeholder-create"]')).toBeVisible();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'notes-editor-empty-state.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
