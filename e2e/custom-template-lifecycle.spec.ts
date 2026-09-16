/**
 * custom-template-lifecycle.spec.ts — SKY-11352
 *
 * E2E regression coverage for custom template lifecycle operations, restored
 * after PR #1408 silently deleted the original UI + this spec (SKY-1397,
 * SKY-1399). The IPC layer (`window.api.templateList/Rename/Duplicate/Delete`,
 * electron-main/src/templates.ts) was never removed — only the UI that drove
 * it. The pre-#1408 UI lived in the onboarding wizard's template picker; that
 * wizard was intentionally rewritten to exactly 3 screens under SKY-11151/
 * SKY-11152 and no longer enumerates multiple templates at all. This spec
 * targets the surviving, correct home for template management: Settings →
 * Vault & Files → "Your templates" (frontend/src/components/SettingsPanel/
 * sections/VaultPathsSection.tsx), next to the "Save as Template…" control
 * that creates these templates in the first place.
 *
 *   TC-CTL-01  Rename happy path — user template name updates; persists on restart
 *   TC-CTL-04  Delete happy path — user template removed from list; persists on restart
 *   TC-CTL-05  Delete confirm dialog — cancel preserves the template
 *   TC-CTL-06  Delete bundled guard — bundled templates never show delete/rename/duplicate
 *   TC-CTL-07  Duplicate happy path — creates a " copy" suffixed template; persists on restart
 *   TC-CTL-08  Duplicate collision — " copy" suffix auto-increments to " copy 2"
 *   TC-CTL-09  Count badge invariant — the "Your templates" count stays correct after every op
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium
 *   npx playwright test e2e/custom-template-lifecycle.spec.ts --reporter=list
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

interface SeedOptions {
  customTemplates?: Array<{ name: string }>;
}

function seedUserData(userData: string, storyVault: string, notesVault: string, opts: SeedOptions = {}): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );

  // electron-main/src/templates.ts loadUserTemplates() scans every *.json
  // file under userData/templates on each listTemplates() call — no separate
  // index/manifest file is needed.
  if (opts.customTemplates && opts.customTemplates.length > 0) {
    const templatesDir = path.join(userData, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    for (const tpl of opts.customTemplates) {
      const slug = tpl.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id = `user:${slug}-12345678`;
      const templateDef = {
        id,
        name: tpl.name,
        description: `Custom template: ${tpl.name}`,
        story: [],
        notes: [],
        isUserTemplate: true,
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(templatesDir, `${slug}-12345678.json`),
        JSON.stringify(templateDef, null, 2),
      );
    }
  }
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/** Menu bar gear -> Vault & Files tab -> "Your templates" list is visible. */
async function openTemplateSettings(pg: Page): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await pg.locator('.app-menu-gear-btn').click();
  await pg.getByRole('tab', { name: 'Vault & Files' }).click();
  await expect(pg.getByRole('heading', { name: /^vault paths$/i })).toBeVisible({ timeout: 5_000 });
}

function templateItem(pg: Page, id: string) {
  return pg.locator(`[data-testid="user-template-item-${id}"]`);
}

// ─── TC-CTL-01: Rename happy path ─────────────────────────────────────────────

test.describe('TC-CTL-01: Rename happy path', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  const templateId = 'user:my-novel-12345678';

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl01-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'Story Vault'), path.join(tempRoot, 'Notes Vault'), {
      customTemplates: [{ name: 'My Novel' }],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('rename custom template and verify persistence on restart', async () => {
    await openTemplateSettings(page);

    const item = templateItem(page, templateId);
    await expect(item).toBeVisible();
    await item.locator('[data-testid^="template-rename-btn-"]').click();
    const renameInput = item.locator('[data-testid^="template-rename-input-"]');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('My Renamed Novel');
    await renameInput.press('Enter');
    await expect(item.locator('[data-testid^="template-name-"]')).toHaveText('My Renamed Novel');

    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openTemplateSettings(page);
    await expect(templateItem(page, templateId).locator('[data-testid^="template-name-"]')).toHaveText('My Renamed Novel');
  });
});

// ─── TC-CTL-04 + TC-CTL-05: Delete happy path + confirm dialog ────────────────

