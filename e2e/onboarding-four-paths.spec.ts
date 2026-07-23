/**
 * onboarding-four-paths.spec.ts — SKY-2639 / SKY-2553 / SKY-8210
 *
 * E2E coverage for AC-OB-01 through AC-OB-25 from the four-path onboarding spec.
 *
 * SKY-8210: this file blanket-skipped citing SKY-6933 ("wizard redesigned to
 * screen-step1/step1b/step2 flow"). That was itself stale — SKY-7593 (M29)
 * redesigned the wizard AGAIN after SKY-6933 was written: the old single
 * "4-card path selector on step1 -> step2 form" model is gone. The current
 * shape (frontend/src/OnboardingWizard.tsx):
 *
 *   screen-step1 (card-sample / card-start-blank / card-import-obsidian /
 *   card-open-existing, plain buttons — no role="radio" radiogroup) ->
 *     - card-start-blank -> screen-custom-location (vault path + name) ->
 *         - "Next" -> screen-custom-template (custom-template-recommended /
 *           custom-template-blank) -> [genre -> theme] -> screen-step3
 *         - "Use a template instead" -> screen-step1b (template grid) ->
 *           screen-step2 (title/author/save-path form) -> [genre -> theme] ->
 *           screen-step3
 *         - "One-click setup" -> [genre -> theme] -> screen-step3
 *     - card-sample -> screen-step1c (genre picker, ~unchanged) -> screen-step3
 *     - card-import-obsidian -> screen-step-import (single screen; dry-run
 *       report renders inline in the same screen once a scan succeeds)
 *     - card-open-existing -> native folder picker -> screen-step3
 *
 * Every AC below was re-pointed at this flow using the same adapter patterns
 * already proven in e2e/onboarding-v2.spec.ts (clickStep1Card / navigateToStep2
 * / finishGenreThemeFlow). Four ACs have no current equivalent and are
 * individually skipped with a reason (see AC-OB-02, AC-OB-06, AC-OB-10,
 * AC-OB-23 below) rather than skipping the whole file.
 *
 * Coverage map (see individual test bodies for how each AC's assertions were
 * adapted to the current UI/IPC shape):
 *   AC-OB-01  Four cards rendered on step1 (Recommended chip on card-sample)
 *   AC-OB-02  SKIPPED — arrow-key radiogroup semantics removed from step1
 *   AC-OB-03  "Recommended" custom template seeds MythosVault v2 + demo content
 *   AC-OB-04  Custom story title (via template flow) reflected in vault folder name
 *   AC-OB-05  "Blank" custom template creates empty Story/Notes Vault dirs
 *   AC-OB-06  SKIPPED — empty title now hard-blocked by validation
 *   AC-OB-07  Obsidian import — invalid folder surfaces a dry-run error
 *   AC-OB-08  Obsidian import — dry-run report shows per-target counts
 *   AC-OB-09  Obsidian import — dry-run error shown; button stays enabled (retry)
 *   AC-OB-10  SKIPPED — restructured-files list has no current UI/IPC equivalent
 *   AC-OB-11  (no test existed in the pre-SKY-8210 file to re-point — see report)
 *   AC-OB-12  Obsidian import — successful commit reaches the app shell
 *   AC-OB-13  Path 4 — genre picker shows exactly 3 cards with accordion
 *   AC-OB-14  Path 4 — selected genre determines sampleGenre in onboarding:complete
 *   AC-OB-15  Path 4 — sample project banner shown once, dismissed permanently
 *   AC-OB-16  ConflictDialog — Open Existing sends startMode:"open-existing"
 *   AC-OB-17  ConflictDialog — Create Alongside uses <parent> 2/ folder
 *   AC-OB-18  onboardingComplete persists across restart (wizard does not re-appear)
 *   AC-OB-19  Dev reset via onboarding:reset clears flag; wizard reappears
 *   AC-OB-20  Path validation debounce — no more than one call per 400ms idle
 *   AC-OB-21  Obsidian import — Back from report pre-fills vault path on return
 *   AC-OB-22  Liquid Neon tokens present on wizard screens (CSS custom properties)
 *   AC-OB-23  SKIPPED — no persistent aria-live region exists on step1/step2 anymore
 *   AC-OB-24  No mic permission prompt during onboarding
 *   AC-OB-25  window.api.importVaultDryRun registered in preload
 *
 * Run: xvfb-run --auto-servernum npx playwright test e2e/onboarding-four-paths.spec.ts --reporter=list
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

const SELECTOR = {
  screenStep1: '[data-testid="screen-step1"]',
  screenStep1b: '[data-testid="screen-step1b"]',
  screenStep1c: '[data-testid="screen-step1c"]',
  screenStep2: '[data-testid="screen-step2"]',
  screenCustomLocation: '[data-testid="screen-custom-location"]',
  screenCustomTemplate: '[data-testid="screen-custom-template"]',
  screenCustomGenre: '[data-testid="screen-custom-genre"]',
  screenCustomTheme: '[data-testid="screen-custom-theme"]',
  screenStepImport: '[data-testid="screen-step-import"]',

  cardSample: '[data-testid="card-sample"]',
  cardStartBlank: '[data-testid="card-start-blank"]',
  cardImportObsidian: '[data-testid="card-import-obsidian"]',
  cardOpenExisting: '[data-testid="card-open-existing"]',

  genreRadiogroup: '[data-testid="genre-radiogroup"]',
  genreStartBtn: '[data-testid="genre-start-btn"]',

  gsTitle: '[data-testid="gs-title-input"]',
  gsSavePath: '[data-testid="gs-save-path"]',
  gsCreateStory: '[data-testid="gs-create-story"]',
  gsConflictDialog: '[data-testid="gs-conflict-dialog"]',
  gsConflictOpenExisting: '[data-testid="gs-conflict-open-existing"]',
  gsConflictCreateAlongside: '[data-testid="gs-conflict-create-alongside"]',
  gsConflictSeeOptions: '[data-testid="gs-conflict-see-options"]',
  gsPathValidationHint: '[data-testid="gs-path-validation-hint"]',
  ariaLiveRegion: '[aria-live="polite"]',
  appMenuBar: '.app-menu-bar',

  sampleBanner: '[data-testid="gs-sample-banner"]',
  sampleBannerDismiss: '[data-testid="gs-sample-banner-dismiss"]',
};

type ValidatePathPayload = string | { path?: string };

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

/**
 * SKY-7593 (M29) adapter — same pattern as e2e/onboarding-v2.spec.ts's
 * clickStep1Card. 'card-blank' stubs a single-item template:list and drives
 * the template picker to screen-step2, since M29 deleted the standalone
 * "Blank Slate" card; that form is now only reachable via "Use a Template".
 */
