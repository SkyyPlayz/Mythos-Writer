/**
 * onboarding-four-paths.spec.ts — SKY-2639 / SKY-2553 / SKY-8241
 *
 * SKY-8241 (ruling SKY-8382, "test-follows-product", QA/CTO-approved): this
 * file was fully `test.skip`'d under SKY-6933 because it targeted a
 * `[data-testid=screen-path-selector]` four-card *radiogroup* selector that
 * was replaced by the current wizard (SKY-7593, "design-handoff v2" — CTO
 * ruling SKY-7590 superseded the earlier SKY-6983 card set). This rewrite
 * retargets every AC at the actual shipped wizard read from
 * frontend/src/OnboardingWizard.tsx: step1 is a plain `role="group"` of 4
 * native `<button>` cards (card-sample / card-start-blank /
 * card-import-obsidian / card-open-existing) — no radiogroup, no
 * aria-checked, no arrow-key cycling, and no "Default Layout" 4th card
 * (that path was intentionally dropped, not regressed). No product code was
 * changed — test code only, per the ruling.
 *
 * Coverage map (AC-OB-01 .. AC-OB-25, mapped onto the current flow):
 *   AC-OB-01  Four button cards rendered on screen-step1 (role="group", NOT
 *             radiogroup); card-sample carries the "Recommended" chip
 *   AC-OB-02  Keyboard: Tab visits all 4 cards in DOM order; Enter and Space
 *             both activate a focused card (native <button> + explicit
 *             onKeyDown — arrow-key cycling dropped, see comment at test)
 *   AC-OB-03  DROPPED — old "Path 1 Default Layout / full SKY-15 structure"
 *             card (`card-path-default`) no longer exists (SKY-7593); no
 *             replacement, see comment at former location below
 *   AC-OB-04  DROPPED — same card, "custom title in vault path"; gone with it
 *   AC-OB-05  Start Fresh (card-start-blank) → custom-location → "Start
 *             Blank" template sends customTemplate:'blank' with
 *             startMode:'start-fresh' (was: Path 2 Blank seeds only root
 *             folders — that literal folder-layout assertion belongs to
 *             createMythosVault's own unit tests now; the wizard's job is
 *             sending the right flag, which this asserts)
 *   AC-OB-06  Start Fresh via "Use a template" (screen-step2's title field)
 *             — empty title blocks progression with an inline error (was:
 *             "empty title defaults to Untitled Story"; that silent fallback
 *             no longer exists — validateTitle() hard-requires a title now)
 *   AC-OB-07  Import Obsidian — dry-run success shows one target's preview
 *             stats (markdownCount/attachmentCount/totalFiles); optional
 *             topLevelFolders/sampleFiles lines render only when non-empty
 *   AC-OB-08  Import Obsidian — filling both notes + story slots produces two
 *             independent report sections (obs-report-notes/-story), each
 *             scoped to its own preview
 *   AC-OB-09  Import Obsidian — dry-run error surfaces inline
 *             (obs-dryrun-error); the action button stays enabled so the
 *             user can retry (was: fatalError permanently disabling Import —
 *             that field doesn't exist; current wizard never hard-blocks)
 *   AC-OB-10  Import Obsidian — Confirm commits each filled target in order
 *             (notes then story) and funnels into the shared theme→provider
 *             tail, finishing at the app shell (was: "goes to vault browser,
 *             not writing page" — no vault-browser testid exists; the real
 *             signal is `.app-menu-bar`, same as every other path)
 *   AC-OB-11  Import screen's other two independent sections (Open existing
 *             MW vault by path; .docx import) each complete the flow on their
 *             own via the same import-action-btn; a .docx import failure
 *             shows import-error-modal
 *   AC-OB-12  Sample genre picker (step1c) — exactly 3 cards, each with an
 *             expand/collapse accordion (detailed keyboard/ARIA behavior of
 *             this widget is covered by onboarding-v2.spec.ts; this file only
 *             smoke-checks it as part of the card-sample path)
 *   AC-OB-13  Selecting a genre and finishing the sample path sends the
 *             correct sampleGenre in the onboarding:complete payload
 *   AC-OB-14  Sample-project banner shown once after a sample completion;
 *             dismissing it persists (sampleProjectBannerDismissed) so it
 *             does not reappear on reload
 *   AC-OB-15  ConflictDialog "Open existing vault" → startMode:'open-existing'
 *             (was reached from screen-step2 before too; current step2 is
 *             now the "Use a Template" sub-flow off custom-location, not a
 *             flat step1→step2 hop — see navigateToTemplateStep2 helper)
 *   AC-OB-16  ConflictDialog "Create alongside" sets the path to `<parent> 2`
 *             and requires an explicit Create Story click to proceed (was:
 *             assumed auto-submit; current handleConflictCreateAlongside only
 *             refills + re-validates the field, see comment at test)
 *   AC-OB-17  onboardingComplete persists across restart — wizard does not
 *             reappear
 *   AC-OB-18  Dev/user reset via window.api.onboardingReset() clears the flag;
 *             wizard reappears on next launch
 *   AC-OB-19  Path validation debounce — custom-location's path field fires
 *             at most one vault:validate-path round-trip per 500ms idle
 *             window (the real debounce constant, confirmed in source)
 *   AC-OB-20  Import Obsidian — "Back" from the dry-run report returns to the
 *             fillable form with the previously-entered Obsidian path(s)
 *             still populated (obsDryRun is cleared, path state is not)
 *   AC-OB-21  Liquid Neon `--accent` CSS custom property present on :root
 *             while the wizard is showing
 *   AC-OB-22  aria-live="polite" region (genre-announcement) is unconditionally
 *             mounted on screen-step1c, before and after a genre is selected
 *             (was: "present on step1 / custom-location" — grep shows the
 *             wizard's only aria-live regions are template-announcement on
 *             step1b and genre-announcement on step1c; step1/custom-location
 *             have none)
 *   AC-OB-23  No microphone permission prompt during onboarding
 *             (getUserMedia({audio}) never called while the wizard shows)
 *   AC-OB-24  "Open existing vault" (card-open-existing) — the 4th top-level
 *             card — skips straight to Theme+Provider (Vault step skipped,
 *             Back hidden) and finishes with startMode:'open-existing'
 *   AC-OB-25  window.api.dryRunObsidianImport is a callable function wired to
 *             the real 'onboarding:dryRunObsidianImport' channel (was:
 *             `importVaultDryRun` / 'onboarding:import-vault:dry-run' — that
 *             channel still exists in electron-main/src/ipc.ts but the
 *             current Import screen never calls it; it's orphaned legacy
 *             surface, not what this screen actually uses)
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/onboarding-four-paths.spec.ts --reporter=list
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

type ValidatePathPayload = string | { path?: string };

const SELECTOR = {
  screenStep1: '[data-testid="screen-step1"]',
  cardSample: '[data-testid="card-sample"]',
  cardStartBlank: '[data-testid="card-start-blank"]',
  cardImportObsidian: '[data-testid="card-import-obsidian"]',
  cardOpenExisting: '[data-testid="card-open-existing"]',

  screenStep1c: '[data-testid="screen-step1c"]',
  genreRadiogroup: '[data-testid="genre-radiogroup"]',
  genreStartBtn: '[data-testid="genre-start-btn"]',

  screenStep1b: '[data-testid="screen-step1b"]',
  screenStep2: '[data-testid="screen-step2"]',
  gsTitleInput: '[data-testid="gs-title-input"]',
  gsTitleError: '[data-testid="gs-title-error"]',
  gsSavePath: '[data-testid="gs-save-path"]',
  gsCreateStory: '[data-testid="gs-create-story"]',
  gsConflictDialog: '[data-testid="gs-conflict-dialog"]',
  gsConflictOpenExisting: '[data-testid="gs-conflict-open-existing"]',
  gsConflictCreateAlongside: '[data-testid="gs-conflict-create-alongside"]',
  gsConflictSeeOptions: '[data-testid="gs-conflict-see-options"]',
  gsPathValidationHint: '[data-testid="gs-path-validation-hint"]',

  screenCustomLocation: '[data-testid="screen-custom-location"]',
  customVaultPathInput: '[data-testid="custom-vault-path-input"]',
  customVaultNameInput: '[data-testid="custom-vault-name-input"]',
  customLocationNext: '[data-testid="custom-location-next"]',
  customLocationUseTemplateLink: '[data-testid="custom-location-use-template-link"]',

  screenCustomTemplate: '[data-testid="screen-custom-template"]',
  customTemplateBlank: '[data-testid="custom-template-blank"]',
  customTemplateRecommended: '[data-testid="custom-template-recommended"]',
  customTemplateFinish: '[data-testid="custom-template-finish"]',
  customTemplateContinue: '[data-testid="custom-template-continue"]',

  screenCustomGenre: '[data-testid="screen-custom-genre"]',
  customGenreContinue: '[data-testid="custom-genre-continue"]',

  screenCustomTheme: '[data-testid="screen-custom-theme"]',
  customThemeContinue: '[data-testid="custom-theme-continue"]',
  customThemeBack: '[data-testid="custom-theme-back"]',

  screenWizProvider: '[data-testid="screen-wiz-provider"]',
  wizProviderSkip: '[data-testid="wiz-provider-skip"]',

  screenStepImport: '[data-testid="screen-step-import"]',
  importMwPath: '[data-testid="import-mw-path"]',
  importMwBrowse: '[data-testid="import-mw-browse"]',
  importObsNotesBrowse: '[data-testid="import-obs-notes-browse"]',
  importObsStoryBrowse: '[data-testid="import-obs-story-browse"]',
  importDocxInput: '[data-testid="import-docx-input"]',
  importActionBtn: '[data-testid="import-action-btn"]',
  obsDryrunReport: '[data-testid="obs-dryrun-report"]',
  obsReportNotes: '[data-testid="obs-report-notes"]',
  obsReportStory: '[data-testid="obs-report-story"]',
  obsReportBack: '[data-testid="obs-report-back"]',
  obsReportConfirm: '[data-testid="obs-report-confirm"]',
  obsDryrunError: '[data-testid="obs-dryrun-error"]',
  obsImportError: '[data-testid="obs-import-error"]',
  importErrorModal: '[data-testid="import-error-modal"]',
  importErrorDismiss: '[data-testid="import-error-dismiss"]',

  appMenuBar: '.app-menu-bar',
  ariaLiveRegion: '[aria-live="polite"]',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function launchFreshApp(
  userData: string,
  env?: Record<string, string>,
): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    env: { ...process.env, HOME: userData, ...env },
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication, timeout = 60_000): Promise<Page> {
  const page = await app.firstWindow({ timeout });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** DesktopShell only renders `.app-menu-bar` once a vault is actually
 *  configured (see e2e/tests/first-run-dead-end.spec.ts) — onboardingComplete
 *  alone is not enough on a fresh boot/reload. Seeds a minimal, empty,
 *  writable vault pair alongside app-settings.json. */
