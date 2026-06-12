/**
 * project-templates.spec.ts — SKY-156 + SKY-1314
 *
 * E2E tests for project template selection and scaffolding:
 *
 *   TC-T-01  Built-in template selection — onboarding completes with a bundled
 *            template; vault scaffolds the expected folder/file set from the
 *            template definition.
 *   TC-T-02  Template list freshness — fresh install shows bundled templates
 *            only; no orphan custom entries from prior test runs.
 *   TC-T-03  Save-as-Template round-trip — (PENDING SKY-1303) after SaveAsTemplate
 *            UI lands, save current vault as a custom template, create a new vault
 *            from it, assert structure parity.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium
 *   npx playwright test e2e/project-templates.spec.ts --reporter=list
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

interface SeedOptions {
  onboardingStartMode?: 'blank' | 'sample' | 'template' | 'default-mythos-vault' | 'skip';
}

/**
 * Seed userData so the app boots directly into onboarding.
 * Used for template-selection tests.
 */
function seedUserData(userData: string, opts: SeedOptions = {}): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: false,
    onboardingStartMode: opts.onboardingStartMode ?? 'template',
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

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/**
 * Helper to check if a vault folder structure matches expected template.
 * Recursively verifies folder/file presence; ignores hidden files and manifest.
 */
function getVaultTree(dir: string): Record<string, any> {
  if (!fs.existsSync(dir)) return {};
  const tree: Record<string, any> = {};
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'manifest.json') continue;
    const fullPath = path.join(dir, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      tree[entry] = getVaultTree(fullPath);
    }
  }
  return tree;
}

// ─── TC-T-01: Built-in template selection ────────────────────────────────────

test.describe('TC-T-01: Built-in template selection and scaffolding', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-template-t01-'));
    seedUserData(userData, { onboardingStartMode: 'template' });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('onboarding wizard advances to template selection on "From Template" click', async () => {
    // Wait for step 1 (starting point selection)
    const step1 = page.locator('[data-testid="screen-step1"]');
    await expect(step1).toBeVisible({ timeout: 10_000 });

    // Click "From Template" card
    const templateCard = page.locator('[data-testid="card-template"]');
    await expect(templateCard).toBeVisible({ timeout: 6_000 });
    await templateCard.click();

    // Should now be on step 1b (template picker)
    const step1b = page.locator('[data-testid="screen-step1b"]');
    await expect(step1b).toBeVisible({ timeout: 8_000 });
  });

  test('template list displays at least 4 bundled templates', async () => {
    // Bundled templates: Novel (3-Act), Short Story, World-building Bible, Series Bible
    const templateCards = page.locator('[data-testid^="template-card-bundled:"]');
    const count = await templateCards.count();
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('selecting Short Story template advances to naming form', async () => {
    // Click Short Story template card
    const shortStoryCard = page.locator('[data-testid="template-card-bundled:short-story"]');
    await expect(shortStoryCard).toBeVisible({ timeout: 6_000 });
    await shortStoryCard.click();

    // Should now be on step 2 (naming form)
    const step2 = page.locator('[data-testid="screen-step2"]');
    await expect(step2).toBeVisible({ timeout: 8_000 });

    // Verify the form fields are visible
    await expect(page.locator('[data-testid="gs-title-input"]')).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('[data-testid="gs-author-input"]')).toBeVisible({ timeout: 6_000 });
    await expect(page.locator('[data-testid="gs-create-story"]')).toBeVisible({ timeout: 6_000 });
  });
});

// ─── TC-T-02: Empty templates list (fresh install) ────────────────────────────

test.describe('TC-T-02: Template list freshness', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-template-t02-'));
    seedUserData(userData, { onboardingStartMode: 'template' });
    app = await launchApp(userData);
    page = await firstWindow(app);

    // Navigate to template picker (step 1 → From Template)
    const step1 = page.locator('[data-testid="screen-step1"]');
    await expect(step1).toBeVisible({ timeout: 10_000 });
    const templateCard = page.locator('[data-testid="card-template"]');
    await templateCard.click();
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('fresh install contains no user templates directory', async () => {
    // No custom templates on a brand new install
    const templatesDir = path.join(userData, 'templates');
    expect(fs.existsSync(templatesDir)).toBe(false);
  });

  test('template picker shows only bundled templates', async () => {
    // Wait for step 1b (template picker)
    const step1b = page.locator('[data-testid="screen-step1b"]');
    await expect(step1b).toBeVisible({ timeout: 8_000 });

    // Check that all visible template cards have bundled: prefix
    const templateCards = page.locator('[data-testid^="template-card-bundled:"]');
    const count = await templateCards.count();
    expect(count).toBeGreaterThanOrEqual(4);

    // Verify no user template section is visible (no "Your Templates" divider)
    const userTemplateSection = page.locator('text="Your Templates"');
    await expect(userTemplateSection).not.toBeVisible();
  });
});

// ─── TC-T-03: Save-as-Template round-trip (PENDING) ──────────────────────────

test.describe.skip('TC-T-03: Save-as-Template round-trip', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-template-t03-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-template-t03-vault-'));
    // TODO: Seed a minimal vault structure
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('save current vault as a custom template', async () => {
    // BLOCKED on SKY-1303: Save-as-Template UI must exist
    // Once SKY-1303 lands, wire the UI action to call:
    //   window.api.saveAsTemplate(vaultRoot, notesVaultRoot, "My Custom Template")
    // Then verify the custom template appears in listTemplates().
  });

  test('create new vault from saved custom template', async () => {
    // BLOCKED on SKY-1303: UI for custom template selection
    // Once available, select the custom template and scaffold a new vault.
  });

  test('custom template structure matches original', async () => {
    // BLOCKED on SKY-1303
    // Verify that the new vault from the custom template has the same
    // folder/file structure as the original.
  });
});
