/**
 * SKY-3215 — Settings category sub-nav E2E tests.
 *
 * ACs verified:
 * - Left category sub-nav renders with all categories keyboard-reachable
 * - Selecting a category shows only its sections
 * - Sections not in the active category are hidden
 *
 * SKY-3098/3218 + Beta 4 M28 (§13; GAP #8) rewrote the settings workspace:
 * this suite used to be a plain `page.goto('/')` browser test, but the app has
 * no webServer/baseURL — it only runs as a real Electron app. Rewritten below
 * against the real `_electron.launch()` harness used by every other settings
 * e2e spec (see e2e/provider-settings.spec.ts), and against the current
 * 8-category rail (frontend/src/settingsCategories.ts) — the old 4-category
 * "General" layout no longer exists.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/settings-category-subnav.spec.ts --reporter=list
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const appSettings = {
    apiKey: 'sk-ant-test-key-subnav',
    onboardingComplete: true,
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: vaultDir };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
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
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openSettings(pg: Page): Promise<void> {
  await pg.locator('.app-menu-gear-btn').click();
  await expect(pg.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-subnav-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-subnav-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(vaultDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test.beforeEach(async () => {
  await openSettings(page);
});

test.afterEach(async () => {
  await page.click('.settings-close');
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('renders the current 8-category sub-nav', async () => {
  for (const [id, label] of [
    ['account', 'Account & profile'],
    ['appearance', 'Appearance'],
    ['agents', 'AI Agents'],
    ['editor', 'Editor'],
    ['vaults', 'Vault & Files'],
    ['sync', 'Sync & Backup'],
    ['shortcuts', 'Shortcuts'],
    ['about', 'About'],
  ] as const) {
    const btn = page.locator(`[data-testid="settings-cat-${id}"]`);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveText(label);
  }
});

test('AI Agents is active by default and shows its sections', async () => {
  const activeBtn = page.locator('.settings-cat-nav__tab--active');
  await expect(activeBtn).toHaveText('AI Agents');

  const apiKeySection = page.locator('[aria-labelledby="section-api-key"]');
  await expect(apiKeySection).toBeVisible();
});

test('switching to Vault & Files shows vault sections and hides Agents sections', async () => {
  await page.click('[data-testid="settings-cat-vaults"]');

  const vaultPathsSection = page.locator('[aria-labelledby="section-vault-paths"]');
  await expect(vaultPathsSection).toBeVisible();

  // Agents-only sections are unmounted (not just hidden) once the category switches.
  const apiKeySection = page.locator('[aria-labelledby="section-api-key"]');
  await expect(apiKeySection).not.toBeVisible();
});

test('switching to Appearance shows the theme section', async () => {
  await page.click('[data-testid="settings-cat-appearance"]');

  const themeSection = page.locator('[aria-labelledby="section-theme"]');
  await expect(themeSection).toBeVisible();
});

test('category tabs are keyboard reachable and activatable via arrow keys', async () => {
  const nav = page.locator('.settings-cat-nav');
  await expect(nav).toHaveAttribute('role', 'tablist');

  // Focus the active tab (AI Agents, index 2), then arrow-right to Editor (index 3).
  const agentsTab = page.locator('[data-testid="settings-cat-agents"]');
  await agentsTab.focus();
  await page.keyboard.press('ArrowRight');

  const editorTab = page.locator('[data-testid="settings-cat-editor"]');
  await expect(editorTab).toHaveClass(/settings-cat-nav__tab--active/);
  await expect(editorTab).toBeFocused();
});

test('aria-selected is set only on the active category tab', async () => {
  await page.click('[data-testid="settings-cat-vaults"]');
  const selectedTabs = page.locator('.settings-cat-nav [role="tab"][aria-selected="true"]');
  await expect(selectedTabs).toHaveCount(1);
  await expect(selectedTabs).toHaveText('Vault & Files');
});