function seedVaultSettings(userData: string): { vaultRoot: string; notesVaultRoot: string } {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-vault-'));
  const notesVaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-notes-'));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot, notesVaultRoot, layoutMode: 'blank' }, null, 2),
  );
  return { vaultRoot, notesVaultRoot };
}

function seedSettings(userData: string, overrides: Record<string, unknown>): void {
  const defaults = {
    apiKey: '',
    onboardingComplete: false,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
  };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ ...defaults, ...overrides }, null, 2),
  );
}

/** Stub the real vault-creation/open IPC so tests don't touch the filesystem
 *  and can capture exactly what the wizard sent. */
async function stubOnboardingComplete(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('onboarding:complete');
    ipcMain.handle('onboarding:complete', (_evt: unknown, payload: unknown) => {
      (global as Record<string, unknown>).__lastObPayload__ = payload;
      return { ok: true };
    });
  });
}

async function lastObPayload(app: ElectronApplication): Promise<Record<string, unknown>> {
  return app.evaluate(() => (global as Record<string, unknown>).__lastObPayload__) as Promise<Record<string, unknown>>;
}

async function stubValidatePath(
  app: ElectronApplication,
  result: { exists: boolean; isEmpty: boolean; writable: boolean },
): Promise<void> {
  await app.evaluate(({ ipcMain }, r) => {
    ipcMain.removeHandler('vault:validate-path');
    ipcMain.handle('vault:validate-path', () => r);
  }, result);
}

