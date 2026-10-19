/**
 * PLAN-058 Fid r3 — Tip 4 (FD-9 #3).
 * Past chats & calls is a small neutral dropdown in the hub header card.
 *
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-fid-r3.spec.ts --reporter=list --workers=1
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
        apiKey: 'sk-ant-plan058-fid-r3-e2e',
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

async function openPartnerHub(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  await createStoryFromNavAdd(page);
  await page.locator('.nav-scene-row').first().click();
  await expect(page.locator('.block-editor')).toBeVisible({ timeout: 12_000 });
  await expect(page.locator('[data-testid="global-right-sidebar"]')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('ahp-partner-view')).toBeVisible({ timeout: 8_000 });
}

test('past chats picker is a dropdown inside the hub header card', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-r3-past-'));
  const userData = path.join(root, 'ud');
  seed(userData, path.join(root, 'story'), path.join(root, 'notes'));
  const app = await launch(userData);
  try {
    const page = await app.firstWindow();
    await openPartnerHub(page);

    const card = page.getByTestId('partner-card');
    const toggle = card.getByTestId('ahp-past-chats-toggle');
    await expect(toggle).toBeVisible({ timeout: 6_000 });
    const menu = page.getByTestId('ahp-past-chats-menu');
    await expect(menu).not.toBeVisible();
    await expect(card.locator('.asp-pill-label')).toBeVisible();

    const bg = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toMatch(/rgba?\(\s*255\s*,\s*77\s*,\s*255/);

    await page.getByTestId('ahp-partner-view').screenshot({
      path: test.info().outputPath('plan058-fid-r3-past-closed.png'),
    });

    await toggle.click();
    await expect(card.getByRole('menu')).toBeVisible({ timeout: 4_000 });
    await expect(menu).toBeVisible({ timeout: 4_000 });

    await page.getByTestId('ahp-partner-view').screenshot({
      path: test.info().outputPath('plan058-fid-r3-past-open.png'),
    });

    await page.keyboard.press('Escape');
    await expect(menu).not.toBeVisible();
    await expect(toggle).toBeFocused();
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
