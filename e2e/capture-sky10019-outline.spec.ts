/**
 * capture-sky10019-outline.spec.ts — SKY-10019 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots of the
 * Outline Planning tab now that it opens via the + picker as a Story-strip
 * workspace document tab (M6 follow-up). Not registered in package.json/CI —
 * run manually:
 *   npx playwright test e2e/capture-sky10019-outline.spec.ts --reporter=list
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-10019-outline-planning-tab');

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

test('capture outline planning tab screenshot', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-opl-shots-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-opl-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-opl-notes-'));
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

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Create a story + chapter + scene so the outline tab has a story to attach to.
  await page.locator('.nav-add-btn').first().click();
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, 'First Chapter');
  const chapterRow = page.locator('.nav-chapter-row', { hasText: 'First Chapter' });
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, 'Opening Scene');
  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Opening Scene' });
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await sceneRow.click();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 10_000 });

  // Open the Outline tab via the Story strip's + picker (SKY-10019 mount point).
  const newTabBtn = page.locator('[data-testid="wtb-new-tab-btn"]');
  await expect(newTabBtn).toBeVisible({ timeout: 8_000 });
  await newTabBtn.click();
  await page.locator('[data-testid="wtb-new-tab-menu-item-outline"]').click();
  const outlinePanel = page.locator('[data-testid="outline-planning-panel"]');
  await expect(outlinePanel).toBeVisible({ timeout: 8_000 });

  // Add a couple of nodes so the screenshot shows real content, not just the empty state.
  const firstNodeInput = page.locator('[data-testid="opl-node-input"]').first();
  if (await firstNodeInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await firstNodeInput.fill('Act I — Setup');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Act II — Confrontation');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'outline-planning-tab.png') });

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});