/** Complete the shared genre → theme → provider tail from screen-custom-genre
 *  (the start-fresh/template/quick-start flows visit all three screens). */
async function finishFullTail(page: Page): Promise<void> {
  await expect(page.locator(SELECTOR.screenCustomGenre)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.customGenreContinue).click();
  await expect(page.locator(SELECTOR.screenCustomTheme)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.customThemeContinue).click();
  await expect(page.locator(SELECTOR.screenWizProvider)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.wizProviderSkip).click();
}

/** Complete the theme → provider tail from screen-custom-theme (the
 *  sample/import/open-existing flows skip custom-genre entirely). */
async function finishThemeTail(page: Page): Promise<void> {
  await expect(page.locator(SELECTOR.screenCustomTheme)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.customThemeContinue).click();
  await expect(page.locator(SELECTOR.screenWizProvider)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.wizProviderSkip).click();
}

/** Reach screen-step2 via the real route: card-start-blank → custom-location
 *  → "Use a template instead" → step1b template gallery → pick a template.
 *  screen-step2 (title/author/save-path form, ConflictDialog) is ONLY
 *  reachable through this template sub-flow now — SKY-7593 moved "Use a
 *  Template" off step1 onto custom-location as a low-emphasis link (see
 *  custom-location-use-template-link at OnboardingWizard.tsx:2786). Stubs
 *  template:list with one item so the picker doesn't depend on bundled
 *  template data being present in this environment. */
async function navigateToTemplateStep2(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('template:list');
    ipcMain.handle('template:list', () => ({
      templates: [{
        id: 'e2e-step2-stub',
        name: 'E2E Step 2 Stub',
        description: 'Stub template routing to screen-step2.',
        story: [],
        notes: [],
      }],
    }));
  });
  await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
  await page.locator(SELECTOR.cardStartBlank).click();
  await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.customLocationUseTemplateLink).click();
  await expect(page.locator(SELECTOR.screenStep1b)).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('[data-testid="template-card-e2e-step2-stub"]')).toBeVisible({ timeout: 6_000 });
  await page.locator('[data-testid="template-card-e2e-step2-stub"]').click();
  await page.locator('[data-testid="template-use-btn"]').click();
  await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
}

// ─── AC-OB-01 & AC-OB-02: step1 four-card selector + keyboard ────────────────

test.describe('AC-OB-01 & AC-OB-02: step1 four button cards + keyboard', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-01-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-01: exactly 4 real button cards in a role="group" (not radiogroup); card-sample has the Recommended chip', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });

    // Container is role="group" (OnboardingWizard.tsx:2036) — NOT a radiogroup.
    const group = page.locator('[role="group"][aria-label="Choose how to get started"]');
    await expect(group).toBeVisible();
    await expect(page.locator('[role="radiogroup"]')).toHaveCount(0);

    // The 4 real cards, none of them role="radio" / aria-checked.
    for (const testId of ['card-sample', 'card-start-blank', 'card-import-obsidian', 'card-open-existing']) {
      const card = page.locator(`[data-testid="${testId}"]`);
      await expect(card).toBeVisible();
      await expect(card).not.toHaveAttribute('role', 'radio');
      await expect(card).not.toHaveAttribute('aria-checked');
    }
    // There is no 4th "Default Layout" card — SKY-7593 dropped it (see
    // AC-OB-03/04 comment in the coverage map above).
    await expect(page.locator('[data-testid="card-path-default"]')).toHaveCount(0);

    const chip = page.locator(SELECTOR.cardSample).locator('.gs-card__chip');
    await expect(chip).toHaveText('Recommended');
  });

  test('AC-OB-02a: Tab order visits all 4 cards in DOM order', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 8_000 });

    // card-sample gets initial focus automatically on mount (AC-L-05 in source).
    await expect(page.locator(SELECTOR.cardSample)).toBeFocused({ timeout: 3_000 });

    await page.keyboard.press('Tab');
    await expect(page.locator(SELECTOR.cardStartBlank)).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator(SELECTOR.cardImportObsidian)).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator(SELECTOR.cardOpenExisting)).toBeFocused();
  });

  test('AC-OB-02b: Enter activates a focused card (card-start-blank → screen-custom-location)', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 8_000 });
    await page.locator(SELECTOR.cardStartBlank).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });

    // Return to step1 for the next test.
    await page.locator('[data-testid="custom-location-back"]').click();
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 8_000 });
  });

  test('AC-OB-02c: Space activates a focused card (card-import-obsidian → screen-step-import)', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 8_000 });
    await page.locator(SELECTOR.cardImportObsidian).focus();
    await page.keyboard.press(' ');
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });
  });
});