async function clickStep1Card(page: Page, cardTestId: string, app?: ElectronApplication): Promise<void> {
  await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 12_000 });

  if (cardTestId === 'card-blank') {
    if (!app) throw new Error('clickStep1Card("card-blank", …) requires an ElectronApplication to stub template:list');
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('template:list');
      ipcMain.handle('template:list', () => ({
        templates: [{
          id: 'e2e-4path-step2-stub',
          name: 'E2E Step 2 Stub',
          description: 'Stub template routing e2e coverage through to screen-step2.',
          story: [],
          notes: [],
        }],
      }));
    });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="custom-location-use-template-link"]').click();
    await expect(page.locator(SELECTOR.screenStep1b)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="template-card-e2e-4path-step2-stub"]')).toBeVisible({ timeout: 6_000 });
    await page.locator('[data-testid="template-card-e2e-4path-step2-stub"]').click();
    await page.locator('[data-testid="template-use-btn"]').click();
    return;
  }

  await page.locator(`[data-testid="${cardTestId}"]`).click();
}

/** Navigate from step1 to the step2 form via the (stubbed) template card. */
async function navigateToStep2(app: ElectronApplication, page: Page): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('vault:validate-path');
    ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
  });
  await clickStep1Card(page, 'card-blank', app);
  await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
}

/**
 * Complete the shared genre -> theme mini-flow (M29) from screen-custom-genre,
 * accepting the default chip/card on each step. Every path that reaches
 * screen-step2, clicks the "One-click setup" link, or clicks "Continue" on
 * screen-custom-template funnels through this before the vault-creation IPC
 * call fires on "Open my vault ✦" (custom-theme-finish).
 */
async function finishGenreThemeFlow(page: Page): Promise<void> {
  await expect(page.locator(SELECTOR.screenCustomGenre)).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="custom-genre-continue"]').click();
  await expect(page.locator(SELECTOR.screenCustomTheme)).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="custom-theme-finish"]').click();
}

/** Stub ipcMain to prevent real filesystem side-effects in tests. */
async function stubOnboardingComplete(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('onboarding:complete');
    ipcMain.handle('onboarding:complete', (_evt: unknown, payload: unknown) => {
      (global as Record<string, unknown>).__lastObPayload__ = payload;
      return { ok: true };
    });
  });
}

// ─── AC-OB-01: Four cards rendered on step1 ────────────────────────────────────

test.describe('AC-OB-01: Four-card path selector', () => {
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

  test('AC-OB-01: exactly four path cards rendered; Recommended chip on card-sample', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });

    // M29: the four-card group is a plain `role="group"` container of buttons —
    // not a `role="radio"` radiogroup (that pattern now only exists on the
    // genre/template/theme pickers). Count the actual card buttons instead.
    const cards = page.locator('.gs-cards--four .gs-card');
    await expect(cards).toHaveCount(4);

    const sampleCard = page.locator(SELECTOR.cardSample);
    await expect(sampleCard).toBeVisible();
    await expect(sampleCard.locator('.gs-card__chip')).toHaveText('Recommended');

    await expect(page.locator(SELECTOR.cardStartBlank)).toBeVisible();
    await expect(page.locator(SELECTOR.cardImportObsidian)).toBeVisible();
    await expect(page.locator(SELECTOR.cardOpenExisting)).toBeVisible();
  });
});

