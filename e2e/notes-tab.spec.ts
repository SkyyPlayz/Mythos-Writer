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

  // SKY-9019 M5: nav rail and sub-tabs became orthogonal — Vault Graph and
  // Entity Browser are no longer Notes sub-views (they moved to their own
  // rail/tab destinations), so Notes only has the Editor sub-view left.
  test('Notes tab shows only the Editor sub-view', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });

      await expect(page.locator('[data-testid="notes-subview-editor"]')).toBeVisible();
      await expect(page.locator('[data-testid="notes-subview-graph"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="notes-subview-entities"]')).toHaveCount(0);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Notes tab defaults to Editor sub-view', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
      await expect(page.locator('[data-testid="notes-editor-placeholder"]')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  // SKY-9019 M5: Vault Graph is a standalone top-level nav-rail destination.
  test('Vault Graph rail item shows the graph view (standalone, not a Notes sub-view)', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
      await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-testid="vault-graph-view"], .vgv-state').first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('#app-tabpanel-notes')).toHaveCount(0);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  // Acceptance criterion from spec (SKY-2096), updated for SKY-9019 M5: Vault
  // Graph is now a fully standalone rail destination (its own AppTab, no
  // longer routed through Notes at all) — so the "does the surface survive a
  // round trip through Story" contract is exercised on both first-class
  // destinations independently rather than via a Notes-owned sub-view.
  test('Notes Editor and Vault Graph selections each survive a round trip through Story', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      // Notes tab → Story → back: still on the (only) Editor sub-view.
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 });
      await clickStoryNav(page);
      await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 3_000 });
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('[data-testid="notes-subview-editor"]')).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

      // Vault Graph → Story → back: Vault Graph rail item relights and its
      // panel remounts, independent of the Notes tab's own state.
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
      await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible({ timeout: 3_000 });
      await clickStoryNav(page);
      await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 3_000 });
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]')).toHaveAttribute('aria-current', 'page', { timeout: 3_000 });
      await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  // SKY-9019 M5: Vault Graph is its own AppTab now, so the persisted
  // activeTab is 'vault-graph' directly — no Notes sub-view involved.
  test('Vault Graph tab persists across app restart', async () => {
    // First launch: switch to Vault Graph
    let app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]').click();
      await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible({ timeout: 5_000 });
      // Wait for settings debounce to flush
      await page.waitForTimeout(600);
    } finally {
      await app.close().catch(() => undefined);
    }

    // Second launch: Vault Graph tab should still be active
    app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Vault Graph"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.locator('#app-tabpanel-vault-graph')).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Notes tab Brainstorm panel is visible by default and collapsible', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
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