// AC-OB-03 / AC-OB-04 — DROPPED. The old "Path 1 Default Layout" card
// (`card-path-default`, full SKY-15 structure seed) does not exist anywhere
// in the current wizard: `grep -n 'card-path-default' frontend/src/OnboardingWizard.tsx`
// returns nothing, and `role="group"` at step1 lists only the 4 real cards
// (card-sample/card-start-blank/card-import-obsidian/card-open-existing).
// SKY-7593 (CTO ruling SKY-7590) intentionally replaced that card set — this
// is not a regression, so no replacement test is added per the SKY-8241 scope
// ruling.

// ─── AC-OB-05 & AC-OB-06: Start Fresh (card-start-blank) screens ─────────────

test.describe('AC-OB-05: Start Fresh — Start Blank template sends customTemplate:"blank"', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-05-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await stubValidatePath(app, { exists: false, isEmpty: true, writable: true });
    await stubOnboardingComplete(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-05: custom-location → custom-template "Start Blank" → Skip sends startMode:start-fresh, customTemplate:blank', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });

    const vaultParent = path.join(userData, 'Vaults05');
    fs.mkdirSync(vaultParent, { recursive: true });
    await page.locator(SELECTOR.customVaultPathInput).fill(vaultParent);
    await page.locator(SELECTOR.customVaultNameInput).fill('My Blank Vault');
    await page.waitForTimeout(700); // 500ms debounce + IPC round trip
    await expect(page.locator(SELECTOR.customLocationNext)).toBeEnabled({ timeout: 4_000 });
    await page.locator(SELECTOR.customLocationNext).click();

    await expect(page.locator(SELECTOR.screenCustomTemplate)).toBeVisible({ timeout: 8_000 });
    await page.locator(SELECTOR.customTemplateBlank).click();
    await expect(page.locator(SELECTOR.customTemplateBlank)).toHaveAttribute('aria-checked', 'true');

    // "Skip this — create my vault" (custom-template-finish) bypasses the
    // genre/theme/provider tail and fires handleCustomFinish() directly.
    await page.locator(SELECTOR.customTemplateFinish).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await lastObPayload(app);
    expect(payload.startMode).toBe('start-fresh');
    expect(payload.customTemplate).toBe('blank');
    expect(payload.vaultName).toBe('My Blank Vault');
  });
});

test.describe('AC-OB-06: Start Fresh via template — empty story title blocks progression', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-06-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await navigateToTemplateStep2(app, page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-06: leaving the title empty and clicking Create Story shows an inline error and stays on screen-step2', async () => {
    // storyTitle starts as '' — no "Untitled Story" fallback exists anymore
    // (validateTitle() in OnboardingWizard.tsx hard-requires a non-empty title).
    await expect(page.locator(SELECTOR.gsTitleInput)).toHaveValue('');
    await page.locator(SELECTOR.gsCreateStory).click();

    await expect(page.locator(SELECTOR.gsTitleError)).toBeVisible({ timeout: 3_000 });
    await expect(page.locator(SELECTOR.gsTitleError)).toContainText('Please give your story a title before continuing.');
    // No navigation happened.
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible();
  });
});

// ─── AC-OB-07 through AC-OB-11: Import Obsidian vault (screen-step-import) ───

test.describe('AC-OB-07: Obsidian dry-run success — single target preview stats', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-07-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-07: filling only the notes slot dry-runs just that target; optional folder/sample lines omitted when empty', async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-notes-07-'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        preview: { markdownCount: 12, attachmentCount: 3, totalFiles: 15, topLevelFolders: [], sampleFiles: [] },
      }));
    }, notesDir);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.importObsNotesBrowse).click();
    await expect(page.locator('[data-testid="import-obs-notes-path"]')).toHaveValue(notesDir);
    await expect(page.locator(SELECTOR.importActionBtn)).toBeEnabled();
    await page.locator(SELECTOR.importActionBtn).click();

    await expect(page.locator(SELECTOR.obsDryrunReport)).toBeVisible({ timeout: 8_000 });
    const notesSection = page.locator(SELECTOR.obsReportNotes);
    await expect(notesSection).toBeVisible();
    await expect(notesSection).toContainText('12 markdown notes');
    await expect(notesSection).toContainText('3 attachments');
    await expect(notesSection).toContainText('15 files total');
    await expect(page.locator(SELECTOR.obsReportStory)).toHaveCount(0);
    // topLevelFolders/sampleFiles are empty arrays — those <p> lines don't render.
    await expect(notesSection).not.toContainText('Top-level folders');
    await expect(notesSection).not.toContainText('Sample files');

    fs.rmSync(notesDir, { recursive: true, force: true });
  });
});

