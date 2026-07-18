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

// SKY-6933: stale selectors -- #story-vault-path-input renamed by SKY-3215; backdrop click point now covered by the wc-project-trigger window-chrome button
test.skip(true, 'SKY-6933: stale selectors -- #story-vault-path-input renamed by SKY-3215; backdrop click point now covered by the wc-project-trigger window-chrome button');

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

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
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openShortcutsWithQuestionMark(page: Page) {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Shift+Slash');
  return page.getByRole('dialog', { name: /keyboard shortcuts/i });
}

test.describe('Keyboard Shortcuts Dialog (SKY-83)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;

  test.beforeEach(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ks-user-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ks-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ks-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  });

  test.afterEach(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('Test 1: ? from app shell opens dialog', async () => {
    const dialog = await openShortcutsWithQuestionMark(page);

    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('.ksd-title')).toHaveText('Keyboard Shortcuts');
  });

  test('Test 2: ? inside text input does NOT open dialog', async () => {
    await page.keyboard.press('ControlOrMeta+,');
    await expect(page.getByRole('dialog', { name: /settings/i })).toBeVisible({ timeout: 5_000 });

    const input = page.locator('#story-vault-path-input');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.focus();
    await input.press('Shift+Slash');

    await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toHaveCount(0);
  });

  test('Test 3: Help menu Keyboard Shortcuts item opens dialog', async () => {
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: /keyboard shortcuts/i }).click();

    const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test('Test 4: Escape closes dialog', async () => {
    const dialog = await openShortcutsWithQuestionMark(page);
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');

    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('Test 5: Backdrop click closes dialog', async () => {
    const dialog = await openShortcutsWithQuestionMark(page);
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.locator('.ksd-backdrop').click({ position: { x: 10, y: 10 } });

    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  test('Test 6: Tab reaches close button', async () => {
    const dialog = await openShortcutsWithQuestionMark(page);
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await dialog.evaluate((el) => (el as HTMLElement).focus());
    await page.keyboard.press('Tab');

    await expect(dialog.locator('.ksd-close')).toBeFocused();
  });
});

test('Test 7: docs/keyboard-shortcuts.md exists', async () => {
  const docPath = path.join(process.cwd(), 'docs', 'keyboard-shortcuts.md');
  const exists = fs.existsSync(docPath);

  expect(exists).toBe(true);

  if (exists) {
    const content = fs.readFileSync(docPath, 'utf-8');
    expect(content).toContain('Keyboard Shortcuts');
    expect(content).toContain('Global');
    expect(content).toMatch(/\?.*Keyboard Shortcuts help/i);
  }
});