// ─── AC-OB-02: Keyboard navigation on path selector — SKIPPED ─────────────────

test.describe('AC-OB-02: Keyboard navigation', () => {
  test('AC-OB-02: Arrow keys cycle focus within radiogroup; Enter activates path', async () => {
    test.skip(
      true,
      'SKY-8210: M29 (SKY-7593) removed the arrow-key radiogroup semantics from the ' +
      'step1 four-card selector. StartingPointCard (frontend/src/OnboardingWizard.tsx:350-374) ' +
      'renders plain <button> elements with only Enter/Space activation — no role="radio", ' +
      'no aria-checked, and the `.gs-cards--four` group div has no onKeyDown handler wired for ' +
      'ArrowUp/ArrowDown (unlike the genre/template/theme pickers, which do use ' +
      'handleGridArrowKeys/handleGenreArrowKeys on a role="radiogroup"). There is no current ' +
      'equivalent to test: cards are navigated with plain Tab, not arrow-key radiogroup cycling.',
    );
  });
});

// ─── AC-OB-03: "Recommended" custom template seeds MythosVault v2 + demo ──────

test.describe('AC-OB-03: Recommended template seeds MythosVault v2 demo content', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  let vaultParent: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-03-'));
    vaultParent = path.join(userData, 'MyVaults');
    fs.mkdirSync(vaultParent, { recursive: true });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-03: Story Vault + Notes Vault created; demo content seeded; mythos.json records seed.mode=default', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="custom-vault-path-input"]').fill(vaultParent);
    const nameInput = page.locator('[data-testid="custom-vault-name-input"]');
    await nameInput.fill('AC-OB-03 Vault');
    // Real (unstubbed) vault:validate-path debounce is 500ms.
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="custom-location-next"]')).toBeEnabled({ timeout: 4_000 });
    await page.locator('[data-testid="custom-location-next"]').click();

    await expect(page.locator(SELECTOR.screenCustomTemplate)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="custom-template-recommended"]').click();
    await page.locator('[data-testid="custom-template-finish"]').click();

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const mythosRoot = path.join(vaultParent, 'AC-OB-03 Vault');
    const storyVault = path.join(mythosRoot, 'Story Vault');
    const notesVault = path.join(mythosRoot, 'Notes Vault');
    expect(fs.existsSync(mythosRoot)).toBe(true);
    expect(fs.existsSync(storyVault)).toBe(true);
    expect(fs.existsSync(notesVault)).toBe(true);

    const mythosJson = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(mythosJson.seed?.mode).toBe('default');

    // Demo content seeded into both vaults (Veynn seed).
    expect(fs.readdirSync(notesVault).length).toBeGreaterThan(0);
    const storyFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) storyFiles.push(full);
      }
    };
    walk(storyVault);
    expect(storyFiles.length).toBeGreaterThan(0);
  });
});

// ─── AC-OB-04: Custom story title reflected in vault folder name ─────────────

test.describe('AC-OB-04: Custom title reflected in vault folder name', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  let vaultParent: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-04-'));
    vaultParent = path.join(userData, 'Vaults04');
    fs.mkdirSync(vaultParent, { recursive: true });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-04: "Dragon\'s Crossing" title used as vault folder name on disk', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });
    // NOTE: deliberately does NOT stub template:list. The onboarding:complete
    // handler's 'template' branch (main.ts) calls the real listTemplates()
    // directly against disk — a stubbed IPC template:list result is invisible
    // to it and produces "Template not found" when the real vault-creation
    // call fires. Using a real always-present bundled template keeps this
    // test's real (unstubbed) disk assertions meaningful.
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 12_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="custom-location-use-template-link"]').click();
    await expect(page.locator(SELECTOR.screenStep1b)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="template-card-bundled:novel-3act"]')).toBeVisible({ timeout: 6_000 });
    await page.locator('[data-testid="template-card-bundled:novel-3act"]').click();
    await page.locator('[data-testid="template-use-btn"]').click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.gsTitle).fill("Dragon's Crossing");
    await page.locator(SELECTOR.gsSavePath).clear();
    await page.locator(SELECTOR.gsSavePath).fill(vaultParent);
    await page.waitForTimeout(600);
    await page.locator(SELECTOR.gsCreateStory).click();
    await finishGenreThemeFlow(page);

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const storyVault = path.join(vaultParent, "Dragon's Crossing", 'Story Vault');
    expect(fs.existsSync(storyVault), "vaultParent/Dragon's Crossing/Story Vault should exist").toBe(true);
  });
});