test.describe('AC-OB-08: Obsidian dry-run — both slots produce independent report sections', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-08-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-08: notes + story both filled → obs-report-notes and obs-report-story each show their own preview', async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-notes-08-'));
    const storyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-story-08-'));
    await app.evaluate(({ ipcMain }, dirs: { notesDir: string; storyDir: string }) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', (_evt: unknown, payload: { title?: string }) => {
        const isStory = (payload?.title ?? '').toLowerCase().includes('story');
        return { path: isStory ? dirs.storyDir : dirs.notesDir, cancelled: false };
      });
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', (_evt: unknown, payload: { targetVaultKind: 'notes' | 'story' }) => {
        if (payload.targetVaultKind === 'story') {
          return { preview: { markdownCount: 7, attachmentCount: 0, totalFiles: 7, topLevelFolders: ['Chapters'], sampleFiles: ['Chapter 1.md'] } };
        }
        return { preview: { markdownCount: 20, attachmentCount: 5, totalFiles: 25, topLevelFolders: ['Characters', 'Places'], sampleFiles: [] } };
      });
    }, { notesDir, storyDir });

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.importObsNotesBrowse).click();
    await page.locator(SELECTOR.importObsStoryBrowse).click();
    await page.locator(SELECTOR.importActionBtn).click();

    await expect(page.locator(SELECTOR.obsDryrunReport)).toBeVisible({ timeout: 8_000 });
    const notesSection = page.locator(SELECTOR.obsReportNotes);
    const storySection = page.locator(SELECTOR.obsReportStory);
    await expect(notesSection).toContainText('20 markdown notes');
    await expect(notesSection).toContainText('Characters, Places');
    await expect(storySection).toContainText('7 markdown notes');
    await expect(storySection).toContainText('Chapter 1.md');

    fs.rmSync(notesDir, { recursive: true, force: true });
    fs.rmSync(storyDir, { recursive: true, force: true });
  });
});

test.describe('AC-OB-09: Obsidian dry-run error stays inline; retry is possible', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-09-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-09: dry-run error shows obs-dryrun-error inline; import-action-btn stays enabled for retry (no fatalError field exists)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-bad-09-'));
    await app.evaluate(({ ipcMain }, d) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: d, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({ error: 'Could not read this folder: permission denied' }));
    }, dir);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.importObsNotesBrowse).click();
    await page.locator(SELECTOR.importActionBtn).click();

    const error = page.locator(SELECTOR.obsDryrunError);
    await expect(error).toBeVisible({ timeout: 6_000 });
    await expect(error).toContainText('permission denied');
    // The report never rendered — stayed on the fillable form.
    await expect(page.locator(SELECTOR.obsDryrunReport)).toHaveCount(0);
    await expect(page.locator(SELECTOR.importActionBtn)).toBeEnabled();

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test.describe('AC-OB-10: Obsidian Confirm commits per-target and finishes at the app shell', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-10-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-10: Confirm import calls importObsidianVault(notes) then importObsidianVault(story), then theme→provider→app-shell', async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-notes-10-'));
    const storyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-story-10-'));
    await app.evaluate(({ ipcMain }, dirs: { notesDir: string; storyDir: string }) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', (_evt: unknown, payload: { title?: string }) => {
        const isStory = (payload?.title ?? '').toLowerCase().includes('story');
        return { path: isStory ? dirs.storyDir : dirs.notesDir, cancelled: false };
      });
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        preview: { markdownCount: 1, attachmentCount: 0, totalFiles: 1, topLevelFolders: [], sampleFiles: [] },
      }));
      ipcMain.removeHandler('onboarding:importObsidianVault');
      (global as Record<string, unknown>).__ob10Order__ = [];
      ipcMain.handle('onboarding:importObsidianVault', (_evt: unknown, payload: { targetVaultKind: 'notes' | 'story' }) => {
        ((global as Record<string, unknown>).__ob10Order__ as string[]).push(payload.targetVaultKind);
        return { ok: true };
      });
    }, { notesDir, storyDir });
    await stubOnboardingComplete(app);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.importObsNotesBrowse).click();
    await page.locator(SELECTOR.importObsStoryBrowse).click();
    await page.locator(SELECTOR.importActionBtn).click();
    await expect(page.locator(SELECTOR.obsDryrunReport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.obsReportConfirm).click();

    // Import commits and funnels into the shared theme → provider tail — NOT
    // a "vault browser" screen (no such testid exists; `.app-menu-bar` is the
    // real "app is open" signal, same as every other path).
    await finishThemeTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const order = await app.evaluate(() => (global as Record<string, unknown>).__ob10Order__);
    expect(order).toEqual(['notes', 'story']);

    fs.rmSync(notesDir, { recursive: true, force: true });
    fs.rmSync(storyDir, { recursive: true, force: true });
  });
});

