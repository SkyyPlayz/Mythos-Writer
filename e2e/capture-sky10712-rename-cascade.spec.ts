/**
 * capture-sky10712-rename-cascade.spec.ts — SKY-10712 (not part of CI)
 *
 * End-to-end proof + PR evidence screenshots for the rename → inbound-link
 * cascade: renames a note through the real UI, asserts the on-disk rewrites
 * on both vault sides (notes retitle, manuscript keeps its visible words via
 * alias), then drives the one-shot Undo and asserts full restoration.
 * Not registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-sky10712-rename-cascade.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/rename-cascade-sky10712');

test('rename cascade: retarget inbound links, preserve manuscript words, undo', async () => {
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

  // Notes side: a target note plus two inbound linkers (bare + aliased).
  fs.writeFileSync(path.join(notesVaultDir, 'Jasper.md'), 'A moody cartographer.\n');
  fs.writeFileSync(path.join(notesVaultDir, 'Allies.md'), 'Trusted: [[Jasper]] and [[Jasper|Jay]].\n');
  // Manuscript side: prose whose visible words must never change.
  fs.mkdirSync(path.join(vaultDir, 'Manuscript'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'Outline.md'), 'Act I: [[Jasper]] betrays the guild.\n');

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Rename Jasper → Jasper Thorne through the inline rename UI.
  await page.locator('[data-testid="vb-row-Jasper.md"]').dblclick();
  await expect(page.locator('.vb-rename-input')).toBeVisible({ timeout: 5_000 });
  await page.locator('.vb-rename-input').fill('Jasper Thorne');
  await page.keyboard.press('Enter');

  // Summary toast with the one-shot Undo affordance.
  await expect(page.getByText('Updated 3 links in 2 files')).toBeVisible({ timeout: 6_000 });
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.screenshot({ path: path.join(OUT_DIR, '1-cascade-toast-with-undo.png') });

  // Disk truth, notes side: Obsidian behaviour — bare links retitle, aliases hold.
  expect(fs.readFileSync(path.join(notesVaultDir, 'Allies.md'), 'utf-8'))
    .toBe('Trusted: [[Jasper Thorne]] and [[Jasper Thorne|Jay]].\n');
  expect(fs.existsSync(path.join(notesVaultDir, 'Jasper Thorne.md'))).toBe(true);
  expect(fs.existsSync(path.join(notesVaultDir, 'Jasper.md'))).toBe(false);
  // Disk truth, manuscript side: retargeted, visible words byte-identical.
  expect(fs.readFileSync(path.join(vaultDir, 'Outline.md'), 'utf-8'))
    .toBe('Act I: [[Jasper Thorne|Jasper]] betrays the guild.\n');

  // One-shot undo restores the rename and every rewritten file.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Rename undone')).toBeVisible({ timeout: 6_000 });
  await page.screenshot({ path: path.join(OUT_DIR, '2-rename-undone.png') });

  expect(fs.existsSync(path.join(notesVaultDir, 'Jasper.md'))).toBe(true);
  expect(fs.existsSync(path.join(notesVaultDir, 'Jasper Thorne.md'))).toBe(false);
  expect(fs.readFileSync(path.join(notesVaultDir, 'Allies.md'), 'utf-8'))
    .toBe('Trusted: [[Jasper]] and [[Jasper|Jay]].\n');
  expect(fs.readFileSync(path.join(vaultDir, 'Outline.md'), 'utf-8'))
    .toBe('Act I: [[Jasper]] betrays the guild.\n');

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