// ─── AC-OB-05: "Blank" custom template creates empty vault dirs ──────────────

test.describe('AC-OB-05: Blank template creates empty Story/Notes Vault dirs', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  let vaultParent: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-05-'));
    vaultParent = path.join(userData, 'Vaults05');
    fs.mkdirSync(vaultParent, { recursive: true });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-05: blank mode creates Notes Vault with no seeded demo content; mythos.json records seed.mode=blank', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="custom-vault-path-input"]').fill(vaultParent);
    await page.locator('[data-testid="custom-vault-name-input"]').fill('AC-OB-05 Vault');
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="custom-location-next"]')).toBeEnabled({ timeout: 4_000 });
    await page.locator('[data-testid="custom-location-next"]').click();

    await expect(page.locator(SELECTOR.screenCustomTemplate)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="custom-template-blank"]').click();
    await page.locator('[data-testid="custom-template-finish"]').click();

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const mythosRoot = path.join(vaultParent, 'AC-OB-05 Vault');
    const notesVault = path.join(mythosRoot, 'Notes Vault');
    expect(fs.existsSync(notesVault)).toBe(true);
    // NOTE: the app auto-creates a `Sessions/` folder + a "coach" welcome
    // session on first vault load regardless of blank/seeded mode (unrelated
    // to onboarding template choice) — so the Notes Vault is not literally
    // empty. The blank-mode-specific signal is the ABSENCE of Veynn demo
    // content folders (NOTE_DIRS in electron-main/src/mythosFormat/veynnSeed.ts).
    for (const demoDir of ['Worldbuilding', 'Characters', 'Plot & Story']) {
      expect(
        fs.existsSync(path.join(notesVault, demoDir)),
        `blank mode should not seed Notes Vault/${demoDir}/`,
      ).toBe(false);
    }

    const mythosJson = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(mythosJson.seed?.mode).toBe('blank');
  });
});

// ─── AC-OB-06: Empty title — SKIPPED ──────────────────────────────────────────

test.describe('AC-OB-06: Untitled Story fallback', () => {
  test('AC-OB-06: empty title field → scene path contains "Untitled Story"', async () => {
    test.skip(
      true,
      'SKY-8210: validateTitle() (frontend/src/OnboardingWizard.tsx:943-948) now hard-blocks an ' +
      'empty story title on screen-step2 — handleStoryDetailsNext() returns false and never leaves ' +
      'the form, focusing the title input with ERR_EMPTY_TITLE instead of proceeding. No current ' +
      'onboarding path defaults an unset title to "Untitled Story": the only remaining fallback ' +
      '(effectiveStoryTitle in main.ts\'s dead startMode===\'blank\'&&customTemplate branch) is ' +
      'unreachable — the UI always sends startMode:\'start-fresh\' for the custom-template flow. ' +
      'This AC has no current equivalent to test.',
    );
  });
});

// ─── AC-OB-07: Obsidian import — invalid folder shows dry-run error ──────────

test.describe('AC-OB-07: Obsidian import — invalid folder shows dry-run error', () => {
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

  test('AC-OB-07: folder with no .obsidian/ or .md files -> dry-run error; Import/Open stays enabled for retry', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-obsidian-'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        error: "This doesn't look like an Obsidian vault (no .obsidian folder or markdown files found).",
      }));
    }, emptyDir);

    await page.locator('[data-testid="import-obs-notes-browse"]').click();
    await expect(page.locator('[data-testid="import-obs-notes-path"]')).toHaveValue(emptyDir);

    await page.locator('[data-testid="import-action-btn"]').click();

    const error = page.locator('[data-testid="obs-dryrun-error"]');
    await expect(error).toBeVisible({ timeout: 6_000 });
    await expect(error).toContainText("doesn't look like an Obsidian vault");

    // SKY-2993: the submit button stays enabled so the user can retry.
    await expect(page.locator('[data-testid="import-action-btn"]')).toBeEnabled();
    await expect(page.locator('[data-testid="obs-dryrun-report"]')).toHaveCount(0);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-08: Obsidian import — dry-run report shows per-target counts ──────