test.describe('AC-OB-11: import screen\'s other two independent sections', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-11-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-11a: "Open Mythos Writer vault" section (import-mw-path) completes without touching the Obsidian sections', async () => {
    await stubValidatePath(app, { exists: true, isEmpty: false, writable: true });
    await stubOnboardingComplete(app);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    const mwDir = path.join(userData, 'existing-mw-vault');
    fs.mkdirSync(mwDir, { recursive: true });
    await page.locator(SELECTOR.importMwPath).fill(mwDir);
    await page.waitForTimeout(600); // 400ms debounce, see handleImportMwPathChange
    await expect(page.locator(SELECTOR.importActionBtn)).toBeEnabled();
    await page.locator(SELECTOR.importActionBtn).click();

    await finishThemeTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await lastObPayload(app);
    expect(payload.startMode).toBe('open-existing');
    expect(payload.vaultParentPath).toBe(mwDir);
  });

  test('AC-OB-11b: .docx import failure shows import-error-modal, dismissible', async () => {
    // Fresh navigation for this sub-test — previous test already finished onboarding.
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-11b-'));
    await app.close().catch(() => {});
    app = await launchFreshApp(userData);
    page = await firstWindow(app);

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:importDocxToStoryVault');
      ipcMain.handle('onboarding:importDocxToStoryVault', () => ({
        ok: false,
        importedStories: [],
        errors: [{ filePath: 'bad.docx', error: 'Unrecognized .docx structure' }],
      }));
    });

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    // Simulate picking a .docx file via the hidden file input.
    await page.setInputFiles(SELECTOR.importDocxInput, {
      name: 'bad.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('not a real docx'),
    });
    await page.locator(SELECTOR.importActionBtn).click();

    const modal = page.locator(SELECTOR.importErrorModal);
    await expect(modal).toBeVisible({ timeout: 6_000 });
    await expect(modal).toContainText('Unrecognized .docx structure');
    await page.locator(SELECTOR.importErrorDismiss).click();
    await expect(modal).toHaveCount(0);
  });
});

// ─── AC-OB-20: Import Obsidian — Back from report pre-fills path ─────────────

test.describe('AC-OB-20: Obsidian report "Back" preserves the entered path', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-20-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-20: clicking obs-report-back returns to the fillable form with the notes path still populated', async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-notes-20-'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        preview: { markdownCount: 2, attachmentCount: 0, totalFiles: 2, topLevelFolders: [], sampleFiles: [] },
      }));
    }, notesDir);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.importObsNotesBrowse).click();
    await page.locator(SELECTOR.importActionBtn).click();
    await expect(page.locator(SELECTOR.obsDryrunReport)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.obsReportBack).click();
    await expect(page.locator(SELECTOR.obsDryrunReport)).toHaveCount(0);
    await expect(page.locator('[data-testid="import-obs-notes-path"]')).toHaveValue(notesDir);

    fs.rmSync(notesDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-12 & AC-OB-13: sample path (card-sample) genre picker + finish ────

test.describe('AC-OB-12 & AC-OB-13: sample path genre picker + completion payload', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-12-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-12: genre picker renders exactly 3 genre cards with an accordion each (detailed a11y coverage lives in onboarding-v2.spec.ts)', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    const cards = page.locator(`${SELECTOR.genreRadiogroup} [role="radio"]`);
    await expect(cards).toHaveCount(3);

    for (const genre of ['cozy-fantasy', 'sci-fi-noir', 'mystery']) {
      const accordionBtn = page.locator(`[data-testid="genre-accordion-btn-${genre}"]`);
      await accordionBtn.click();
      await expect(accordionBtn).toHaveAttribute('aria-expanded', 'true');
      await accordionBtn.click();
      await expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('AC-OB-13: selecting sci-fi-noir and finishing sends startMode:sample, sampleGenre:sci-fi-noir', async () => {
    await stubOnboardingComplete(app);

    await page.locator('[data-testid="genre-card-sci-fi-noir"]').click();
    await expect(page.locator('[data-testid="genre-card-sci-fi-noir"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(SELECTOR.genreStartBtn)).toBeEnabled();
    await page.locator(SELECTOR.genreStartBtn).click();

    // Sample funnels into the theme → provider tail (custom-genre is skipped
    // — the genre was already picked on step1c).
    await finishThemeTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await lastObPayload(app);
    expect(payload.startMode).toBe('sample');
    expect(payload.sampleGenre).toBe('sci-fi-noir');
  });
});

// ─── AC-OB-14: sample-project banner shown once, dismissed permanently ──────

test.describe('AC-OB-14: sample banner dismissed permanently', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-14-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-14: banner shown after sample completion; dismissing persists sampleProjectBannerDismissed across reload', async () => {
    await stubOnboardingComplete(app);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="genre-card-cozy-fantasy"]').click();
    await page.locator(SELECTOR.genreStartBtn).click();
    await finishThemeTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    // The stubbed onboarding:complete never persisted onboardingComplete/
    // onboardingStartMode or a vault pair, so seed all three directly before
    // reloading — DesktopShell only renders `.app-menu-bar` on a fresh boot
    // once a vault is actually configured (see seedVaultSettings above).
    const settingsPath = path.join(userData, 'app-settings.json');
    const current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    fs.writeFileSync(settingsPath, JSON.stringify({
      ...current,
      onboardingComplete: true,
      onboardingStartMode: 'sample',
    }, null, 2));
    seedVaultSettings(userData);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const banner = page.locator('[data-testid="gs-sample-banner"]');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/sample project/i);

    await page.locator('[data-testid="gs-sample-banner-dismiss"]').click();
    await expect(banner).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
    await expect(banner).toHaveCount(0);
  });
});

