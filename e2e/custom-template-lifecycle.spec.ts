/**
 * custom-template-lifecycle.spec.ts — SKY-1462
 *
 * E2E regression coverage for custom template lifecycle operations (SKY-1397, SKY-1399):
 *
 *   TC-CTL-01  Rename happy path — user template name updates; persists on restart
 *   TC-CTL-04  Delete happy path — user template removed from picker; persists on restart
 *   TC-CTL-05  Delete modal — confirm dialog shown; cancel preserves template
 *   TC-CTL-06  Delete bundled guard — bundled templates cannot be deleted
 *   TC-CTL-07  Duplicate happy path — creates " copy" suffix; persists on restart
 *   TC-CTL-08  Duplicate collision — " copy" suffix auto-increments to " copy 2", etc.
 *   TC-CTL-09  Count badge invariant — custom template counter stays correct after all ops
 *
 * TC-CTL-02 (rename duplicate conflict) and TC-CTL-03 (rename invalid chars) remain
 * skipped below — see the per-test comments; they assert app behavior that isn't
 * implemented (no duplicate-name rejection, and invalid-char errors from the
 * TEMPLATE_RENAME IPC handler are never surfaced to the UI). Flagged on SKY-8211
 * for CTO re-triage rather than faked here.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SeedOptions {
  customTemplates?: Array<{ name: string; structure: Record<string, unknown> }>;
}

function seedUserData(userData: string, opts: SeedOptions = {}): void {
  // onboardingComplete: false routes straight to the wizard (App.tsx) without
  // ever validating a vault path, so the template picker is reachable without
  // needing a real vault on disk (SKY-6933's cited bug: the old seed pointed
  // vaultRoot at a dir it never mkdirSync'd, and onboardingComplete: true sent
  // the app to VaultNotFoundScreen instead of the wizard).
  const appSettings = {
    apiKey: '',
    onboardingComplete: false,
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

  // Seed custom templates — electron-main/src/templates.ts loadUserTemplates()
  // scans every *.json file under userData/templates on each listTemplates()
  // call; no separate index/manifest file is needed.
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
        story: tpl.structure.story || [],
        notes: tpl.structure.notes || [],
        isUserTemplate: true,
        savedAt: new Date().toISOString(),
      };
      const fileName = `${slug}-12345678.json`;
      fs.writeFileSync(
        path.join(templatesDir, fileName),
        JSON.stringify(templateDef, null, 2),
      );
    }
  }
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/**
 * Step1 (Welcome, 4-card set per SKY-7593) -> "Start blank" -> custom-location
 * step -> "Use a template instead" footer link -> step1b-inner (template picker).
 */
async function openTemplatePicker(pg: Page): Promise<void> {
  await expect(pg.locator('[data-testid="gs-overlay"]')).toBeVisible({ timeout: 15_000 });
  // SKY-8211: detectLegacyVaults() scans the real OS home dir (not the test's
  // isolated --user-data-dir), so on a machine with a stray legacy vault this
  // dialog can appear over the wizard and intercept clicks. Dismiss it if present.
  const migrationDialog = pg.locator('[data-testid="gs-migration-dialog"]');
  if (await migrationDialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await pg.locator('[data-testid="gs-migration-never"]').click();
    await expect(migrationDialog).not.toBeVisible({ timeout: 5_000 });
  }
  await pg.locator('[data-testid="card-start-blank"]').click();
  await expect(pg.locator('[data-testid="screen-custom-location"]')).toBeVisible({ timeout: 5_000 });
  await pg.locator('[data-testid="custom-location-use-template-link"]').click();
  await expect(pg.locator('[id="template-picker-heading"]')).toBeVisible({ timeout: 5_000 });
}

function userTemplateCard(pg: Page, name: string) {
  return pg.locator('.gs-template-card--user', { hasText: name });
}

// ─── TC-CTL-01: Rename happy path ─────────────────────────────────────────────