test.describe('AC-OB-08: Obsidian import — dry-run report display', () => {
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

  test('AC-OB-08: dry-run report shows per-target markdown/attachment/file counts', async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs08-notes-'));
    const storyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs08-story-'));
    fs.mkdirSync(path.join(notesDir, '.obsidian'));
    fs.mkdirSync(path.join(storyDir, '.obsidian'));

    await app.evaluate(({ ipcMain }, dirs) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', (_evt: unknown, payload: { title?: string }) => {
        const title = payload?.title ?? '';
        return { path: title.includes('story') ? dirs.storyDir : dirs.notesDir, cancelled: false };
      });
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', (_evt: unknown, payload: { targetVaultKind?: string }) => {
        const kind = payload?.targetVaultKind;
        return {
          preview: kind === 'notes'
            ? { markdownCount: 42, attachmentCount: 5, totalFiles: 47, topLevelFolders: ['Characters', 'Locations'], sampleFiles: ['Characters/Alice.md'] }
            : { markdownCount: 7, attachmentCount: 1, totalFiles: 8, topLevelFolders: ['Chapters'], sampleFiles: ['Chapters/Ch1.md'] },
        };
      });
    }, { notesDir, storyDir });

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="import-obs-notes-browse"]').click();
    await expect(page.locator('[data-testid="import-obs-notes-path"]')).toHaveValue(notesDir);
    await page.locator('[data-testid="import-obs-story-browse"]').click();
    await expect(page.locator('[data-testid="import-obs-story-path"]')).toHaveValue(storyDir);

    await page.locator('[data-testid="import-action-btn"]').click();

    const report = page.locator('[data-testid="obs-dryrun-report"]');
    await expect(report).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="obs-report-notes"]')).toContainText('42');
    await expect(page.locator('[data-testid="obs-report-story"]')).toContainText('7');
    await expect(page.locator('[data-testid="obs-report-confirm"]')).toBeEnabled();

    fs.rmSync(notesDir, { recursive: true, force: true });
    fs.rmSync(storyDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-09: Obsidian import — dry-run error keeps submit enabled ──────────

test.describe('AC-OB-09: Obsidian import — dry-run error surfaced inline', () => {
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

  // NOTE: SKY-2993 deliberately keeps the "Import / Open" button enabled after
  // a dry-run error so the user can retry without re-picking folders — the old
  // AC-OB-09 assertion ("Import button disabled") is inverted from current
  // design intent (see code comment at OnboardingWizard.tsx:3044-3045).
  test('AC-OB-09: dry-run error shows inline banner with message; Import/Open stays enabled', async () => {
    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-09-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));

    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        error: 'Cannot read vault directory: permission denied',
      }));
    }, obsidianDir);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="import-obs-notes-browse"]').click();
    await expect(page.locator('[data-testid="import-obs-notes-path"]')).toHaveValue(obsidianDir);
    await page.locator('[data-testid="import-action-btn"]').click();

    const error = page.locator('[data-testid="obs-dryrun-error"]');
    await expect(error).toBeVisible({ timeout: 6_000 });
    await expect(error).toContainText('permission denied');
    await expect(page.locator('[data-testid="import-action-btn"]')).toBeEnabled();
    await expect(page.locator('[data-testid="obs-dryrun-report"]')).toHaveCount(0);

    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-10: Restructured files list — SKIPPED ──────────────────────────────

test.describe('AC-OB-10: Restructured files shown in dry-run', () => {
  test('AC-OB-10: restructured section shows before/after list; Import button enabled', async () => {
    test.skip(
      true,
      'SKY-8210: the "restructured" before/after file-path list has no current equivalent. ' +
      'ObsidianImportPreview (electron-main/src/ipc.ts:2388-2394) only carries ' +
      'markdownCount/attachmentCount/totalFiles/topLevelFolders/sampleFiles — no restructured ' +
      'mapping. renamedCount/brokenLinkCount exist as numbers on the dry-run *response* but are ' +
      'never rendered by OnboardingWizard.tsx (grep confirms no "restructured"/"renamedCount"/ ' +
      '"brokenLinkCount" usage in the render tree). This feature was not carried into the ' +
      'SKY-2993 Obsidian import redesign.',
    );
  });
});

// ─── AC-OB-12: Obsidian import — successful commit reaches app shell ─────────
// (AC-OB-11 "name collisions renamed + log file" had no test body in the
//  pre-SKY-8210 file — only its coverage-map comment mentioned it. Nothing to
//  re-point; see final report.)

test.describe('AC-OB-12: Obsidian import — successful commit reaches app shell', () => {
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

  test('AC-OB-12: confirming the dry-run report imports successfully and dismisses the wizard', async () => {
    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-12-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));

    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        preview: { markdownCount: 3, attachmentCount: 0, totalFiles: 3, topLevelFolders: [], sampleFiles: ['a.md', 'b.md', 'c.md'] },
      }));
      ipcMain.removeHandler('onboarding:importObsidianVault');
      ipcMain.handle('onboarding:importObsidianVault', () => ({ ok: true, targetPath: dir }));
    }, obsidianDir);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="import-obs-notes-browse"]').click();
    await page.locator('[data-testid="import-action-btn"]').click();
    await expect(page.locator('[data-testid="obs-dryrun-report"]')).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="obs-report-confirm"]').click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    // Wizard is fully dismissed — no leftover import UI.
    await expect(page.locator(SELECTOR.screenStepImport)).toHaveCount(0);
    await expect(page.locator('[data-testid="import-error-modal"]')).toHaveCount(0);

    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-13: Path 4 — genre picker shows exactly 3 genre cards ─────────────

