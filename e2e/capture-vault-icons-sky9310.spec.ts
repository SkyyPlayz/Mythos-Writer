/**
 * capture-vault-icons-sky9310.spec.ts — SKY-9310 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the
 * "Set icon…" picker (emoji + bundled Lucide tabs) and the resulting icon
 * rendered left of the name in the notes vault tree, for both a file and a
 * folder row.
 * Not registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-vault-icons-sky9310.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/vault-icons-sky9310');

test('capture vault icon picker + tree rendering screenshots', async () => {
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

  fs.mkdirSync(path.join(notesVaultDir, 'Cosmology'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Cosmology', 'pantheon.md'), '# Pantheon\n');
  fs.writeFileSync(path.join(notesVaultDir, 'loose-note.md'), '# Loose note\n');

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // SKY-9022/M6: Vault Browser's function is the Notes workspace sidebar,
  // its one home — navigate to the Notes Editor tab to reach it.
  await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. "Set icon…" on a file row context menu.
  await page.locator('[data-testid="vb-row-loose-note.md"]').click({ button: 'right' });
  await expect(page.locator('[data-testid="vb-context-menu"]')).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '1-file-context-menu-set-icon.png') });

  // 2. Icon picker opens on the emoji tab.
  await page.getByText('Set icon…').click();
  await expect(page.getByRole('dialog', { name: 'Icon picker' })).toBeVisible({ timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '2-icon-picker-emoji-tab.png') });

  // 3. Bundled (Lucide) tab.
  await page.getByRole('tab', { name: 'Bundled' }).click();
  await page.screenshot({ path: path.join(OUT_DIR, '3-icon-picker-bundled-tab.png') });

  // 4. Select an emoji icon for the file.
  await page.getByRole('tab', { name: 'Emoji' }).click();
  await page.locator('.icon-picker-cell', { hasText: '📖' }).click();

  // 5. Icon now renders left of the file name in the tree.
  await expect(page.locator('[data-testid="vb-row-loose-note.md"] .vb-icon')).toContainText('📖', { timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '4-tree-file-icon-rendered.png') });

  // 6. Set icon on a folder row too — folders get the picker via the same menu.
  await page.locator('[data-testid="vb-row-Cosmology"]').click({ button: 'right' });
  await expect(page.locator('[data-testid="vb-context-menu"]')).toBeVisible({ timeout: 5_000 });
  await page.getByText('Set icon…').click();
  await expect(page.getByRole('dialog', { name: 'Icon picker' })).toBeVisible({ timeout: 5_000 });
  await page.locator('.icon-picker-cell', { hasText: '🗺️' }).click();
  await expect(page.locator('[data-testid="vb-row-Cosmology"] .vb-icon')).toContainText('🗺️', { timeout: 5_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '5-tree-folder-icon-rendered.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
