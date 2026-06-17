// SKY-2094 (Phase 2 #1): E2E tests for TabBar tab switching and state persistence.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test.describe('TabBar — tab switching and persistence', () => {
  let tempRoot: string;
  let userData: string;
  let vaultDir: string;

  test.beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-tabshell-'));
    userData = path.join(tempRoot, 'userData');
    vaultDir = path.join(tempRoot, 'vault');
    seedUserData(userData, vaultDir);
  });

  test.afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('tab bar renders with Story tab selected by default', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 12_000 });

      const storyTab = page.locator('[data-testid="app-tab-story"]');
      const notesTab = page.locator('[data-testid="app-tab-notes"]');

      await expect(storyTab).toBeVisible();
      await expect(notesTab).toBeVisible();
      await expect(storyTab).toHaveAttribute('aria-selected', 'true');
      await expect(notesTab).toHaveAttribute('aria-selected', 'false');

      // Story tabpanel visible, notes tabpanel absent
      await expect(page.locator('#app-tabpanel-story')).toBeVisible();
      await expect(page.locator('#app-tabpanel-notes')).not.toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('clicking Notes tab shows notes panel and hides story panel', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('[data-testid="app-tab-notes"]').click();

      await expect(page.locator('[data-testid="app-tab-notes"]')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-testid="app-tab-story"]')).toHaveAttribute('aria-selected', 'false');
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible();
      await expect(page.locator('#app-tabpanel-story')).not.toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('tab state persists across relaunch — Notes tab survives restart', async () => {
    // First launch: switch to Notes tab
    let app = await launchApp(userData);
    try {
      let page = await firstWindow(app);
      await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 12_000 });
      await page.locator('[data-testid="app-tab-notes"]').click();
      await expect(page.locator('[data-testid="app-tab-notes"]')).toHaveAttribute('aria-selected', 'true');
      // Give settings debounce time to flush to disk
      await page.waitForTimeout(600);
    } finally {
      await app.close().catch(() => undefined);
    }

    // Second launch: Notes tab should still be active
    app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 12_000 });
      await expect(page.locator('[data-testid="app-tab-notes"]')).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('keyboard shortcut Ctrl+2 activates Notes tab', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 12_000 });

      await page.keyboard.press('Control+2');
      await expect(page.locator('[data-testid="app-tab-notes"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

      await page.keyboard.press('Control+1');
      await expect(page.locator('[data-testid="app-tab-story"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('keyboard arrow navigation moves focus between tabs', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 12_000 });

      // Focus Story tab (currently selected, tabIndex=0)
      await page.locator('[data-testid="app-tab-story"]').focus();
      await page.keyboard.press('ArrowRight');

      // ArrowRight from story → notes, and notes becomes selected
      await expect(page.locator('[data-testid="app-tab-notes"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