test.describe('AC-OB-13: Path 4 genre picker — 3 cards with accordions', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-13-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-13: genre picker renders exactly 3 genre cards; each has expandable accordion', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    const radiogroup = page.locator(SELECTOR.genreRadiogroup);
    await expect(radiogroup).toBeVisible();

    const cards = radiogroup.locator('[role="radio"]');
    await expect(cards).toHaveCount(3);

    for (const genre of ['cozy-fantasy', 'sci-fi-noir', 'mystery']) {
      const accordionBtn = page.locator(`[data-testid="genre-accordion-btn-${genre}"]`);
      await expect(accordionBtn).toBeVisible();

      await accordionBtn.click();
      await expect(accordionBtn).toHaveAttribute('aria-expanded', 'true');

      await accordionBtn.click();
      await expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');
    }
  });
});

// ─── AC-OB-14: Path 4 — selected genre determines sample vault contents ────────

test.describe('AC-OB-14: Path 4 genre selection -> sample vault', () => {
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

  test('AC-OB-14: selecting sci-fi-noir genre sends correct sampleGenre in onboarding:complete', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', (_evt: unknown, payload: unknown) => {
        (global as Record<string, unknown>).__ob14Payload__ = payload;
        return { ok: true };
      });
    });

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="genre-card-sci-fi-noir"]').click();
    await expect(page.locator('[data-testid="genre-card-sci-fi-noir"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator(SELECTOR.genreStartBtn)).toBeEnabled();

    await page.locator(SELECTOR.genreStartBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await app.evaluate(() => (global as Record<string, unknown>).__ob14Payload__) as Record<string, unknown>;
    expect(payload?.startMode).toBe('sample');
    expect(payload?.sampleGenre).toBe('sci-fi-noir');
  });
});

// ─── AC-OB-15: Path 4 — sample banner shown once, dismissed permanently ────────

test.describe('AC-OB-15: Path 4 sample banner dismissed permanently', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-15-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-15: sample banner visible after Path 4 completion; dismissing hides it permanently', async () => {
    await stubOnboardingComplete(app);
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="genre-card-cozy-fantasy"]').click();
    await page.locator(SELECTOR.genreStartBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    await expect(page.locator(SELECTOR.sampleBanner)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(SELECTOR.sampleBanner)).toContainText(/sample project/i);

    // Dismiss persists via the real (unstubbed) settings:set IPC.
    await page.locator(SELECTOR.sampleBannerDismiss).click();
    await expect(page.locator(SELECTOR.sampleBanner)).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator(SELECTOR.sampleBanner)).toHaveCount(0);
  });
});

// ─── AC-OB-16: ConflictDialog — Open Existing ────────────────────────────────

test.describe('AC-OB-16: ConflictDialog open-existing sends correct startMode', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-16-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await navigateToStep2(app, page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-16: ConflictDialog open-existing sends startMode:"open-existing"', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const p = typeof payload === 'string' ? payload : payload.path ?? '';
        if (p.includes('manifest.json')) return { exists: true, isEmpty: false, writable: true };
        return { exists: true, isEmpty: false, writable: true };
      });
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', (_evt: unknown, pl: unknown) => {
        (global as Record<string, unknown>).__ob16Payload__ = pl;
        return { ok: true };
      });
    });

    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'existing-vault'));

    await expect(page.locator(SELECTOR.gsPathValidationHint)).toBeVisible({ timeout: 1500 });
    await page.locator(SELECTOR.gsConflictSeeOptions).click();
    await expect(page.locator(SELECTOR.gsConflictDialog)).toBeVisible({ timeout: 4_000 });

    await page.locator(SELECTOR.gsConflictOpenExisting).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await app.evaluate(() => (global as Record<string, unknown>).__ob16Payload__) as Record<string, unknown>;
    expect(payload?.startMode).toBe('open-existing');
  });
});

// ─── AC-OB-17: ConflictDialog — Create Alongside ─────────────────────────────

