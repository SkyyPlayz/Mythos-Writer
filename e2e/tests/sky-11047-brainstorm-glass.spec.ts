/**
 * sky-11047-brainstorm-glass.spec.ts — SKY-11047
 *
 * The Brainstorm chat panel (.brainstorm-page) painted a flat --bg-base
 * fill that never tracked the Liquid Neon engine's glass/blur tokens — the
 * owner's "still not glass" re-report. This guards the fix (§4c reachability):
 * the Appearance tab's Glass opacity slider must visibly, live change the
 * Brainstorm panel's own background, with no reload, and the header must no
 * longer paint a second opaque strip on top of it.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/sky-11047-brainstorm-glass.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true,
    vaultUpgradePromptShown: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function brainstormPageStyle(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      backdropFilter: cs.backdropFilter || (cs as unknown as Record<string, string>)['webkitBackdropFilter'],
    };
  });
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11047-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11047-vault-'));
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
  const notNow = page.getByRole('button', { name: /not now/i });
  if (await notNow.count()) await notNow.first().click().catch(() => {});
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

test('SKY-11047: Brainstorm panel is glass by default and its header paints no second fill', async () => {
  // SKY-3737/SKY-3218: Brainstorm is a top-level panel reached via Ctrl+3.
  await page.keyboard.press('Control+3');
  const panel = page.locator('#app-tabpanel-brainstorm');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const pageStyle = await brainstormPageStyle(page, '.brainstorm-page');
  expect(pageStyle.backdropFilter ?? '').toContain('blur');
  // rgba(...) with alpha < 1 — not the old flat opaque rgb(14, 17, 22).
  expect(pageStyle.backgroundColor).toMatch(/^rgba\(/);

  const headerStyle = await brainstormPageStyle(page, '.brainstorm-header');
  expect(headerStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
});

test('SKY-11047: Appearance Glass opacity slider changes the Brainstorm panel live, no reload', async () => {
  const before = await brainstormPageStyle(page, '.brainstorm-page');

  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('tab', { name: 'Appearance' }).click();

  const slider = page.getByTestId('lnas-glassa');
  await slider.waitFor({ state: 'visible', timeout: 5_000 });
  const beforeValue = Number(await slider.inputValue());
  const target = beforeValue > 50 ? 10 : 90;
  await slider.fill(String(target));
  await slider.dispatchEvent('input');
  await slider.dispatchEvent('change');

  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2_000 });

  const after = await brainstormPageStyle(page, '.brainstorm-page');
  expect(after.backgroundColor).not.toBe(before.backgroundColor);
});