test.describe('TC-CTL-01: Rename happy path', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl01-'));
    seedUserData(userData, {
      customTemplates: [
        { name: 'My Novel', structure: { story: [], notes: [] } },
      ],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('rename custom template and verify persistence on restart', async () => {
    await openTemplatePicker(page);

    const card = userTemplateCard(page, 'My Novel');
    await expect(card).toBeVisible();
    // SKY-8211: action buttons are hidden until :hover/:focus-within (SKY-1399, OnboardingWizard.css).
    await card.hover();
    await card.locator('[data-testid^="template-rename-btn-"]').click();
    const renameInput = card.locator('[data-testid^="template-rename-input-"]');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('My Renamed Novel');
    await renameInput.press('Enter');
    await expect(userTemplateCard(page, 'My Renamed Novel')).toBeVisible();

    // Close and relaunch to verify persistence.
    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openTemplatePicker(page);
    await expect(userTemplateCard(page, 'My Renamed Novel')).toBeVisible();
  });
});

// ─── TC-CTL-04: Delete happy path ──────────────────────────────────────────────

test.describe('TC-CTL-04: Delete happy path', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl04-'));
    seedUserData(userData, {
      customTemplates: [
        { name: 'Template to Delete', structure: { story: [], notes: [] } },
      ],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('delete custom template removes it from picker and does not reappear on restart', async () => {
    await openTemplatePicker(page);

    const card = userTemplateCard(page, 'Template to Delete');
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('[data-testid^="template-delete-btn-"]').click();

    const confirmBtn = page.locator('[data-testid="template-delete-confirm"]');
    await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
    await confirmBtn.click();
    await expect(card).not.toBeVisible({ timeout: 3_000 });

    // Relaunch and verify the delete persisted.
    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openTemplatePicker(page);
    await expect(userTemplateCard(page, 'Template to Delete')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── TC-CTL-05: Delete confirmation modal ──────────────────────────────────────

test.describe('TC-CTL-05: Delete confirmation modal', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl05-'));
    seedUserData(userData, {
      customTemplates: [
        { name: 'Template to Preserve', structure: { story: [], notes: [] } },
      ],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('cancel in delete modal preserves template', async () => {
    await openTemplatePicker(page);

    const card = userTemplateCard(page, 'Template to Preserve');
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('[data-testid^="template-delete-btn-"]').click();

    const cancelBtn = page.locator('[data-testid="template-delete-cancel"]');
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });
    await cancelBtn.click();
    await expect(card).toBeVisible();
  });
});

// ─── TC-CTL-06: Delete bundled guard ──────────────────────────────────────────

test.describe('TC-CTL-06: Delete bundled guard', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl06-'));
    seedUserData(userData);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('bundled templates have no delete button', async () => {
    await openTemplatePicker(page);

    const bundledGroup = page.locator('[role="radiogroup"][aria-labelledby="template-picker-heading"]');
    const bundledCard = bundledGroup.locator('[role="radio"]').first();
    await expect(bundledCard).toBeVisible({ timeout: 5_000 });

    // Bundled cards render via the plain TemplateCard button — no action-btn markup at all.
    await expect(bundledCard.locator('[data-testid^="template-delete-btn-"]')).toHaveCount(0);
  });
});

// ─── TC-CTL-07: Duplicate happy path ──────────────────────────────────────────

test.describe('TC-CTL-07: Duplicate happy path', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl07-'));
    seedUserData(userData, {
      customTemplates: [
        { name: 'Original Template', structure: { story: [], notes: [] } },
      ],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('duplicate creates " copy" suffix and persists', async () => {
    await openTemplatePicker(page);

    const card = userTemplateCard(page, 'Original Template');
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('[data-testid^="template-duplicate-btn-"]').click();
    await expect(userTemplateCard(page, 'Original Template copy')).toBeVisible({ timeout: 5_000 });

    // Close and relaunch to verify persistence.
    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openTemplatePicker(page);
    await expect(userTemplateCard(page, 'Original Template copy')).toBeVisible();
  });
});

// ─── TC-CTL-08: Duplicate collision ───────────────────────────────────────────

test.describe('TC-CTL-08: Duplicate collision', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl08-'));
    seedUserData(userData, {
      customTemplates: [
        { name: 'Template', structure: { story: [], notes: [] } },
        { name: 'Template copy', structure: { story: [], notes: [] } },
      ],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('duplicate increments suffix when " copy" exists', async () => {
    await openTemplatePicker(page);

    // Disambiguate from the seeded "Template copy" card: the anchored regex
    // against the whole card's hasText would never match either card since
    // .gs-template-card__desc ("Custom template: Template") also renders
    // inside it, so scope the exact-match to the .gs-template-card__name span.
    const card = page.locator('.gs-template-card--user').filter({
      has: page.locator('.gs-template-card__name', { hasText: /^Template$/ }),
    });
    await expect(card).toBeVisible();
    await card.hover();
    await card.locator('[data-testid^="template-duplicate-btn-"]').click();
    await expect(userTemplateCard(page, 'Template copy 2')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── TC-CTL-09: Count badge invariant ──────────────────────────────────────────

test.describe('TC-CTL-09: Count badge invariant', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ctl09-'));
    seedUserData(userData, {
      customTemplates: [
        { name: 'Template A', structure: { story: [], notes: [] } },
        { name: 'Template B', structure: { story: [], notes: [] } },
      ],
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('count badge reflects correct number after delete and duplicate', async () => {
    await openTemplatePicker(page);

    const countBadge = page.locator('[data-testid="user-template-count"]');
    await expect(countBadge).toContainText('(2)');

    const cardA = userTemplateCard(page, 'Template A');
    await cardA.hover();
    await cardA.locator('[data-testid^="template-delete-btn-"]').click();
    await page.locator('[data-testid="template-delete-confirm"]').click();
    await expect(countBadge).toContainText('(1)');

    const cardB = userTemplateCard(page, 'Template B');
    await cardB.hover();
    await cardB.locator('[data-testid^="template-duplicate-btn-"]').click();
    await expect(countBadge).toContainText('(2)');
  });
});

// ─── TC-CTL-02 / TC-CTL-03: skipped — product gap, not a selector fix ─────────

// The TEMPLATE_RENAME IPC handler (electron-main/src/main.ts) does reject
// invalid/control characters, but the renderer's rename onKeyDown/onBlur
// handlers (OnboardingWizard.tsx) never inspect the `{ error }` response —
// there's no `template-rename-error` element or any rename-rejection UI.
// There is also no duplicate-name check anywhere in renameTemplate()
// (electron-main/src/templates.ts) or the IPC handler. Both TCs assert
// behavior that isn't implemented; flagged on SKY-8211 for CTO re-triage
// rather than faked here.
test.skip('TC-CTL-02: rename to existing name is rejected with error — product gap, see SKY-8211', () => {});
test.skip('TC-CTL-03: rename with control characters is rejected — product gap, see SKY-8211', () => {});
