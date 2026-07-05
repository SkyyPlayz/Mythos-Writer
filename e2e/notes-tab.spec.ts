// SKY-2096 (Phase 2 #3): E2E tests for Notes tab layout and sub-view persistence.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  // Write a placeholder notes vault marker so notesValid is true
  fs.writeFileSync(path.join(notesDir, '.notes-vault'), '');
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
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

test.describe('Notes tab — sub-view toggles and state persistence', () => {
  let tempRoot: string;
  let userData: string;
  let vaultDir: string;
  let notesDir: string;

  test.beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-tab-'));
    userData = path.join(tempRoot, 'userData');
    vaultDir = path.join(tempRoot, 'vault');
    notesDir = path.join(tempRoot, 'notes');
    seedUserData(userData, vaultDir, notesDir);
  });

  test.afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('Notes tab shows sub-view toggles (Editor · Graph · Entities)', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });

      await expect(page.locator('[data-testid="notes-subview-editor"]')).toBeVisible();
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toBeVisible();
      await expect(page.locator('[data-testid="notes-subview-entities"]')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Notes tab defaults to Editor sub-view', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
      await expect(page.locator('[data-testid="notes-editor-placeholder"]')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Notes sub-view: switching to Graph shows graph view', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toBeVisible({ timeout: 5_000 });

      await page.locator('[data-testid="notes-subview-graph"]').click();
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-testid="notes-graph-view"]')).toBeVisible();
      await expect(page.locator('[data-testid="notes-editor-placeholder"]')).not.toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  // Acceptance criterion from spec: open Notes tab → switch to Graph → switch tabs → switch back → Graph still selected.
  test('Notes sub-view selection is preserved when switching tabs and back', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      // Switch to Notes tab
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toBeVisible({ timeout: 5_000 });

      // Switch to Graph sub-view
      await page.locator('[data-testid="notes-subview-graph"]').click();
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveAttribute('aria-selected', 'true');

      // Switch to Story tab
      await clickStoryNav(page);
      await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 3_000 });

      // Switch back to Notes tab — Graph must still be selected
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
      await expect(page.locator('[data-testid="notes-graph-view"]')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Notes sub-view persists across app restart', async () => {
    // First launch: switch to Notes → Graph
    let app = await launchApp(userData);
    try {
      let page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toBeVisible({ timeout: 5_000 });
      await page.locator('[data-testid="notes-subview-graph"]').click();
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveAttribute('aria-selected', 'true');
      // Wait for settings debounce to flush
      await page.waitForTimeout(600);
    } finally {
      await app.close().catch(() => undefined);
    }

    // Second launch: Notes tab should show Graph sub-view
    app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
      // Notes tab should still be active
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      // Graph sub-view should still be selected
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Notes tab Brainstorm panel is visible by default and collapsible', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes"]').click();
      await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({ timeout: 5_000 });

      // Collapse the Brainstorm panel
      await page.locator('[data-testid="notes-brainstorm-collapse"]').click();
      await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).not.toBeVisible({ timeout: 3_000 });
      await expect(page.locator('[data-testid="notes-brainstorm-expand"]')).toBeVisible();

      // Re-expand
      await page.locator('[data-testid="notes-brainstorm-expand"]').click();
      await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