test.describe('AC-OB-17: ConflictDialog create-alongside uses <parent> 2/', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-17-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await navigateToStep2(app, page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-17: create-alongside pre-fills <parentFolder> 2/ then proceeds through the create flow', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const p = typeof payload === 'string' ? payload : payload.path ?? '';
        // Only the manifest.json-suffixed probe should report a conflict —
        // validateStoryDetails() re-uses this same channel to check the base
        // save path AND the storyTitle-suffixed path for a *different*
        // pre-existing-folder conflict; returning exists:true unconditionally
        // (as AC-OB-16 above does, harmlessly, since it never reaches
        // validateStoryDetails) makes that second check falsely block
        // "Create Story" with ERR_TITLE_EXISTS here.
        if (p.includes('manifest.json')) return { exists: true, isEmpty: false, writable: true };
        return { exists: false, isEmpty: true, writable: true };
      });
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', (_evt: unknown, pl: unknown) => {
        (global as Record<string, unknown>).__ob17Payload__ = pl;
        return { ok: true };
      });
    });

    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'existing-vault'));

    await expect(page.locator(SELECTOR.gsPathValidationHint)).toBeVisible({ timeout: 1500 });
    await page.locator(SELECTOR.gsConflictSeeOptions).click();
    await expect(page.locator(SELECTOR.gsConflictDialog)).toBeVisible({ timeout: 4_000 });

    await page.locator(SELECTOR.gsConflictCreateAlongside).click();
    await expect(page.locator(SELECTOR.gsConflictDialog)).toHaveCount(0);

    // create-alongside only pre-fills the path; screen-step2's own "Create
    // Story" -> genre -> theme funnel still has to run to fire the completion
    // IPC call (M29 — see finishGenreThemeFlow doc comment above).
    await page.locator(SELECTOR.gsTitle).fill('AC-OB-17 Story');
    await page.locator(SELECTOR.gsCreateStory).click();
    await finishGenreThemeFlow(page);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    const payload = await app.evaluate(() => (global as Record<string, unknown>).__ob17Payload__) as Record<string, unknown>;
    expect(String(payload?.vaultParentPath ?? '')).toMatch(/ 2$/);
  });
});

/**
 * seedSettings({onboardingComplete:true}) alone is not enough to reach the
 * shell — with no vaultRoot configured, DesktopShell renders a "Vault not
 * found" recovery screen instead of `.app-menu-bar` (defaultVaultRoot()
 * points at a directory that was never created). Drive a real (unstubbed)
 * "One-click setup" completion instead, which both marks onboardingComplete
 * and writes a real vault + vault-settings.json to `userData`, then close —
 * leaving `userData` in the same on-disk state a real prior run would.
 */
async function completeQuickStartOnboarding(userData: string): Promise<void> {
  const app = await launchFreshApp(userData);
  const page = await firstWindow(app);
  await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
  await page.locator(SELECTOR.cardStartBlank).click();
  await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="custom-location-quick-start-link"]').click();
  await finishGenreThemeFlow(page);
  await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });
  await app.close().catch(() => {});
}

/**
 * Same idea as completeQuickStartOnboarding, but via the "Use a template"
 * flow instead of "One-click setup". Quick Start/Start Fresh create a
 * MythosVault v2 (mythos.json) — and SETTINGS_GET (main.ts) has an M29
 * marker guard that force-sets onboardingComplete back to true on next boot
 * whenever mythos.json is found next to the configured vault root, *even
 * after onboarding:reset*, by design ("never boot into the wizard for [a
 * configured v2 vault]"). AC-OB-19 needs a completed vault that ISN'T v2 so
 * a reset can actually be observed — the template flow scaffolds a legacy
 * (manifest.json-based) vault with no mythos.json.
 */
async function completeTemplateOnboarding(userData: string): Promise<void> {
  const vaultParent = path.join(userData, 'DefaultVault');
  fs.mkdirSync(vaultParent, { recursive: true });
  const app = await launchFreshApp(userData);
  const page = await firstWindow(app);
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('vault:validate-path');
    ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
  });
  await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
  await page.locator(SELECTOR.cardStartBlank).click();
  await expect(page.locator(SELECTOR.screenCustomLocation)).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="custom-location-use-template-link"]').click();
  await expect(page.locator(SELECTOR.screenStep1b)).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="template-card-bundled:novel-3act"]').click();
  await page.locator('[data-testid="template-use-btn"]').click();
  await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.gsTitle).fill('AC-OB-19 Story');
  await page.locator(SELECTOR.gsSavePath).clear();
  await page.locator(SELECTOR.gsSavePath).fill(vaultParent);
  await page.waitForTimeout(600);
  await page.locator(SELECTOR.gsCreateStory).click();
  await finishGenreThemeFlow(page);
  await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });
  await app.close().catch(() => {});
}

// ─── AC-OB-18: onboardingComplete persists across restart ─────────────────────

test.describe('AC-OB-18: onboardingComplete persists across app restart', () => {
  let userData: string;
  let app: ElectronApplication;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-18-'));
    await completeQuickStartOnboarding(userData);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-18: launching with onboardingComplete:true skips wizard; app opens to main shell', async () => {
    app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    await expect(page.locator(SELECTOR.screenStep1)).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });
});

// ─── AC-OB-19: Dev reset via onboarding:reset ─────────────────────────────────

