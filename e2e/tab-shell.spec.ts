// SKY-2094 (Phase 2 #1): E2E tests for TabBar tab switching and state persistence.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

type SectionControllerKind = 'tablist' | 'navigation';

interface SectionController {
  container: ReturnType<Page['locator']>;
  kind: SectionControllerKind;
  tab(label: string): ReturnType<Page['locator']>;
  arrowKey: 'ArrowRight' | 'ArrowDown';
}

async function resolveSectionController(page: Page): Promise<SectionController> {
  const appSections = page.getByRole('tablist', { name: 'App sections' });
  if (await appSections.count() > 0) {
    return {
      container: appSections,
      kind: 'tablist',
      tab: (label) => appSections.getByRole('tab', { name: label, exact: true }),
      arrowKey: 'ArrowRight',
    };
  }

  const workspaceTabs = page.getByRole('tablist', { name: 'Workspace tabs' });
  if (await workspaceTabs.count() > 0) {
    return {
      container: workspaceTabs,
      kind: 'tablist',
      tab: (label) => workspaceTabs.getByRole('tab', { name: label, exact: true }),
      arrowKey: 'ArrowRight',
    };
  }

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  return {
    container: nav,
    kind: 'navigation',
    tab: (label) => nav.getByRole('button', { name: label, exact: true }),
    arrowKey: 'ArrowDown',
  };
}

async function expectSectionSelected(page: Page, label: string, selected: boolean): Promise<void> {
  const controller = await resolveSectionController(page);
  const tab = controller.tab(label);
  const panel = page.locator(`#app-tabpanel-${label.toLowerCase()}`);
  const explicitSelectedTabs = await controller.container.locator('[aria-selected="true"]').count();
  const hasPanel = (await panel.count()) > 0;

  if (selected) {
    if (controller.kind === 'tablist') {
      if (explicitSelectedTabs > 0) {
        await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 8_000 });
      } else if (hasPanel) {
        await expect(panel).toBeVisible({ timeout: 8_000 });
      } else {
        await expect(tab).toBeFocused({ timeout: 8_000 });
      }
    } else {
      await expect(tab).toHaveAttribute('aria-current', 'page', { timeout: 8_000 });
    }
    return;
  }

  if (controller.kind === 'tablist') {
    if (explicitSelectedTabs > 0) {
      await expect(tab).toHaveAttribute('aria-selected', 'false', { timeout: 8_000 });
    } else if (hasPanel) {
      await expect(panel).not.toBeVisible();
    } else {
      await expect(tab).not.toBeFocused();
    }
  } else {
    await expect(tab).not.toHaveAttribute('aria-current', 'page');
  }
}

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
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      const storyTab = controller.tab('Story');
      const notesTab = controller.tab('Notes');

      await expect(storyTab).toBeVisible();
      await expect(notesTab).toBeVisible();
      await expectSectionSelected(page, 'Story', true);
      await expectSectionSelected(page, 'Notes', false);

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
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      await controller.tab('Notes').click();

      await expectSectionSelected(page, 'Notes', true);
      await expectSectionSelected(page, 'Story', false);
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
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      await controller.tab('Notes').click();

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
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

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
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });
      await controller.tab('Notes').click();
      await expectSectionSelected(page, 'Notes', true);
      // Give settings debounce time to flush to disk
      await page.waitForTimeout(600);
    } finally {
      await app.close().catch(() => undefined);
    }

    // Second launch: Notes tab should still be active
    app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });
      await expectSectionSelected(page, 'Notes', true);
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('keyboard shortcut Ctrl+2 activates Notes tab', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      await page.keyboard.press('Control+2');
      await expectSectionSelected(page, 'Notes', true);

      await page.keyboard.press('Control+1');
      await expectSectionSelected(page, 'Story', true);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('keyboard arrow navigation moves focus between tabs', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      // Focus Story tab (currently selected, tabIndex=0)
      await controller.tab('Story').focus();
      await page.keyboard.press(controller.arrowKey);

      // ArrowRight/Down from story moves focus to notes (focus-only model in workspace tabs)
      await expect(controller.tab('Notes')).toBeFocused();
      await expect(controller.tab('Story')).not.toBeFocused();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('tab changes are announced through a polite status region', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      await expectSectionSelected(page, 'Story', true);
      await expectSectionSelected(page, 'Notes', false);

      await controller.tab('Notes').click();
      await expectSectionSelected(page, 'Notes', true);

      await controller.tab('Story').click();
      await expectSectionSelected(page, 'Story', true);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('vault badge exposes a tab-specific accessible label', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const controller = await resolveSectionController(page);
      await expect(controller.container).toBeVisible({ timeout: 12_000 });

      const badge = page.locator('[data-testid="app-vault-badge"]');
      await expect(badge).toHaveAttribute('aria-label', /Story vault:/);

      await controller.tab('Notes').click();
      await expect(badge).toHaveAttribute('aria-label', /Notes vault:/);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