// ─── AC-OB-15 & AC-OB-16: ConflictDialog via the template screen-step2 ───────

test.describe('AC-OB-15: ConflictDialog "Open existing vault" sends startMode:open-existing', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-15-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await stubValidatePath(app, { exists: false, isEmpty: true, writable: true });
    await navigateToTemplateStep2(app, page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-15: existing-vault conflict → "See options" → "Open existing vault" → theme (Back hidden) → provider → app shell', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const p = typeof payload === 'string' ? payload : payload.path ?? '';
        if (p.includes('manifest.json')) return { exists: true, isEmpty: false, writable: true };
        return { exists: true, isEmpty: false, writable: true };
      });
    });
    await stubOnboardingComplete(app);

    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'existing-vault'));

    await expect(page.locator(SELECTOR.gsPathValidationHint)).toBeVisible({ timeout: 1500 });
    await page.locator(SELECTOR.gsConflictSeeOptions).click();
    await expect(page.locator(SELECTOR.gsConflictDialog)).toBeVisible({ timeout: 4_000 });

    await page.locator(SELECTOR.gsConflictOpenExisting).click();

    // handleConflictOpenExisting routes straight into the theme tail (Vault
    // step skipped — Back is hidden, same as the top-level card-open-existing).
    await expect(page.locator(SELECTOR.screenCustomTheme)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(SELECTOR.customThemeBack)).toHaveCount(0);
    await finishThemeTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await lastObPayload(app);
    expect(payload.startMode).toBe('open-existing');
  });
});

test.describe('AC-OB-16: ConflictDialog "Create alongside" sets the "<parent> 2" path', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-16-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await stubValidatePath(app, { exists: false, isEmpty: true, writable: true });
    await navigateToTemplateStep2(app, page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-16: create-alongside refills the path field; an explicit Create Story click is required to proceed', async () => {
    // handleConflictCreateAlongside only calls setSavePath + validatePathNow —
    // it does NOT auto-submit (unlike the old spec's assumption). The user
    // still has to click Create Story and walk the genre/theme/provider tail.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const p = typeof payload === 'string' ? payload : payload.path ?? '';
        // Only the ORIGINAL path's Story Vault/manifest.json check reports a
        // conflict; the " 2" alongside path's manifest check, and every other
        // validatePath call this screen makes (base-path writability check,
        // validateStoryDetails' separate title-dir-conflict check), must come
        // back clean — otherwise validateStoryDetails() would wrongly treat
        // the story title as colliding and block Create Story entirely.
        if (p.includes('manifest.json') && !p.includes(' 2')) {
          return { exists: true, isEmpty: false, writable: true };
        }
        return { exists: false, isEmpty: true, writable: true };
      });
    });
    await stubOnboardingComplete(app);

    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'existing-vault'));
    await expect(page.locator(SELECTOR.gsPathValidationHint)).toBeVisible({ timeout: 1500 });
    await page.locator(SELECTOR.gsConflictSeeOptions).click();
    await expect(page.locator(SELECTOR.gsConflictDialog)).toBeVisible({ timeout: 4_000 });

    await page.locator(SELECTOR.gsConflictCreateAlongside).click();
    await expect(page.locator(SELECTOR.gsConflictDialog)).toHaveCount(0);
    await expect(pathInput).toHaveValue(/ 2$/, { timeout: 2_000 });
    // Still on screen-step2 — no auto-submit.
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible();

    await page.locator(SELECTOR.gsTitleInput).fill('OB-16 Story');
    await page.locator(SELECTOR.gsCreateStory).click();
    await finishFullTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await lastObPayload(app);
    expect(String(payload.vaultParentPath ?? '')).toMatch(/ 2$/);
  });
});

// ─── AC-OB-17 & AC-OB-18: settings persistence + dev reset ──────────────────

test.describe('AC-OB-17: onboardingComplete persists across app restart', () => {
  let userData: string;
  let app: ElectronApplication;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-17-'));
    seedSettings(userData, { onboardingComplete: true });
    seedVaultSettings(userData);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-17: launching with onboardingComplete:true skips the wizard; app shell renders directly', async () => {
    app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    await expect(page.locator(SELECTOR.screenStep1)).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('AC-OB-18: onboarding:reset clears the flag; wizard reappears', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-18-'));
    seedSettings(userData, { onboardingComplete: true });
    seedVaultSettings(userData);
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-18: window.api.onboardingReset() then restarting shows the wizard again', async () => {
    await page.evaluate(async () => {
      await (window as unknown as { api: { onboardingReset: () => Promise<{ ok: boolean }> } }).api.onboardingReset();
    });

    await app.close().catch(() => {});
    app = await launchFreshApp(userData);
    page = await firstWindow(app);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
  });
});

// ─── AC-OB-19: path validation debounce ──────────────────────────────────────

