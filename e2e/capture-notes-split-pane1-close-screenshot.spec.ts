/**
 * capture-notes-split-pane1-close-screenshot.spec.ts — SKY-10081 (not part of CI)
 *
 * One-off Playwright script to capture a PR evidence screenshot proving the
 * SKY-10081 fix: closing pane 1's LAST note tab while a split is active (and
 * pane 1 isn't Entity Browser) must NOT collapse the split — pane 2's note,
 * both tab strips, and the "Split notes" toggle must all stay visible so the
 * user can recover (open a new note in pane 1, or collapse the split). Not
 * registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-notes-split-pane1-close-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10081-notes-split-pane1-close');

test('capture Notes split surviving pane 1 losing its last note tab', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-split-close-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-split-close-shots-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-split-close-shots-notes-'));
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

  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, '.notes-vault'), '');
  fs.writeFileSync(path.join(notesVaultDir, 'Mira Veynn.md'), '# Mira Veynn\n\nA wanderer.\n');
  fs.writeFileSync(path.join(notesVaultDir, 'The Sunken Gate.md'), '# The Sunken Gate\n\nA ruined harbor.\n');

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });

  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 8_000 });

  // Open a note in pane 1, then activate the split (pane 2 gets a note too).
  await page.locator('[data-testid^="vb-row-"]', { hasText: 'The Sunken Gate' }).first().click();
  await expect(page.locator('[data-testid="notes-split-toggle"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="notes-split-toggle"]').click();
  await expect(page.locator('[data-testid="notes-split-row"]')).toBeVisible({ timeout: 8_000 });

  const pane1Strip = page.locator('[data-testid="notes-split-pane-1-tab-strip"]');
  const pane2Strip = page.locator('[data-testid="notes-split-pane-2-tab-strip"]');
  await expect(pane1Strip.locator('[role="tab"]')).toHaveCount(1, { timeout: 8_000 });
  await expect(pane2Strip.locator('[role="tab"]')).toHaveCount(1, { timeout: 8_000 });

  // Close pane 1's ONLY note tab — the exact SKY-10081 regression trigger.
  await pane1Strip.locator('[role="tab"]').first().hover();
  await pane1Strip.locator('button.wtb-tab-close').first().click();

  // Split row, pane 2's note + strip, pane 1's (now empty) strip, and the
  // "Split notes" toggle must all still be visible — nothing collapsed.
  await expect(page.locator('[data-testid="notes-split-row"]')).toBeVisible();
  await expect(pane1Strip).toBeVisible();
  await expect(pane1Strip.locator('[role="tab"]')).toHaveCount(0);
  await expect(pane2Strip.locator('[role="tab"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="note-split-pane"]')).toBeVisible();
  await expect(page.locator('[data-testid="notes-split-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="notes-editor-placeholder"]')).toHaveCount(0);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, '01-notes-split-survives-pane1-last-tab-close.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
