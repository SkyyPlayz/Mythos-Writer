/**
 * capture-notes-split-pane-tab-strips-screenshot.spec.ts — SKY-9784 (not part of CI)
 *
 * One-off Playwright script to capture a PR evidence screenshot of the
 * Notes split's per-pane tab strips: split view active, each pane showing
 * its own, independent Obsidian-parity tab strip (tabs/+/overflow/⋮ menu)
 * with a different note open. Not registered in package.json/CI — run
 * manually:
 *   npx playwright test e2e/capture-notes-split-pane-tab-strips-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/notes-split-pane-tab-strips-sky9784');

test('capture Notes split-pane tab strips screenshot', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-shots-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-shots-notes-'));
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
  fs.writeFileSync(path.join(notesVaultDir, 'House Ashgrave.md'), '# House Ashgrave\n\nAn old noble line.\n');

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

  const openNote = async (baseName: string) => {
    await page.locator('[data-testid^="vb-row-"]', { hasText: baseName }).first().click();
  };

  await openNote('Mira Veynn');
  await expect(page.locator('[data-testid="notes-split-toggle"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="notes-split-toggle"]').click();
  await expect(page.locator('[data-testid="notes-split-row"]')).toBeVisible({ timeout: 8_000 });

  // Give pane 2 its own, different note open — mirrors the Story split
  // editor's "two panes, two independent tab strips" evidence shot.
  const pane2Strip = page.locator('[data-testid="notes-split-pane-2-tab-strip"]');
  await pane2Strip.locator('[data-testid="wtb-new-tab-btn"]').waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});

  await expect(page.locator('[data-testid="notes-split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Mira Veynn' })).toBeVisible();
  await expect(page.locator('[data-testid="notes-split-pane-2-tab-strip"] [role="tab"]')).toBeVisible();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'notes-split-independent-tab-strips.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
