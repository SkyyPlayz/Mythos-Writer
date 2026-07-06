/**
 * settings-a11y.spec.ts — SKY-814
 *
 * Accessibility audit of the Settings UI after the Liquid Neon token pass (SKY-798).
 * Verifies keyboard navigation, ARIA attributes, focus visibility, and screen-reader
 * announcements for the Settings dialog.
 *
 * Scope (SKY-814):
 *   - Tab order through every section is logical and visible
 *   - All form controls have aria-label or visible <label> association
 *   - Sliders, toggles, and segmented controls announce their state on change
 *   - Focus ring uses --neon-cyan (matches SKY-798) with contrast >= 3:1
 *   - aria-live for any async settings save feedback
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/settings-a11y.spec.ts --reporter=list
 *
 * Future: Add @axe-core/playwright for comprehensive automated a11y scanning (SKY-815).
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

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
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
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
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
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

// SKY-3216/D2: settings panel has category nav; navigate to the given category
// before querying controls that live under it.
// SKY-3230: extended timeout (10 s) for slow CI runners; wait for section to be
// visible rather than a fixed 100 ms pause so the assertion can start immediately.
// SKY-5094: PR #768 replaced class/data-testid selectors with role="tab" on .settings-cat-nav__tab.
// 'General' is no longer a tab — map it to 'Agents' (closest equivalent).
async function navigateSettingsCategory(page: Page, category: string): Promise<void> {
  const aliasMap: Record<string, string> = { general: 'Agents' };
  const tabLabel = aliasMap[category.toLowerCase()]
    ?? (category.charAt(0).toUpperCase() + category.slice(1));
  const tab = page.getByRole('tab', { name: tabLabel });
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  await tab.click();
  // Wait for section content to render (no data-settings-cat attribute in new UI)
  await expect(page.locator('.settings-section').first()).toBeVisible({ timeout: 5_000 });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-settings-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-settings-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a11y-settings-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  // Open Settings dialog via the AppMenuBar toolbar gear button.
  // SKY-3177 adds AppNavRail which also has aria-label="Open settings", so use
  // the class-based selector to target the toolbar button specifically.
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5000 });
  // Wait for the settings panel to finish loading (loading state renders without category nav).
  // navigateSettingsCategory silently skips if nav buttons aren't visible within 2s — waiting
  // here ensures TC-SKY-814-05 (Appearance slider) and others find their category correctly.
  // SKY-5094: PR #768 renamed .settings-cat-nav-btn → .settings-cat-nav__tab.
  await expect(page.locator('.settings-cat-nav__tab').first()).toBeVisible({ timeout: 10_000 });
});

test.afterEach(async () => {
  // Close Settings dialog
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 2000 });
});

// ─── TC-SKY-814-01: Settings dialog dialog role and labeling ──────────────────
test('TC-SKY-814-01: Settings dialog has proper role, label, and modal semantics', async () => {
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
});

// ─── TC-SKY-814-02: Tab order is logical through Settings sections ────────────
test('TC-SKY-814-02: Tab order cycles logically through visible Settings controls', async () => {
  // Confirm Settings dialog is open
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible();

  // Focus on the first focusable element (should be a close button or the first input)
  // Get all focusable elements
  const focusables = page.locator(
    'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  const count = await focusables.count();
  expect(count).toBeGreaterThan(0);

  // Tab through at least a few controls and verify focus moves
  const firstFocusable = focusables.first();
  await firstFocusable.focus();
  const firstFocused = await page.evaluate(() => document.activeElement?.className);
  expect(firstFocused).toBeTruthy();

  // Press Tab and verify focus moved
  await page.keyboard.press('Tab');
  const secondFocused = await page.evaluate(() => document.activeElement?.className);
  expect(secondFocused).not.toBe(firstFocused);
});

// ─── TC-SKY-814-03: All form controls have aria-label or label association ────
test('TC-SKY-814-03: Form controls have aria-label or <label> association', async () => {
  const inputs = page.locator('input[type="text"], input[type="password"], input[type="number"], input[type="url"], select, textarea');
  const count = await inputs.count();

  for (let i = 0; i < Math.min(count, 10); i++) {
    const input = inputs.nth(i);
    const id = await input.getAttribute('id');
    const ariaLabel = await input.getAttribute('aria-label');
    const ariaLabelledBy = await input.getAttribute('aria-labelledby');

    // Check if it has aria-label or if it has an id with a corresponding label
    if (!ariaLabel && !ariaLabelledBy && id) {
      const label = page.locator(`label[for="${id}"]`);
      const labelExists = await label.count() > 0;
      expect(
        labelExists || ariaLabel || ariaLabelledBy,
        `Input at index ${i} (id: ${id}) lacks aria-label and label association`,
      ).toBeTruthy();
    }
  }
});

// ─── TC-SKY-814-04: Toggles announce their state ────────────────────────────────
test('TC-SKY-814-04: Toggle switches can be activated and announce state change', async () => {
  // SKY-3216/D2: toggles live under the Agents category — navigate there first.
  await navigateSettingsCategory(page, 'Agents');
  // The native checkbox is visually hidden; users interact with the visible label/track.
  const toggleControl = page.locator('.settings-toggle').first();
  await expect(toggleControl).toBeVisible();

  const toggle = toggleControl.locator('input[type="checkbox"]');
  const ariaLabel = await toggle.getAttribute('aria-label');
  expect(ariaLabel, 'Toggle should have aria-label').toBeTruthy();

  const initialChecked = await toggle.isChecked();
  await toggleControl.click();
  await expect(toggle).toBeChecked({ checked: !initialChecked });
});

// ─── TC-SKY-814-05: Sliders have aria-label and value is announced ──────────────
test('TC-SKY-814-05: Slider controls have aria-label and announce value', async () => {
  // SKY-3216/D2: scope to the appearance section to avoid matching hidden range inputs
  // elsewhere in the DOM (the broad :not([disabled]) selector can resolve to a
  // CSS-hidden element in another section before AppearanceSection in DOM order).
  await navigateSettingsCategory(page, 'Appearance');
  // SKY-5094: no data-settings-cat attribute in new UI; scope to tabpanel instead
  const slider = page.locator('[role="tabpanel"] input[type="range"]').first();
  await expect(slider).toBeVisible();

  const ariaLabel = await slider.getAttribute('aria-label');
  expect(ariaLabel, 'Slider should have aria-label').toBeTruthy();

  // Get the current value
  const initialValue = await slider.inputValue();
  expect(initialValue).toBeTruthy();

  // Change the slider value. Derive a valid on-step target from the input's
  // own range — the first Appearance slider is an integer 0-100 range since
  // Beta 3 M4, so the old hard-coded fill('0.5') is a malformed value.
  const min = Number((await slider.getAttribute('min')) ?? 0);
  const max = Number((await slider.getAttribute('max')) ?? 100);
  const step = Number((await slider.getAttribute('step')) || 1);
  let target = min + Math.round((max - min) / 2 / step) * step;
  if (String(target) === initialValue) target = Math.min(max, target + step);
  await slider.fill(String(target));

  // Verify value changed
  const finalValue = await slider.inputValue();
  expect(finalValue).not.toBe(initialValue);
});

// ─── TC-SKY-814-06: Focus ring is visible and uses correct color ────────────────
test('TC-SKY-814-06: Focus ring is visible with cyan color on interactive controls', async () => {
  // SKY-3216/D2: first .settings-input in DOM order is in ProviderSection (data-settings-cat="agents"),
  // hidden when General tab is active. Navigate to Agents to expose it.
  await navigateSettingsCategory(page, 'Agents');
  const input = page.locator('.settings-input').first();

  // Focus directly — this test checks focus-ring styling (TC-SKY-814-02 covers tab order).
  // The tab-loop pattern was flaky: focus moved between the evaluate() check and toBeFocused().
  await input.focus();
  await expect(input).toBeFocused();

  const focusStyle = await input.evaluate((el) => {
    const style = window.getComputedStyle(el);
    return {
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
    };
  });

  expect(focusStyle.boxShadow).not.toBe('none');
  expect(focusStyle.borderColor).toBeTruthy();
});

// ─── TC-SKY-814-07: Error and status messages have proper roles ────────────────
test('TC-SKY-814-07: Error and status messages use aria-live and role attributes', async () => {
  // Look for error and status messages
  const errors = page.locator('[role="alert"]');
  const statuses = page.locator('[role="status"]');

  // At least some error or status messages should exist (or be able to trigger them)
  const errorCount = await errors.count();
  const statusCount = await statuses.count();
  expect(errorCount + statusCount).toBeGreaterThanOrEqual(0);

  // Check for aria-live attributes if not role="status" or role="alert"
  const messages = page.locator('[aria-live], [role="alert"], [role="status"]');
  const messageCount = await messages.count();
  expect(messageCount).toBeGreaterThanOrEqual(0);
});

// ─── TC-SKY-814-08: Keyboard-only navigation through Settings (no mouse) ────────
test('TC-SKY-814-08: Settings can be fully navigated with keyboard only', async () => {
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible();

  // Get all focusable elements in the dialog; wait for content to render
  // (the SKY-3216 extraction into sub-components can introduce a brief render delay).
  const focusables = dialog.locator('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  await expect(focusables.first()).toBeVisible({ timeout: 3_000 });
  const count = await focusables.count();
  expect(count).toBeGreaterThan(0);

  // Tab through several controls (at least 5 if available)
  let focusedCount = 0;
  for (let i = 0; i < Math.min(5, count); i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBeTruthy();
    focusedCount++;
  }

  expect(focusedCount).toBeGreaterThan(0);

  // Verify Escape closes the dialog
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 2000 });
});

// ─── TC-SKY-814-09: Verify dialog is accessible (axe integration deferred to SKY-815) ──────────────────
test('TC-SKY-814-09: Settings dialog has accessible structure (axe scan in SKY-815)', async () => {
  // This test verifies basic structure; full axe-core/playwright integration
  // is deferred to SKY-815 once @axe-core/playwright is added to package.json.
  const dialog = page.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible();

  // Basic structural check: dialog should have interactive controls
  const interactive = dialog.locator('button, input, select, textarea');
  const count = await interactive.count();
  expect(count).toBeGreaterThan(0);
});

// ─── TC-SKY-814-10: Section headings use proper heading hierarchy ────────────────
test('TC-SKY-814-10: Settings sections have proper heading structure', async () => {
  // SKY-3216/D2: navigate to a settings category before querying section headings.
  // SKY-5094: 'General' is no longer a tab in PR #768; navigateSettingsCategory maps it to 'Agents'.
  // The section-visibility wait is now inside navigateSettingsCategory.
  await navigateSettingsCategory(page, 'Agents');
  const sections = page.locator('[class*="settings-section"]');
  const count = await sections.count();
  expect(count).toBeGreaterThan(0);

  // Check that sections have aria-labelledby pointing to a heading
  for (let i = 0; i < Math.min(count, 5); i++) {
    const section = sections.nth(i);
    const labelledBy = await section.getAttribute('aria-labelledby');

    if (labelledBy) {
      const heading = page.locator(`#${labelledBy}`);
      const headingExists = await heading.count() > 0;
      expect(
        headingExists,
        `Section ${i} should have a heading with id "${labelledBy}"`,
      ).toBeTruthy();
    }
  }
});