test.describe('TC-CTL-04/05: Delete happy path and confirm dialog', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  const templateId = 'user:template-to-delete-12345678';

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl04-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'Story Vault'), path.join(tempRoot, 'Notes Vault'), {
      customTemplates: [{ name: 'Template to Delete' }],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('cancel preserves the template, confirm removes it and it does not reappear on restart', async () => {
    await openTemplateSettings(page);

    const item = templateItem(page, templateId);
    await expect(item).toBeVisible();
    await item.locator('[data-testid^="template-delete-btn-"]').click();

    const confirmBtn = page.locator('[data-testid="template-delete-confirm"]');
    const cancelBtn = page.locator('[data-testid="template-delete-cancel"]');
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });

    // Cancel first — template must survive.
    await cancelBtn.click();
    await expect(item).toBeVisible();
    await expect(confirmBtn).not.toBeVisible();

    // Now actually delete.
    await item.locator('[data-testid^="template-delete-btn-"]').click();
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();
    await expect(item).not.toBeVisible();

    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openTemplateSettings(page);
    await expect(templateItem(page, templateId)).not.toBeVisible();
  });
});

// ─── TC-CTL-06: Delete bundled guard ───────────────────────────────────────────

test.describe('TC-CTL-06: Bundled templates cannot be managed', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl06-'));
    userData = path.join(tempRoot, 'userData');
    // No custom templates — only the bundled catalog exists.
    seedUserData(userData, path.join(tempRoot, 'Story Vault'), path.join(tempRoot, 'Notes Vault'));
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('bundled-only state renders no "Your templates" management section', async () => {
    await openTemplateSettings(page);
    // With zero user templates, VaultPathsSection renders nothing for the
    // section at all — bundled templates are never listed as manageable.
    await expect(page.locator('[data-testid="user-templates-section"]')).not.toBeVisible();
  });
});

// ─── TC-CTL-07 + TC-CTL-08: Duplicate happy path + collision suffix ───────────

test.describe('TC-CTL-07/08: Duplicate happy path and collision suffix', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  const templateId = 'user:my-novel-12345678';

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl07-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'Story Vault'), path.join(tempRoot, 'Notes Vault'), {
      customTemplates: [{ name: 'My Novel' }],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('duplicate creates a "copy" suffix, and a second duplicate increments it', async () => {
    await openTemplateSettings(page);

    const original = templateItem(page, templateId);
    await expect(original).toBeVisible();
    await original.locator('[data-testid^="template-duplicate-btn-"]').click();
    await expect(page.getByText('My Novel copy', { exact: true })).toBeVisible({ timeout: 5_000 });

    // Duplicate the original again — collides with "My Novel copy", so the
    // electron-main duplicateTemplate() collision loop should land on " copy 2".
    await original.locator('[data-testid^="template-duplicate-btn-"]').click();
    await expect(page.getByText('My Novel copy 2', { exact: true })).toBeVisible({ timeout: 5_000 });

    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openTemplateSettings(page);
    await expect(page.getByText('My Novel copy', { exact: true })).toBeVisible();
    await expect(page.getByText('My Novel copy 2', { exact: true })).toBeVisible();
  });
});

// ─── TC-CTL-09: Count badge invariant ──────────────────────────────────────────

test.describe('TC-CTL-09: Count badge invariant', () => {
  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  const templateId = 'user:my-novel-12345678';

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl09-'));
    userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'Story Vault'), path.join(tempRoot, 'Notes Vault'), {
      customTemplates: [{ name: 'My Novel' }],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('count badge stays correct through duplicate then delete', async () => {
    await openTemplateSettings(page);
    const badge = page.locator('[data-testid="user-templates-count"]');
    await expect(badge).toHaveText('1');

    const original = templateItem(page, templateId);
    await original.locator('[data-testid^="template-duplicate-btn-"]').click();
    await expect(badge).toHaveText('2', { timeout: 5_000 });

    await original.locator('[data-testid^="template-delete-btn-"]').click();
    await page.locator('[data-testid="template-delete-confirm"]').click();
    await expect(badge).toHaveText('1', { timeout: 5_000 });
  });
});
