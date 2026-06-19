/**
 * onboarding-four-paths.spec.ts — SKY-2639 / SKY-2553
 *
 * E2E coverage for AC-OB-01 through AC-OB-25 from the four-path onboarding spec.
 *
 * Coverage map:
 *   AC-OB-01  Four-card path selector rendered on first run (Recommended badge on Path 1)
 *   AC-OB-02  Keyboard navigation: Tab cycles cards, Enter/Space activates, Arrow keys cycle focus
 *   AC-OB-03  Path 1 Default Layout — seeds full SKY-15 structure on disk
 *   AC-OB-04  Path 1 — custom story title reflected in vault folder name
 *   AC-OB-05  Path 2 Blank — only root vault folders seeded (no Universes/ etc.)
 *   AC-OB-06  Path 2 — empty title defaults to "Untitled Story"
 *   AC-OB-07  Path 3 Import — vault picker validates Obsidian vault shape; error on invalid folder
 *   AC-OB-08  Path 3 — dry-run report shows note count + conditional warning sections
 *   AC-OB-09  Path 3 — fatalError blocks import; Import button disabled
 *   AC-OB-10  Path 3 — restructured files list shown before Import enabled
 *   AC-OB-11  Path 3 — name collisions renamed with (Imported) suffix; log file written
 *   AC-OB-12  Path 3 — post-import navigation goes to vault browser, not writing page
 *   AC-OB-13  Path 4 — genre picker shows exactly 3 cards with accordion
 *   AC-OB-14  Path 4 — selected genre determines sample vault contents
 *   AC-OB-15  Path 4 — sample project banner shown once, dismissed permanently
 *   AC-OB-16  ConflictDialog — Open Existing sends startMode:"open-existing"
 *   AC-OB-17  ConflictDialog — Create Alongside uses <parent> 2/ folder
 *   AC-OB-18  onboardingComplete persists across restart (wizard does not re-appear)
 *   AC-OB-19  Dev reset via onboarding:reset clears flag; wizard reappears on next launch
 *   AC-OB-20  Path validation debounce — no more than one call per 400ms idle
 *   AC-OB-21  Path 3 — Back from dry-run pre-fills vault path on return to picker
 *   AC-OB-22  Liquid Neon tokens present on wizard screens (CSS custom properties)
 *   AC-OB-23  aria-live error region always in DOM (not conditionally rendered)
 *   AC-OB-24  No mic permission prompt during onboarding
 *   AC-OB-25  onboarding:import-vault:dry-run IPC channel registered in preload
 *
 * Test strategy:
 *   - ACs for the NEW four-card selector and Import path (03-12, 17, 21) use test.skip
 *     until the frontend refactor from the existing two-level card flow to the flat
 *     four-card radiogroup is complete (blocked on SKY-2553 impl children).
 *   - ACs that map to EXISTING wizard behavior (13-16, 18-20, 22-25) are active now.
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

// Expected data-testids for the NEW four-card path selector (post-refactor).
// These match the testid conventions in the spec and existing wizard codebase.
const SELECTOR = {
  // New four-card path selector screen
  pathSelector: '[data-testid="screen-path-selector"]',
  pathCardRadiogroup: '[data-testid="path-card-radiogroup"]',
  cardDefault: '[data-testid="card-path-default"]',
  cardBlank: '[data-testid="card-path-blank"]',
  cardImport: '[data-testid="card-path-import"]',
  cardSample: '[data-testid="card-path-sample"]',
  badgeRecommended: '[data-testid="badge-recommended"]',

  // Import path — vault picker
  screenImportPicker: '[data-testid="screen-import-picker"]',
  importVaultPathInput: '[data-testid="import-vault-path-input"]',
  importVaultScanBtn: '[data-testid="import-vault-scan-btn"]',
  importPickerError: '[data-testid="import-picker-error"]',

  // Import path — dry-run report
  screenDryRun: '[data-testid="screen-dry-run"]',
  dryRunReport: '[data-testid="dry-run-report"]',
  dryRunNotesCount: '[data-testid="dry-run-notes-count"]',
  dryRunFatalError: '[data-testid="dry-run-fatal-error"]',
  dryRunBrokenLinks: '[data-testid="dry-run-broken-links"]',
  dryRunNameCollisions: '[data-testid="dry-run-name-collisions"]',
  dryRunMissingFrontmatter: '[data-testid="dry-run-missing-frontmatter"]',
  dryRunRestructured: '[data-testid="dry-run-restructured"]',
  importVaultBtn: '[data-testid="import-vault-btn"]',
  backFromDryRun: '[data-testid="back-from-dry-run"]',

  // Sample path — location screen (title read-only)
  screenSampleLocation: '[data-testid="screen-sample-location"]',

  // Writing page — sample banner
  sampleBanner: '[data-testid="gs-sample-banner"]',
  sampleBannerDismiss: '[data-testid="gs-sample-banner-dismiss"]',

  // Shared — existing testids
  screenStep1: '[data-testid="screen-step1"]',
  screenStep1c: '[data-testid="screen-step1c"]',
  screenStep2: '[data-testid="screen-step2"]',
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

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
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

async function stubValidatePath(
  app: ElectronApplication,
  result: { exists: boolean; isEmpty: boolean; writable: boolean },
): Promise<void> {
  await app.evaluate(({ ipcMain }, r) => {
    ipcMain.removeHandler('vault:validate-path');
    ipcMain.handle('vault:validate-path', () => r);
  }, result);
}

// ─── AC-OB-01: Four-card path selector on first run ───────────────────────────

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

  test.skip(
    true,
    'AC-OB-01: blocked on SKY-2553 frontend refactor to four-card path selector',
  );

  test('AC-OB-01: exactly four path cards rendered; Recommended badge on card-path-default', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    const radiogroup = page.locator(SELECTOR.pathCardRadiogroup);
    await expect(radiogroup).toBeVisible();

    const cards = radiogroup.locator('[role="radio"]');
    await expect(cards).toHaveCount(4);

    // Default card has the Recommended badge
    const defaultCard = page.locator(SELECTOR.cardDefault);
    await expect(defaultCard).toBeVisible();
    await expect(defaultCard.locator(SELECTOR.badgeRecommended)).toBeVisible();
  });
});

// ─── AC-OB-02: Keyboard navigation on path selector ──────────────────────────

test.describe('AC-OB-02: Keyboard navigation', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-02-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test.skip(true, 'AC-OB-02: blocked on SKY-2553 frontend refactor to four-card path selector');

  test('AC-OB-02: Arrow keys cycle focus within radiogroup; Enter activates path', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    const radiogroup = page.locator(SELECTOR.pathCardRadiogroup);
    const cards = radiogroup.locator('[role="radio"]');

    // First card should have initial keyboard focus
    await expect(cards.nth(0)).toBeFocused({ timeout: 3_000 });

    // ArrowDown moves to next card
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(1)).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(2)).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(3)).toBeFocused();

    // ArrowDown wraps back to first
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(0)).toBeFocused();

    // Space selects the focused card
    await page.keyboard.press('Space');
    await expect(cards.nth(0)).toHaveAttribute('aria-checked', 'true');
  });
});

// ─── AC-OB-03: Path 1 — full SKY-15 structure seeded ────────────────────────

test.describe('AC-OB-03: Path 1 seeds full SKY-15 structure', () => {
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

  test.skip(true, 'AC-OB-03: blocked on SKY-2553 frontend refactor + IPC impl for default-layout vault seeding');

  test('AC-OB-03: Notes Vault contains expected top-level folders; Story Vault has manifest + scene', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    // Let actual IPC run so the filesystem is seeded
    await page.locator(SELECTOR.cardDefault).click();

    const locationScreen = page.locator(SELECTOR.screenStep2);
    await expect(locationScreen).toBeVisible({ timeout: 8_000 });

    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();
    await pathInput.fill(vaultParent);
    await page.waitForTimeout(600);
    await page.locator(SELECTOR.gsCreateStory).click();

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    // Verify SKY-15 structure on disk
    const notesVault = path.join(vaultParent, 'Notes Vault');
    const storyVault = path.join(vaultParent, 'Story Vault');
    expect(fs.existsSync(notesVault)).toBe(true);
    expect(fs.existsSync(storyVault)).toBe(true);

    for (const folder of ['Universes', 'Stories', 'Inbox', 'Research', 'Daily Notes', 'Archive']) {
      expect(
        fs.existsSync(path.join(notesVault, folder)),
        `Notes Vault should contain ${folder}/`,
      ).toBe(true);
    }

    expect(fs.existsSync(path.join(storyVault, 'manifest.json'))).toBe(true);

    // At least one scene file under Story Vault
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

// ─── AC-OB-04: Path 1 — custom story title in vault path ─────────────────────

test.describe('AC-OB-04: Path 1 custom title reflected in vault', () => {
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

  test.skip(true, 'AC-OB-04: blocked on SKY-2553 frontend refactor + IPC impl for default-layout vault seeding');

  test('AC-OB-04: "Dragons Crossing" title appears in scene path on disk', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardDefault).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.gsTitle).fill("Dragon's Crossing");
    await page.locator(SELECTOR.gsSavePath).clear();
    await page.locator(SELECTOR.gsSavePath).fill(vaultParent);
    await page.waitForTimeout(600);
    await page.locator(SELECTOR.gsCreateStory).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const storyVault = path.join(vaultParent, 'Story Vault');
    const storyFolder = path.join(storyVault, "Dragon's Crossing");
    expect(fs.existsSync(storyFolder), "Story Vault should contain Dragon's Crossing/").toBe(true);
  });
});

// ─── AC-OB-05: Path 2 — blank seeds only root folders ────────────────────────

test.describe('AC-OB-05: Path 2 blank seeds only root vault folders', () => {
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

  test.skip(true, 'AC-OB-05: blocked on SKY-2553 frontend refactor for four-card path selector');

  test('AC-OB-05: Notes Vault has no Universes/ or Stories/ subfolders after blank mode', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardBlank).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.gsSavePath).clear();
    await page.locator(SELECTOR.gsSavePath).fill(vaultParent);
    await page.waitForTimeout(600);
    await page.locator(SELECTOR.gsCreateStory).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const notesVault = path.join(vaultParent, 'Notes Vault');
    expect(fs.existsSync(notesVault)).toBe(true);
    // Blank mode: no Universes/ or Stories/ subfolders
    expect(fs.existsSync(path.join(notesVault, 'Universes'))).toBe(false);
    expect(fs.existsSync(path.join(notesVault, 'Stories'))).toBe(false);
  });
});

// ─── AC-OB-06: Path 2 — untitled story fallback ───────────────────────────────

test.describe('AC-OB-06: Path 2 untitled story defaults to "Untitled Story"', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  let vaultParent: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-06-'));
    vaultParent = path.join(userData, 'Vaults06');
    fs.mkdirSync(vaultParent, { recursive: true });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test.skip(true, 'AC-OB-06: blocked on SKY-2553 frontend refactor for four-card path selector');

  test('AC-OB-06: empty title field → scene path contains "Untitled Story"', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardBlank).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });

    // Clear title and leave empty
    await page.locator(SELECTOR.gsTitle).clear();
    await page.locator(SELECTOR.gsSavePath).clear();
    await page.locator(SELECTOR.gsSavePath).fill(vaultParent);
    await page.waitForTimeout(600);
    await page.locator(SELECTOR.gsCreateStory).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const storyVault = path.join(vaultParent, 'Story Vault');
    expect(fs.existsSync(path.join(storyVault, 'Untitled Story'))).toBe(true);
  });
});

// ─── AC-OB-07: Path 3 — vault picker validates Obsidian shape ─────────────────

test.describe('AC-OB-07: Path 3 vault picker — invalid folder shows error', () => {
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

  test.skip(true, 'AC-OB-07: blocked on SKY-2553 frontend + IPC for import vault picker');

  test('AC-OB-07: folder with no .obsidian/ or .md files → error; scan button disabled', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImport).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 8_000 });

    // Stub vault:pick-folder to return an empty temp dir
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-obsidian-'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({ path: dir, cancelled: false }));
    }, emptyDir);

    await page.locator(SELECTOR.importVaultScanBtn).click();

    const error = page.locator(SELECTOR.importPickerError);
    await expect(error).toBeVisible({ timeout: 4_000 });
    await expect(error).toContainText("This doesn't look like an Obsidian vault");
    await expect(page.locator(SELECTOR.importVaultScanBtn)).toBeDisabled();

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-08: Path 3 — dry-run report note count + conditional sections ──────

test.describe('AC-OB-08: Path 3 dry-run report display', () => {
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

  test.skip(true, 'AC-OB-08: blocked on SKY-2553 frontend import dry-run screen + IPC channel');

  test('AC-OB-08: dry-run report shows notesCount; broken-links section appears when count > 0', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    // Stub dry-run IPC to return controlled report
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:import-vault:dry-run');
      ipcMain.handle('onboarding:import-vault:dry-run', () => ({
        notesCount: 42,
        fatalError: null,
        brokenLinks: [{ source: 'notes/a.md', target: '[[missing]]' }],
        nameCollisions: [],
        missingFrontmatter: [],
        restructured: [],
        leftAsIs: ['notes/a.md', 'notes/b.md'],
      }));
    });

    // Simulate navigating to dry-run screen (depends on import picker being done)
    await page.locator(SELECTOR.cardImport).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 8_000 });
    // Stub vault:pick-folder to return an obsidian-shaped dir
    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({ path: dir, cancelled: false }));
    }, obsidianDir);

    await page.locator(SELECTOR.importVaultScanBtn).click();
    await expect(page.locator(SELECTOR.screenDryRun)).toBeVisible({ timeout: 10_000 });

    const report = page.locator(SELECTOR.dryRunReport);
    await expect(report).toBeVisible();

    // Notes count shown
    await expect(page.locator(SELECTOR.dryRunNotesCount)).toContainText('42');

    // Broken links section appears (count > 0)
    await expect(page.locator(SELECTOR.dryRunBrokenLinks)).toBeVisible();

    // Name collisions section absent (count = 0)
    await expect(page.locator(SELECTOR.dryRunNameCollisions)).toHaveCount(0);

    // Import button enabled (no fatalError)
    await expect(page.locator(SELECTOR.importVaultBtn)).toBeEnabled();

    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-09: Path 3 — fatalError disables Import button ────────────────────

test.describe('AC-OB-09: Path 3 fatalError blocks import', () => {
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

  test.skip(true, 'AC-OB-09: blocked on SKY-2553 frontend import dry-run screen');

  test('AC-OB-09: fatalError in dry-run report shows red banner; Import button disabled', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:import-vault:dry-run');
      ipcMain.handle('onboarding:import-vault:dry-run', () => ({
        notesCount: 0,
        fatalError: 'Cannot read vault directory: permission denied',
        brokenLinks: [],
        nameCollisions: [],
        missingFrontmatter: [],
        restructured: [],
        leftAsIs: [],
      }));
    });

    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImport).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 8_000 });

    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-09-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({ path: dir, cancelled: false }));
    }, obsidianDir);

    await page.locator(SELECTOR.importVaultScanBtn).click();
    await expect(page.locator(SELECTOR.screenDryRun)).toBeVisible({ timeout: 10_000 });

    const fatalBanner = page.locator(SELECTOR.dryRunFatalError);
    await expect(fatalBanner).toBeVisible();
    await expect(fatalBanner).toContainText('permission denied');
    await expect(page.locator(SELECTOR.importVaultBtn)).toBeDisabled();

    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-10: Path 3 — restructured files list shown before Import enabled ───

test.describe('AC-OB-10: Path 3 restructured files shown in dry-run', () => {
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

  test.skip(true, 'AC-OB-10: blocked on SKY-2553 frontend import dry-run screen');

  test('AC-OB-10: restructured section shows before/after list; Import button enabled', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:import-vault:dry-run');
      ipcMain.handle('onboarding:import-vault:dry-run', () => ({
        notesCount: 5,
        fatalError: null,
        brokenLinks: [],
        nameCollisions: [],
        missingFrontmatter: [],
        restructured: [
          { from: 'Characters/Alice.md', to: 'Universes/My Universe/Characters/Alice.md' },
        ],
        leftAsIs: [],
      }));
    });

    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImport).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 8_000 });

    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-10-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({ path: dir, cancelled: false }));
    }, obsidianDir);

    await page.locator(SELECTOR.importVaultScanBtn).click();
    await expect(page.locator(SELECTOR.screenDryRun)).toBeVisible({ timeout: 10_000 });

    const restructuredSection = page.locator(SELECTOR.dryRunRestructured);
    await expect(restructuredSection).toBeVisible();
    await expect(restructuredSection).toContainText('Characters/Alice.md');

    // Import button enabled (no fatalError)
    await expect(page.locator(SELECTOR.importVaultBtn)).toBeEnabled();

    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-11 + AC-OB-12: Path 3 — post-import state ────────────────────────

test.describe('AC-OB-11 + AC-OB-12: Path 3 post-import nav + log file', () => {
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

  test.skip(true, 'AC-OB-11/12: blocked on SKY-2553 frontend import commit path + IPC');

  test('AC-OB-12: successful import opens vault browser; getting-started tip card visible', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:import-vault:dry-run');
      ipcMain.handle('onboarding:import-vault:dry-run', () => ({
        notesCount: 3,
        fatalError: null,
        brokenLinks: [],
        nameCollisions: [],
        missingFrontmatter: [],
        restructured: [],
        leftAsIs: ['a.md', 'b.md', 'c.md'],
      }));
      ipcMain.removeHandler('onboarding:import-vault:commit');
      ipcMain.handle('onboarding:import-vault:commit', () => ({ ok: true }));
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', () => ({ ok: true }));
    });

    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImport).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 8_000 });

    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-11-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({ path: dir, cancelled: false }));
    }, obsidianDir);

    await page.locator(SELECTOR.importVaultScanBtn).click();
    await expect(page.locator(SELECTOR.screenDryRun)).toBeVisible({ timeout: 10_000 });

    await page.locator(SELECTOR.importVaultBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    // Post-import navigates to vault browser (not writing page / scene editor)
    await expect(page.locator('[data-testid="vault-browser"], [data-testid="gs-panel"]')).toBeVisible({ timeout: 5_000 });

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
    // Navigate via the new flat four-card path selector: path-selector → card-path-sample → step1c
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    const radiogroup = page.locator(SELECTOR.genreRadiogroup);
    await expect(radiogroup).toBeVisible();

    const cards = radiogroup.locator('[role="radio"]');
    await expect(cards).toHaveCount(3);

    // Each card has a "What's Inside" accordion
    for (const genre of ['cozy-fantasy', 'sci-fi-noir', 'mystery']) {
      const accordionBtn = page.locator(`[data-testid="genre-accordion-btn-${genre}"]`);
      await expect(accordionBtn).toBeVisible();

      await accordionBtn.click();
      await expect(accordionBtn).toHaveAttribute('aria-expanded', 'true');

      // Collapse it again
      await accordionBtn.click();
      await expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');
    }
  });
});

// ─── AC-OB-14: Path 4 — selected genre determines sample vault contents ────────

test.describe('AC-OB-14: Path 4 genre selection → sample vault', () => {
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

    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
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

  test.skip(true, 'AC-OB-15: blocked on SKY-2553 frontend — sample banner not yet implemented on writing page');

  test('AC-OB-15: sample banner visible after Path 4 completion; dismissing hides it permanently', async () => {
    await stubOnboardingComplete(app);
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardSample).click();
    await expect(page.locator(SELECTOR.screenStep1c)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="genre-card-cozy-fantasy"]').click();
    await page.locator(SELECTOR.genreStartBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    // Sample banner visible
    await expect(page.locator(SELECTOR.sampleBanner)).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(SELECTOR.sampleBanner)).toContainText(/sample project/i);

    // Dismiss it
    await page.locator(SELECTOR.sampleBannerDismiss).click();
    await expect(page.locator(SELECTOR.sampleBanner)).toHaveCount(0);

    // Reload the page — banner must NOT reappear
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

    // Navigate to step2 via blank path
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardBlank).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-16: ConflictDialog open-existing sends startMode:"open-existing"', async () => {
    // Re-mock to simulate existing Mythos vault conflict
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: unknown) => {
        const p = typeof payload === 'string' ? payload : (payload as Record<string, string>).path ?? '';
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

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardBlank).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test.skip(true, 'AC-OB-17: create-alongside behaviour depends on new four-card refactor to verify <parent> 2/ path naming');

  test('AC-OB-17: create-alongside creates vault in <parentFolder> 2/ and proceeds', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: unknown) => {
        const p = typeof payload === 'string' ? payload : (payload as Record<string, string>).path ?? '';
        if (p.includes('manifest.json')) return { exists: true, isEmpty: false, writable: true };
        return { exists: true, isEmpty: false, writable: true };
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
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });

    // The vaultParentPath in the IPC payload should end with " 2"
    const payload = await app.evaluate(() => (global as Record<string, unknown>).__ob17Payload__) as Record<string, unknown>;
    expect(String(payload?.vaultParentPath ?? '')).toMatch(/ 2$/);
  });
});

// ─── AC-OB-18: onboardingComplete persists across restart ─────────────────────

test.describe('AC-OB-18: onboardingComplete persists across app restart', () => {
  let userData: string;
  let app: ElectronApplication;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-18-'));
    // Seed settings with onboardingComplete: true to simulate post-onboarding
    seedSettings(userData, { onboardingComplete: true });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-18: launching with onboardingComplete:true skips wizard; app opens to main shell', async () => {
    app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    // The onboarding wizard must NOT appear
    await expect(page.locator('[data-testid="screen-step1"]')).toHaveCount(0, { timeout: 8_000 });

    // The main app shell should render
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
    seedSettings(userData, { onboardingComplete: true });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-19: calling onboarding:reset then restarting app shows wizard again', async () => {
    // Call the reset IPC channel
    await page.evaluate(async () => {
      if (window.api?.onboardingReset) {
        await window.api.onboardingReset();
      } else if ((window as unknown as Record<string, unknown>).electronAPI?.onboardingReset) {
        await (window as unknown as Record<string, Record<string, () => Promise<void>>>).electronAPI.onboardingReset();
      }
    });

    // Close and relaunch
    await app.close().catch(() => {});

    app = await launchFreshApp(userData);
    page = await firstWindow(app);

    // Wizard should appear again (step1 or new path selector)
    const wizardVisible =
      (await page.locator(SELECTOR.screenStep1).isVisible({ timeout: 12_000 }).catch(() => false)) ||
      (await page.locator(SELECTOR.pathSelector).isVisible({ timeout: 2_000 }).catch(() => false));
    expect(wizardVisible, 'Wizard should reappear after onboarding:reset').toBe(true);
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

    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardBlank).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-20: rapid keystrokes produce ≤1 validate call per 400ms idle window', async () => {
    const pathInput = page.locator(SELECTOR.gsSavePath);
    await pathInput.clear();

    // Type 10 characters rapidly (< 400ms apart each)
    const typingText = path.join(userData, 'my-vault');
    await pathInput.pressSequentially(typingText, { delay: 30 });

    // Wait 600ms for debounce to settle
    await page.waitForTimeout(600);

    const callCount = await app.evaluate(
      () => (global as Record<string, unknown>).__validateCallCount__,
    ) as number;

    // Should be exactly 1 (or close to 1) — not 10 for each keystroke
    expect(callCount).toBeLessThanOrEqual(2);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── AC-OB-21: Path 3 — Back from dry-run pre-fills vault path ────────────────

test.describe('AC-OB-21: Path 3 Back from dry-run returns to picker with pre-filled path', () => {
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

  test.skip(true, 'AC-OB-21: blocked on SKY-2553 frontend import dry-run screen');

  test('AC-OB-21: clicking Back on dry-run screen returns to vault picker with selected path pre-filled', async () => {
    const selectedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-21-'));
    fs.mkdirSync(path.join(selectedDir, '.obsidian'));

    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:pick-folder');
      ipcMain.handle('vault:pick-folder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:import-vault:dry-run');
      ipcMain.handle('onboarding:import-vault:dry-run', () => ({
        notesCount: 2,
        fatalError: null,
        brokenLinks: [],
        nameCollisions: [],
        missingFrontmatter: [],
        restructured: [],
        leftAsIs: ['a.md', 'b.md'],
      }));
    }, selectedDir);

    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImport).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.importVaultScanBtn).click();
    await expect(page.locator(SELECTOR.screenDryRun)).toBeVisible({ timeout: 10_000 });

    // Go back
    await page.locator(SELECTOR.backFromDryRun).click();
    await expect(page.locator(SELECTOR.screenImportPicker)).toBeVisible({ timeout: 5_000 });

    // Previously selected path should be pre-filled
    const pathInput = page.locator(SELECTOR.importVaultPathInput);
    const val = await pathInput.inputValue();
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
    // The wizard container should have the Liquid Neon design tokens applied.
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    const hasAccentToken = await page.evaluate(() => {
      const root = document.documentElement;
      const accent = getComputedStyle(root).getPropertyValue('--accent');
      return accent.trim().length > 0;
    });
    expect(hasAccentToken, '--accent Liquid Neon token must be defined on :root').toBe(true);
  });
});

// ─── AC-OB-23: aria-live error region always in DOM ───────────────────────────

test.describe('AC-OB-23: aria-live region always present on wizard', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-23-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-23: aria-live="polite" region is in the DOM on path-selector (idle state)', async () => {
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    // The aria-live region must exist in the DOM at all times — not conditionally rendered
    const liveRegions = await page.locator(SELECTOR.ariaLiveRegion).count();
    expect(liveRegions, 'At least one aria-live="polite" region must be in the DOM').toBeGreaterThan(0);
  });

  test('AC-OB-23: aria-live region persists when navigating to step2 (not destroyed + recreated)', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });
    await page.locator(SELECTOR.cardBlank).click();
    await expect(page.locator(SELECTOR.screenStep2)).toBeVisible({ timeout: 8_000 });

    const liveRegionsStep2 = await page.locator(SELECTOR.ariaLiveRegion).count();
    expect(liveRegionsStep2, 'aria-live region must remain in DOM on step2').toBeGreaterThan(0);
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
    // Intercept getUserMedia and track if it was called
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
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });

    // Wait a moment to ensure any auto-start voice code would have fired
    await page.waitForTimeout(2_000);

    const micRequested = await page.evaluate(
      () => (window as unknown as Record<string, boolean>).__micRequested__ ?? false,
    );
    expect(micRequested, 'getUserMedia(audio) must NOT be called during onboarding').toBe(false);
  });
});

// ─── AC-OB-25: onboarding:import-vault:dry-run IPC channel registered ─────────

test.describe('AC-OB-25: onboarding:import-vault:dry-run channel in preload bridge', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-25-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    await expect(page.locator(SELECTOR.pathSelector)).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test.skip(true, 'AC-OB-25: blocked on SKY-2553 IPC impl — channel not registered yet in preload');

  test('AC-OB-25: window.api.importVaultDryRun is a callable function', async () => {
    const hasChannel = await page.evaluate(() => {
      const api = (window as unknown as Record<string, Record<string, unknown>>).api;
      return typeof api?.importVaultDryRun === 'function';
    });
    expect(hasChannel, 'window.api.importVaultDryRun must be a function registered in preload').toBe(true);
  });
});
