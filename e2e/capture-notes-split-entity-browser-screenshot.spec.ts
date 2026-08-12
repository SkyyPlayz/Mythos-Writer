/**
 * capture-notes-split-entity-browser-screenshot.spec.ts — SKY-9952 (not part of CI)
 *
 * One-off Playwright script to capture a PR evidence screenshot of the
 * Notes pane's SPLIT state with Entity Browser open in pane 1 — the exact
 * scenario PR #1217's highest-severity fix targets ("Notes split collapse":
 * opening Entity Browser in the split's primary strip used to hide the
 * entire split row). Proves pane 1 (Entity Browser + its own tab strip) and
 * pane 2 (note + its own tab strip) both stay visible together. Not
 * registered in package.json/CI — run manually:
 *   npx playwright test e2e/capture-notes-split-entity-browser-screenshot.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-9920-entity-browser-tab');

test('capture Notes split + Entity Browser in pane 1 screenshot', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-split-eb-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-split-eb-shots-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-split-eb-shots-notes-'));
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
  await page.locator('[data-testid^="vb-row-"]', { hasText: 'Mira Veynn' }).first().click();
  await expect(page.locator('[data-testid="notes-split-toggle"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="notes-split-toggle"]').click();
  await expect(page.locator('[data-testid="notes-split-row"]')).toBeVisible({ timeout: 8_000 });

  const pane2Strip = page.locator('[data-testid="notes-split-pane-2-tab-strip"]');
  await pane2Strip.locator('[data-testid="wtb-new-tab-btn"]').waitFor({ state: 'visible', timeout: 8_000 });
  await expect(pane2Strip.locator('[role="tab"]')).toHaveCount(1, { timeout: 8_000 });

  // Now open Entity Browser in PANE 1 while the split is already active —
  // the exact regression scenario for the "Notes split collapse" fix.
  const pane1Strip = page.locator('[data-testid="notes-split-pane-1-tab-strip"]');
  await pane1Strip.locator('[data-testid="wtb-new-tab-btn"]').click();
  const pane1EntitiesItem = pane1Strip.locator('[data-testid="wtb-new-tab-menu-item-entities"]');
  await expect(pane1EntitiesItem).toBeVisible({ timeout: 4_000 });
  await pane1EntitiesItem.click({ timeout: 15_000 });

  // Both the split row's Entity Browser (pane 1) and the untouched note +
  // tab strip (pane 2) must be visible together — nothing collapsed.
  await expect(pane1Strip.getByRole('tab', { name: 'Entity Browser' })).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.notes-split-main .entity-browser')).toBeVisible({ timeout: 6_000 });
  await expect(page.locator('[data-testid="notes-split-row"]')).toBeVisible();
  await expect(pane2Strip.locator('[role="tab"]')).toBeVisible();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, '06-notes-pane-split-entity-browser.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
