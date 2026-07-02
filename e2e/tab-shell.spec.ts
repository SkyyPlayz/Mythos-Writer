// SKY-2094 (Phase 2 #1): E2E tests for TabBar tab switching and state persistence.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string): void {
  seedUserDataWithVaults(userData, vaultDir, vaultDir, { createStory: true, createNotes: true });
}

function seedUserDataWithVaults(
  userData: string,
  storyVaultDir: string,
  notesVaultDir: string,
  options: { createStory: boolean; createNotes: boolean },
): void {
  fs.mkdirSync(userData, { recursive: true });
  if (options.createStory) fs.mkdirSync(storyVaultDir, { recursive: true });
  if (options.createNotes) fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir }, null, 2),
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
      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      const storyNav = mainNav.getByRole('button', { name: 'Story' });
      const notesNav = mainNav.getByRole('button', { name: 'Notes' });
      const workspaceTabs = page.getByRole('tablist', { name: 'Workspace tabs' });

      await expect(mainNav).toBeVisible({ timeout: 12_000 });
      await expect(workspaceTabs).toBeVisible({ timeout: 12_000 });
      await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);

      await expect(storyNav).toHaveAttribute('aria-current', 'page');
      await expect(notesNav).not.toHaveAttribute('aria-current', 'page');

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
      const notesNav = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' });
      const storyNav = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Story' });

      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 12_000 });
      await notesNav.click();

      await expect(notesNav).toHaveAttribute('aria-current', 'page');
      await expect(storyNav).not.toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible();
      await expect(page.locator('#app-tabpanel-story')).not.toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('only Story vault bound: Notes tab shows missing-vault empty state with CTAs', async () => {
    const storyVaultDir = path.join(tempRoot, 'story-vault');
    const notesVaultDir = path.join(tempRoot, 'missing-notes-vault');
    seedUserDataWithVaults(userData, storyVaultDir, notesVaultDir, { createStory: true, createNotes: false });

    const app = await launchApp(userData);
    try {
      await app.evaluate(({ ipcMain }, { storyVaultDir, notesVaultDir }) => {
        ipcMain.removeHandler('vault:validate-path');
        ipcMain.handle('vault:validate-path', (_event, payload: { path?: string } | string) => {
          const targetPath = typeof payload === 'string' ? payload : payload.path;
          if (targetPath === storyVaultDir) return { exists: true, writable: true };
          if (targetPath === notesVaultDir) return { exists: false, writable: false };
          return { exists: true, writable: true };
        });
      }, { storyVaultDir, notesVaultDir });

      const page = await firstWindow(app);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 12_000 });

      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' }).click();

      await expect(page.getByRole('heading', { name: 'No Notes vault' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create a Notes vault' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Connect existing folder' })).toBeVisible();
      await expect(page.locator('.tab-bar-vault-badge--missing')).toContainText('No Notes vault');
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('only Notes vault bound: Story tab shows missing-vault empty state with CTAs', async () => {
    const storyVaultDir = path.join(tempRoot, 'missing-story-vault');
    const notesVaultDir = path.join(tempRoot, 'notes-vault');
    seedUserDataWithVaults(userData, storyVaultDir, notesVaultDir, { createStory: false, createNotes: true });

    const app = await launchApp(userData);
    try {
      await app.evaluate(({ ipcMain }, { storyVaultDir, notesVaultDir }) => {
        ipcMain.removeHandler('vault:validate-path');
        ipcMain.handle('vault:validate-path', (_event, payload: { path?: string } | string) => {
          const targetPath = typeof payload === 'string' ? payload : payload.path;
          if (targetPath === storyVaultDir) return { exists: false, writable: false };
          if (targetPath === notesVaultDir) return { exists: true, writable: true };
          return { exists: true, writable: true };
        });
      }, { storyVaultDir, notesVaultDir });

      const page = await firstWindow(app);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 12_000 });

      await expect(page.getByRole('heading', { name: 'No Story vault' })).toBeVisible();
      await expect(page.getByText('Start your first story to begin writing.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create a new story' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue onboarding' })).toBeVisible();
      await expect(page.locator('.tab-bar-vault-badge--missing')).toContainText('No Story vault');
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('tab state persists across relaunch — Notes tab survives restart', async () => {
    // First launch: switch to Notes tab
    let app = await launchApp(userData);
    try {
      let page = await firstWindow(app);
      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      const notesNav = mainNav.getByRole('button', { name: 'Notes' });
      await expect(mainNav).toBeVisible({ timeout: 12_000 });
      await notesNav.click();
      await expect(notesNav).toHaveAttribute('aria-current', 'page');
      // Give settings debounce time to flush to disk
      await page.waitForTimeout(600);
    } finally {
      await app.close().catch(() => undefined);
    }

    // Second launch: Notes tab should still be active
    app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      const notesPanel = page.locator('#app-tabpanel-notes');
      const storyPanel = page.locator('#app-tabpanel-story');
      if (await mainNav.count()) {
        const notesNav = mainNav.getByRole('button', { name: 'Notes' });
        await expect(mainNav).toBeVisible({ timeout: 12_000 });
        await expect(notesNav).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      }
      await expect(storyPanel).not.toBeVisible();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible();
      await expect(notesPanel).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('keyboard shortcut Ctrl+2 activates Notes tab', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      const storyNav = mainNav.getByRole('button', { name: 'Story' });
      const notesNav = mainNav.getByRole('button', { name: 'Notes' });
      await expect(mainNav).toBeVisible({ timeout: 12_000 });

      await page.keyboard.press('Control+2');
      await expect(notesNav).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });

      await page.keyboard.press('Control+1');
      await expect(storyNav).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('keyboard arrow navigation moves focus between tabs', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
      const storyNav = mainNav.getByRole('button', { name: 'Story' });
      const notesNav = mainNav.getByRole('button', { name: 'Notes' });
      await expect(mainNav).toBeVisible({ timeout: 12_000 });

      // Focus Story button (currently selected), then move focus down.
      await storyNav.focus();
      await page.keyboard.press('ArrowDown');

      // ArrowDown from story → focus notes; activate with Enter.
      await expect(notesNav).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(notesNav).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('tab changes expose active section through ARIA current state', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 12_000 });

      const storyNav = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Story' });
      const notesNav = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' });
      const appVaultBadge = page.locator('[data-testid="app-vault-badge"]');

      await expect(storyNav).toHaveAttribute('aria-current', 'page');
      await expect(appVaultBadge).toHaveAttribute('aria-label', /Story vault:/);
      await expect(notesNav).not.toHaveAttribute('aria-current', 'page');

      await notesNav.click();
      await expect(notesNav).toHaveAttribute('aria-current', 'page');
      await expect(appVaultBadge).toHaveAttribute('aria-label', /Notes vault:/);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('vault badge exposes a tab-specific accessible label', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const storyNav = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Story' });
      const notesNav = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' });
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({ timeout: 12_000 });

      const badge = page.locator('[data-testid="app-vault-badge"]');
      await expect(badge).toHaveAttribute('aria-label', /Story vault:/);

      await notesNav.click();
      await expect(notesNav).toHaveAttribute('aria-current', 'page');
      await expect(badge).toHaveAttribute('aria-label', /Notes vault:/);
      await storyNav.click();
      await expect(storyNav).toHaveAttribute('aria-current', 'page');
      await expect(badge).toHaveAttribute('aria-label', /Story vault:/);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
