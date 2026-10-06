/**
 * PLAN-058 L2 — Settings shell user path.
 * Gear → Settings, then the rail order and chrome a person can see.
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run --auto-servernum npx playwright test e2e/plan058-l2-settings-shell.spec.ts --reporter=list --workers=1
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string): void {
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      apiKey: 'sk-ant-test-key-l2',
      onboardingComplete: true,
      theme: 'dark',
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: vaultDir }, null, 2),
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

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-l2-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-l2-vault-'));
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
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

test('L2: Settings nav order, centered page, and Model & keys without the old provider card', async () => {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 8_000 });

  const tabs = page.locator('.settings-cat-nav [role="tab"]');
  await expect(tabs).toHaveText([
    'Appearance',
    'Vault & Files',
    'Voice',
    'Writing partner',
    'Model & keys',
    'Editor',
    'Sync & Backup',
    'Shortcuts',
    'About',
    'Account & profile',
  ]);

  const titleBox = await page.locator('.wc-bar').boundingBox();
  const railBox = await page.locator('.nav-rail').boundingBox();
  expect(titleBox).toBeTruthy();
  expect(railBox).toBeTruthy();
  expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(railBox!.y + 1);
  expect(titleBox!.x).toBeLessThanOrEqual(railBox!.x + 1);

  await page.locator('[data-testid="settings-cat-vaults"]').click();
  await expect(page.locator('#settings-category-tab-vaults')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('format-vault-now')).toBeVisible();

  await page.locator('[data-testid="settings-cat-agents"]').click();
  await expect(page.getByRole('heading', { name: 'PROVIDER BUCKETS' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Provider Configuration' })).toHaveCount(0);
  await expect(page.getByTestId('agent-transcript-placement')).toHaveCount(0);
  await expect(page.locator('.settings-content-column')).toBeVisible();

  await page.locator('[data-testid="settings-cat-editor"]').click();
  await expect(page.getByTestId('editor-dictation-offline')).toBeVisible();
  await expect(page.getByLabel('Default note view')).toBeVisible();
  await expect(page.getByLabel('Default manuscript zoom')).toBeVisible();

  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({
    path: path.resolve(__dirname, '../test-results/plan058-l2-settings-shell.png'),
  });
});