test.describe('AC-OB-19: onboarding:reset clears flag; wizard reappears', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-19-'));
    await completeTemplateOnboarding(userData);
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-19: calling onboarding:reset then restarting app shows wizard again', async () => {
    await page.evaluate(async () => {
      if (window.api?.onboardingReset) {
        await window.api.onboardingReset();
      }
    });

    await app.close().catch(() => {});

    app = await launchFreshApp(userData);
    page = await firstWindow(app);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 12_000 });
  });
});

// ─── AC-OB-20: Path validation debounce ──────────────────────────────────────

test.describe('AC-OB-20: Path validation fires at most once per 400ms idle', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-20-'));
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

    await clickStep1Card(page, 'card-blank', app);
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-20: rapid keystrokes produce ≤2 validate calls per 400ms idle window', async () => {
    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();

    const typingText = path.join(userData, 'my-vault');
    await pathInput.pressSequentially(typingText, { delay: 30 });

    await page.waitForTimeout(600);

    const callCount = await app.evaluate(
      () => (global as Record<string, unknown>).__validateCallCount__,
    ) as number;

    expect(callCount).toBeLessThanOrEqual(2);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── AC-OB-21: Obsidian import — Back from report pre-fills vault path ────────

test.describe('AC-OB-21: Obsidian import Back from report returns with pre-filled path', () => {
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

  test('AC-OB-21: clicking Back on the dry-run report returns to the import form with the selected path pre-filled', async () => {
    const selectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-21-'));
    fs.mkdirSync(path.join(selectedDir, '.obsidian'));

    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        preview: { markdownCount: 2, attachmentCount: 0, totalFiles: 2, topLevelFolders: [], sampleFiles: ['a.md', 'b.md'] },
      }));
    }, selectedDir);

    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenStepImport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="import-obs-notes-browse"]').click();
    await expect(page.locator('[data-testid="import-obs-notes-path"]')).toHaveValue(selectedDir);
    await page.locator('[data-testid="import-action-btn"]').click();
    await expect(page.locator('[data-testid="obs-dryrun-report"]')).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="obs-report-back"]').click();
    await expect(page.locator('[data-testid="obs-dryrun-report"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="import-section-obs"]')).toBeVisible({ timeout: 5_000 });

    const val = await page.locator('[data-testid="import-obs-notes-path"]').inputValue();
    expect(val).toBe(selectedDir);

    fs.rmSync(selectedDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-22: Liquid Neon tokens present on wizard screens ───────────────────

test.describe('AC-OB-22: Liquid Neon CSS tokens on wizard screens', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-22-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-22: wizard root element has --accent CSS custom property (Liquid Neon token)', async () => {
    await expect(page.locator(SELECTOR.screenStep1)).toBeVisible({ timeout: 15_000 });

    const hasAccentToken = await page.evaluate(() => {
      const root = document.documentElement;
      const accent = getComputedStyle(root).getPropertyValue('--accent');
      return accent.trim().length > 0;
    });
    expect(hasAccentToken, '--accent Liquid Neon token must be defined on :root').toBe(true);
  });
});

// ─── AC-OB-23: aria-live error region always in DOM — SKIPPED ────────────────

test.describe('AC-OB-23: aria-live region always present on wizard', () => {
  test('AC-OB-23: aria-live="polite" region is in the DOM on screen-step1 (idle state)', async () => {
    test.skip(
      true,
      'SKY-8210: there is no longer a persistent aria-live region on screen-step1 or ' +
      'screen-step2 — grep of frontend/src/OnboardingWizard.tsx confirms aria-live="polite" ' +
      'is only used on screen-step1b (template-announcement) and screen-step1c ' +
      '(genre-announcement), and the shared error/toast surface (components/Toast/Toast.tsx) ' +
      'returns null (unmounts entirely) whenever there is no active message, so it is not ' +
      '"always in DOM" either. AC-OB-23 specifically asserted an idle-state region on ' +
      'screen-step1 that persists into screen-step2 — that region does not exist on either ' +
      'screen in the current design, so this is not a selector move, it is a removed pattern.',
    );
  });
});

// ─── AC-OB-24: No mic permission prompt during onboarding ─────────────────────

test.describe('AC-OB-24: No microphone permission prompt during onboarding', () => {
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

  test('AC-OB-24: navigator.mediaDevices.getUserMedia is not called during wizard display', async () => {
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
    expect(micRequested, 'getUserMedia(audio) must NOT be called during onboarding').toBe(false);
  });
});

// ─── AC-OB-25: onboarding:import-vault:dry-run IPC channel registered ─────────

test.describe('AC-OB-25: importVaultDryRun channel in preload bridge', () => {
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

  test('AC-OB-25: window.api.importVaultDryRun is a callable function', async () => {
    const hasChannel = await page.evaluate(() => {
      const api = (window as unknown as Record<string, Record<string, unknown>>).api;
      return typeof api?.importVaultDryRun === 'function';
    });
    expect(hasChannel, 'window.api.importVaultDryRun must be a function registered in preload').toBe(true);
  });
});
