/**
 * capture-folder-ops-screenshots.spec.ts — SKY-7995 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the folder
 * context menu (Rename/Delete on a directory row) and the root drop zone.
 * Not registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-folder-ops-screenshots.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/folder-ops-sky7995');

test('capture folder ops screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  fs.mkdirSync(path.join(notesVaultDir, 'Cosmology', 'Deities'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Cosmology', 'Deities', 'pantheon.md'), '# Pantheon\n');
  fs.writeFileSync(path.join(notesVaultDir, 'loose-note.md'), '# Loose note\n');

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  const vaultPanel = page.locator('[data-panel-id="vault"]');
  if (await vaultPanel.evaluate((el) => el.classList.contains('lr-panel--collapsed'))) {
    await vaultPanel.locator('.lr-panel-collapse-btn').click();
  }
  await page.locator('[data-testid="vb-scope-notes"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Folder tree with root drop zone visible.
  await page.screenshot({ path: path.join(OUT_DIR, '1-tree-with-root-drop-zone.png') });

  // 2. Folder context menu — Rename/Delete now present on a directory row.
  await page.locator('[data-testid="vb-row-Cosmology"]').click({ button: 'right' });
  await expect(page.locator('[data-testid="vb-context-menu"]')).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '2-folder-context-menu-rename-delete.png') });
  await page.keyboard.press('Escape');

  // 3. Inline folder rename.
  await page.locator('[data-testid="vb-row-Cosmology"]').dblclick();
  await expect(page.locator('.vb-rename-input')).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '3-folder-inline-rename.png') });
  await page.keyboard.press('Escape');

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
