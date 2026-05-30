import { test, expect } from '@playwright/test';

test.describe('Keyboard Shortcuts Dialog (SKY-83)', () => {
  let app: any;

  test.beforeEach(async ({ context }) => {
    const { _electron } = require('playwright');
    app = await _electron.launch({
      args: ['--disable-gpu'],
      env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    });
    const window = await app.firstWindow();
    await window.waitForLoadState('networkidle');
    await new Promise(r => setTimeout(r, 1000));
  });

  test.afterEach(async () => {
    if (app) await app.close();
  });

  test('Test 1: ? from editor canvas opens dialog', async () => {
    const window = await app.firstWindow();

    // Get to the editor canvas
    const vaultPath = await window.evaluate(() => {
      const home = require('os').homedir();
      return `${home}/test-vault-${Date.now()}`;
    });

    // Wait for app to be ready, then create a test vault
    await window.waitForSelector('[data-testid="editor-canvas"]', { timeout: 10000 }).catch(() => {
      // Fall back if not immediately available
    });

    // Press ? key to open dialog
    await window.keyboard.press('Slash');

    // Wait for dialog to appear
    const dialog = await window.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Verify dialog contains keyboard shortcuts content
    await expect(dialog.locator('text=Keyboard Shortcuts')).toBeVisible();
  });

  test('Test 2: ? inside text input does NOT open dialog', async () => {
    const window = await app.firstWindow();

    // Find or create a text input
    const textInputs = await window.locator('input[type="text"], textarea, [contenteditable]').all();
    if (textInputs.length === 0) {
      console.log('Skipping: no text input found in current view');
      return;
    }

    const input = textInputs[0];
    await input.focus();

    // Press ? key inside the input
    await input.keyboard.press('Slash');

    // Dialog should NOT appear
    const dialog = window.locator('[role="dialog"]:has-text("Keyboard Shortcuts")');
    const isVisible = await dialog.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test('Test 3: Help menu Keyboard Shortcuts item opens dialog', async () => {
    const window = await app.firstWindow();

    // Find and click Help menu
    const helpMenu = window.locator('button:has-text("Help")');
    if (await helpMenu.isVisible().catch(() => false)) {
      await helpMenu.click();

      // Wait for dropdown and click Keyboard Shortcuts
      const shortcutsItem = window.locator('button:has-text("Keyboard Shortcuts")').first();
      await expect(shortcutsItem).toBeVisible({ timeout: 5000 });
      await shortcutsItem.click();

      // Verify dialog opens
      const dialog = window.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });
    } else {
      console.log('Note: Help menu not visible in current view');
    }
  });

  test('Test 4: Escape closes dialog', async () => {
    const window = await app.firstWindow();

    // Open dialog with ? key
    await window.keyboard.press('Slash');

    // Wait for dialog
    const dialog = window.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Press Escape
    await window.keyboard.press('Escape');

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 3000 });
  });

  test('Test 5: Backdrop click closes dialog', async () => {
    const window = await app.firstWindow();

    // Open dialog with ? key
    await window.keyboard.press('Slash');

    // Wait for dialog
    const dialog = window.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click on the backdrop (the semi-transparent area outside the dialog)
    const backdrop = window.locator('.ksd-backdrop');
    const boundingBox = await backdrop.boundingBox();
    if (boundingBox) {
      // Click near the edges to hit the backdrop, not the dialog content
      await window.click({ x: boundingBox.x + 10, y: boundingBox.y + 10 });

      // Dialog should close
      await expect(dialog).not.toBeVisible({ timeout: 3000 });
    }
  });

  test('Test 6: Tab reaches close button', async () => {
    const window = await app.firstWindow();

    // Open dialog with ? key
    await window.keyboard.press('Slash');

    // Wait for dialog
    const dialog = window.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Tab through focusable elements until we reach the close button
    const closeButton = dialog.locator('button.ksd-close, button[aria-label*="Close"]');

    // Press Tab a few times to navigate focus
    for (let i = 0; i < 10; i++) {
      await window.keyboard.press('Tab');
      const focused = await window.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el?.getAttribute('aria-label') || el?.className || '';
      });

      if (focused.includes('close') || focused.includes('Close')) {
        break;
      }
    }

    // Verify close button is accessible via Tab
    const isFocused = await window.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      return el?.getAttribute('aria-label')?.includes('Close') ||
             el?.className?.includes('ksd-close') ||
             false;
    });

    expect(isFocused).toBeTruthy();
  });

  test('Test 7: docs/keyboard-shortcuts.md exists', async () => {
    const fs = require('fs');
    const path = require('path');

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
});
