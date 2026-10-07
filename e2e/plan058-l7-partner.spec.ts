/**
 * PLAN-058 L7 — AI / Partner (FD-4 chips, compact hub, continuity scan entry).
 *
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-l7-partner.spec.ts --reporter=list --workers=1
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
import { createStoryFromNavAdd } from './helpers/newStoryModal';
import { openPartnerWriterTips } from './helpers/partnerHub';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seed(userData: string, vaultDir: string, notesDir: string): void {
  for (const d of [userData, vaultDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(notesDir, '.notes-vault'), '');
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      rightSidebarVisible: true,
      provider: {
        kind: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        apiKey: 'sk-ant-plan058-l7-e2e',
      },
      agents: {
        writingAssistant: { enabled: true, model: 'claude-haiku-4-5-20251001' },
        brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001' },
        archive: { enabled: true, model: 'claude-sonnet-4-6' },
      },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
  );
}

async function launch(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function bootStoryWithScene(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  await createStoryFromNavAdd(page);
  await page.locator('.nav-scene-row').first().click();
  await expect(page.locator('.block-editor')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('[data-testid="global-right-sidebar"]')).toBeVisible({ timeout: 8_000 });
}

test.describe('PLAN-058 L7 — Partner / AI', () => {
  test('FD-4 + 09:01 — compact partner hub shows four quick-command chips', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l7-chips-'));
    const userData = path.join(root, 'ud');
    seed(userData, path.join(root, 'story'), path.join(root, 'notes'));
    const app = await launch(userData);
    try {
      const page = await app.firstWindow();
      await bootStoryWithScene(page);
      const partnerView = page.locator('[data-testid="ahp-partner-view"]');
      await expect(partnerView).toBeVisible({ timeout: 6_000 });
      await expect(partnerView).toHaveClass(/ahp-partner--compact/);
      await expect(page.getByTestId('ahp-action-beta-read')).toBeVisible();
      await expect(page.getByTestId('ahp-action-continuity')).toBeVisible();
      await expect(page.getByTestId('ahp-action-notes-to-timeline')).toBeVisible();
      await expect(page.getByTestId('ahp-action-timeline-to-notes')).toBeVisible();
      await expect(page.getByTestId('ahp-open-writer-tips')).toBeVisible();
      await openPartnerWriterTips(page);
      const shotDir = process.env.PLAN058_L7_SCREENSHOT_DIR;
      if (shotDir) {
        fs.mkdirSync(shotDir, { recursive: true });
        await page.screenshot({ path: path.join(shotDir, 'plan058-l7-partner-hub.png') });
      }
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('62:53 / 62:30 — editor Continuity opens Notes & Analysis with scene picker', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l7-scan-'));
    const userData = path.join(root, 'ud');
    seed(userData, path.join(root, 'story'), path.join(root, 'notes'));
    const app = await launch(userData);
    try {
      const page = await app.firstWindow();
      await bootStoryWithScene(page);
      await page.getByTestId('msv-continuity-scan-btn').click();
      await expect(page.getByTestId('ahp-notes-analysis')).toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId('cp-scan-scene-picker')).toBeVisible({ timeout: 6_000 });
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('60:50 — Writing partner advanced Timeline→notes prompt field', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-l7-prompt-'));
    const userData = path.join(root, 'ud');
    seed(userData, path.join(root, 'story'), path.join(root, 'notes'));
    const app = await launch(userData);
    try {
      const page = await app.firstWindow();
      await bootStoryWithScene(page);
      await page.locator('.app-menu-gear-btn').click();
      await expect(page.locator('.settings-title')).toBeVisible({ timeout: 6_000 });
      await page.locator('[data-testid="settings-cat-agents"]').click();
      await page.getByRole('tab', { name: 'Writing partner' }).click();
      await expect(page.getByTestId('wp-quick-command-advanced')).toBeVisible({ timeout: 6_000 });
      const prompt = page.getByTestId('wp-prompt-timeline-to-notes');
      await expect(prompt).toBeVisible();
      const custom = 'Custom timeline digest prompt for e2e.';
      await prompt.fill(custom);
      await expect(prompt).toHaveValue(custom);
      await page.locator('.settings-close').click();
    } finally {
      await app.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