test.describe('AC-OB-19: custom-location path validation debounces at 500ms idle', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-19-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      (global as Record<string, unknown>).__validateCallCount__ = 0;
      ipcMain.handle('vault:validate-path', () => {
        (global as Record<string, unknown>).__validateCallCount__ =
          ((global as Record<string, unknown>).__validateCallCount__ as number) + 1;
        return { exists: false, isEmpty: true, writable: true };
      });
    });

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-19: rapid keystrokes into custom-vault-path-input produce ≤2 validate calls (500ms debounce, 2 checks/call)', async () => {
    const pathInput = page.locator(SELECTOR.customVaultPathInput);
    await pathInput.clear();

    const typingText = path.join(userData, 'my-vault');
    await pathInput.pressSequentially(typingText, { delay: 30 });

    // 500ms debounce (handleCustomPathChange) + settle time.
    await page.waitForTimeout(900);

    const callCount = await app.evaluate(
      () => (global as Record<string, unknown>).__validateCallCount__,
    ) as number;

    // validateCustomPathNow fires 2 validate-path calls per invocation (base
    // path + Story Vault/manifest.json check) — so ≤2 for exactly one
    // debounced invocation, not 2×N for N keystrokes.
    expect(callCount).toBeLessThanOrEqual(2);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── AC-OB-21, 22, 23: generic wizard-wide checks ────────────────────────────

test.describe('AC-OB-21/22/23: Liquid Neon token, aria-live region, no mic prompt', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-21-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-21: --accent Liquid Neon CSS token is defined on :root while the wizard shows', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    const hasAccentToken = await page.evaluate(() => {
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent');
      return accent.trim().length > 0;
    });
    expect(hasAccentToken).toBe(true);
  });

  test('AC-OB-22: aria-live="polite" region is always mounted on screen-step1c, not conditionally rendered on selection state', async () => {
    // `grep -n aria-live frontend/src/OnboardingWizard.tsx` shows the only
    // aria-live="polite" regions in the whole wizard are `template-announcement`
    // (screen-step1b) and `genre-announcement` (screen-step1c) — screen-step1
    // and screen-custom-location have none. Rewritten to check the region that
    // actually exists: it's an unconditional `sr-only` <p> (always in the DOM,
    // content changes via JS), not gated behind an error/loading condition —
    // verified both before AND after a genre is selected.
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 8_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    const announcement = page.locator('[data-testid="genre-announcement"]');
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await expect(announcement).toBeAttached();

    await page.locator('[data-testid="genre-card-mystery"]').click();
    // Still attached/mounted after selection changes — not swapped in/out.
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await expect(announcement).toBeAttached();

    await page.locator('[data-testid="gs-back-step1c"]').click();
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 8_000 });
  });

  test('AC-OB-23: navigator.mediaDevices.getUserMedia({audio}) is never called while onboarding shows', async () => {
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__micRequested__ = false;
      if (navigator.mediaDevices) {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) => {
          if (constraints?.audio) {
            (window as unknown as Record<string, boolean>).__micRequested__ = true;
          }
          return original(constraints);
        };
      }
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });

    await page.waitForTimeout(2_000);
    const micRequested = await page.evaluate(
      () => (window as unknown as Record<string, boolean>).__micRequested__ ?? false,
    );
    expect(micRequested).toBe(false);
  });
});

// ─── AC-OB-24: Open existing vault (4th top-level card) ─────────────────────

test.describe('AC-OB-24: card-open-existing skips straight to Theme + Provider', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-24-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-24: picking a folder via card-open-existing goes straight to screen-custom-theme (no Back), then finishes with startMode:open-existing', async () => {
    const existingVault = path.join(userData, 'my-existing-vault');
    fs.mkdirSync(existingVault, { recursive: true });
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
    }, existingVault);
    await stubOnboardingComplete(app);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardOpenExisting).click();

    // handleOpenExistingVault skips the Vault step entirely — Theme is the
    // tail's first screen and its Back is hidden (spec §1.1).
    await expect(page.locator(SELECTOR.screenCustomTheme)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(SELECTOR.customThemeBack)).toHaveCount(0);

    await finishThemeTail(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await lastObPayload(app);
    expect(payload.startMode).toBe('open-existing');
    expect(payload.vaultParentPath).toBe(existingVault);
  });
});

// ─── AC-OB-25: real Obsidian dry-run IPC channel is wired ────────────────────

test.describe('AC-OB-25: dryRunObsidianImport bridge is the real, currently-used channel', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-25-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-25: window.api.dryRunObsidianImport is callable and reaches the real "onboarding:dryRunObsidianImport" channel', async () => {
    // The old spec asserted window.api.importVaultDryRun (channel
    // 'onboarding:import-vault:dry-run') exists — it still does in
    // electron-main/src/ipc.ts, but screen-step-import never calls it (it
    // calls dryRunObsidianImport / 'onboarding:dryRunObsidianImport' instead,
    // per preload.ts:59-60). Asserting the orphaned channel would test dead
    // code; assert the one actually wired to the Import screen instead.
    const hasFn = await page.evaluate(() => typeof (window as unknown as Record<string, Record<string, unknown>>).api?.dryRunObsidianImport === 'function');
    expect(hasFn).toBe(true);

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      (global as Record<string, unknown>).__ob25ChannelHit__ = false;
      ipcMain.handle('onboarding:dryRunObsidianImport', () => {
        (global as Record<string, unknown>).__ob25ChannelHit__ = true;
        return { preview: { markdownCount: 0, attachmentCount: 0, totalFiles: 0, topLevelFolders: [], sampleFiles: [] } };
      });
    });
    await page.evaluate(() => (window as unknown as { api: { dryRunObsidianImport: (p: string, k: string) => Promise<unknown> } }).api.dryRunObsidianImport('/tmp/whatever', 'notes'));
    const hit = await app.evaluate(() => (global as Record<string, unknown>).__ob25ChannelHit__);
    expect(hit).toBe(true);
  });
});
