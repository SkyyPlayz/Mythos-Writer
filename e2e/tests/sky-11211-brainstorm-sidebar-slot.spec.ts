/**
 * sky-11211-brainstorm-sidebar-slot.spec.ts — SKY-11211
 *
 * The Brainstorm page rendered TWO right-hand columns: its own
 * `.brainstorm-facts-col` (Agent Activity / Behind the scenes / Continuity /
 * Detected Facts) *and* the global right sidebar (Assistant panel — AGENTS,
 * SUGGESTIONS, Scene Analysis, Continuity, RESEARCH QUICK LINKS). This test
 * drives the real UI through the nav rail (no mocked route, no prop
 * assertion) and counts rendered DOM columns — the defect was two rendered
 * columns, so the fix must be verified the same way.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/sky-11211-brainstorm-sidebar-slot.spec.ts --reporter=list
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

/** Counts every `.brainstorm-facts-col` in the DOM, and how many of those
 *  live inside the global right sidebar — a naive fix that keeps rendering
 *  the column outside the sidebar (just hidden, or unmoved) fails this. */
async function factsColLocation(page: Page) {
  return page.evaluate(() => {
    const cols = Array.from(document.querySelectorAll('.brainstorm-facts-col'));
    const sidebar = document.querySelector('[data-testid="global-right-sidebar"]');
    const visible = cols.filter((el) => (el as HTMLElement).offsetParent !== null);
    return {
      totalVisible: visible.length,
      insideSidebar: visible.filter((el) => sidebar?.contains(el)).length,
      outsideSidebar: visible.filter((el) => !sidebar?.contains(el)).length,
    };
  });
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11211-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11211-vault-'));
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

test('SKY-11211: Brainstorm route via nav rail shows exactly one right sidebar with brainstorm content', async () => {
  // Real nav-rail click — not the Ctrl+3 shortcut, not a mocked route.
  await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Brainstorm' }).click();
  const panel = page.locator('#app-tabpanel-brainstorm');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  const sidebars = page.locator('[data-testid="global-right-sidebar"]');
  await expect(sidebars).toHaveCount(1);

  const location = await factsColLocation(page);
  expect(location.outsideSidebar).toBe(0);
  expect(location.insideSidebar).toBe(1);

  // The sidebar hosts the brainstorm content from the mockup...
  const sidebar = sidebars.first();
  await expect(sidebar.getByTestId('bs-activity-section')).toBeVisible();
  await expect(sidebar.getByText('Agent Activity')).toBeVisible();
  await expect(sidebar.getByText('BEHIND THE SCENES')).toBeVisible();

  // ...instead of the generic Assistant panel, which is meaningless here
  // (Scene Analysis needs an open scene; there is none on Brainstorm).
  await expect(sidebar.getByRole('tab', { name: 'Assistant' })).toHaveCount(0);
  await expect(sidebar.locator('[aria-label="Scene Analysis"]')).toHaveCount(0);
});

test('SKY-11211: leaving Brainstorm restores the standard Assistant sidebar', async () => {
  await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Story Writer' }).click();
  await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 10_000 });

  const sidebars = page.locator('[data-testid="global-right-sidebar"]');
  await expect(sidebars).toHaveCount(1);

  const location = await factsColLocation(page);
  expect(location.totalVisible).toBe(0);

  const sidebar = sidebars.first();
  await expect(sidebar.getByRole('tab', { name: 'Assistant' })).toBeVisible();
  await expect(sidebar.getByTestId('bs-activity-section')).toHaveCount(0);
});
