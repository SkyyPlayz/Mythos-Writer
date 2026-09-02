/**
 * onboarding-four-paths.spec.ts — SKY-2639 / SKY-2553 / SKY-8210 / SKY-11152
 *
 * SKY-11152 (parent spec SKY-11141 §3b, "rewrite four-path ACs"): the wizard
 * this file tests has been rebuilt again, from the ground up this time. The
 * old "4-card path selector -> step2 title/author form -> genre/theme picker
 * -> AI-provider step" shape (frontend/src/OnboardingWizard.tsx as of
 * SKY-8210) is GONE — no more sample content, no title/author form, no
 * genre/theme picker, no AI-provider step, no ConflictDialog. The wizard is
 * now exactly 3 screens (frontend/src/OnboardingWizard.tsx):
 *
 *   screen-welcome (card-template [RECOMMENDED] / card-start-blank /
 *   card-import-obsidian) ->
 *     - card-template / card-start-blank -> screen-name directly
 *     - card-import-obsidian -> screen-import (two browse rows: notes/story)
 *         -> Continue runs a real (no-write) dry-run scan -> screen-import
 *            renders its report sub-view (data-testid="screen-import-report")
 *            -> Confirm -> screen-name
 *   screen-name (every path lands here) -> vault name + destination + live
 *     "WILL BE CREATED AT" preview -> submit calls the SKY-11151 creation
 *     primitive (window.api.createVaultFromOptions) with activate:true, the
 *     only IPC call that actually writes anything to disk.
 *
 * Every AC below is a fresh pass against this shape, not a mechanical rename
 * of the old 25 — several old ACs test UI/mechanisms that no longer exist at
 * all (sample project + genre picker, title/author story form, ConflictDialog
 * open-existing/create-alongside, the old validate-path-per-keystroke
 * debounce). Those are individually skipped below with a reason, same
 * convention SKY-8210 used. Everything conceptually still true — card
 * rendering, name+destination live preview, import dry-run + the SKY-11132
 * "import never adopts the source" guard, template vs blank folder-shape
 * differences, onboardingComplete persistence, dev reset, Liquid Neon tokens,
 * no mic prompt — is re-tested for real against the new screens. AC-OB-20 is
 * new: the ticket's explicit §4c reachability requirement (fresh profile,
 * real click-through of the 3-step flow, vault created on disk at a chosen
 * NON-DEFAULT location, no window.api mocking of the creation call itself).
 *
 * Coverage map:
 *   AC-OB-01  Welcome renders exactly the 3 supported cards; RECOMMENDED chip
 *             on card-template; the old sample/open-existing/restore cards
 *             are gone
 *   AC-OB-02  SKIPPED — arrow-key radiogroup semantics still don't exist
 *   AC-OB-03  Template mode — Story Vault + Notes Vault created; Notes Vault
 *             gets the 6 skeleton folders, no demo content; mythos.json
 *             records the template seed layout
 *   AC-OB-04  Custom vault name is used as the on-disk Mythos vault folder
 *             name (replaces the old story-title-\>folder-name AC — there is
 *             no more separate story title, the vault name IS the folder)
 *   AC-OB-05  Blank mode — Story Vault + Notes Vault created, no template
 *             folders, no demo content; mythos.json records the blank layout
 *   AC-OB-06  Empty vault name falls back to "My Vault" in both the live
 *             preview and on disk (replaces the old "Untitled Story"
 *             fallback — same idea, new mechanism, name field not title
 *             field)
 *   AC-OB-07  Import — invalid folder surfaces a dry-run error inline;
 *             Continue stays enabled for retry; no report is shown
 *   AC-OB-08  Import — dry-run report shows per-target markdown/attachment/
 *             file counts for both the Notes and Story rows
 *   AC-OB-09  SKIPPED — restructured before/after file list has no current
 *             UI/IPC equivalent (same reasoning as the old AC-OB-10)
 *   AC-OB-10  Import — confirming the dry-run report lands on the shared
 *             Name-your-vault step, not a separate finish path
 *   AC-OB-11  Import — confirming import creates a NEW Mythos vault on disk
 *             and copies the source in; the source folder is byte-for-byte
 *             untouched (SKY-11132 pinned guard — the most important
 *             regression to keep covered)
 *   AC-OB-12  SKIPPED — Path 4 (sample project + genre/theme picker) was
 *             removed wholesale by §3; there is no sample path left to test
 *             (covers the old AC-OB-13/14/15 sample-genre-banner cluster)
 *   AC-OB-13  SKIPPED — ConflictDialog (Open Existing / Create Alongside) no
 *             longer exists; createVaultFromOptions collision-suffixes
 *             silently instead of surfacing a choice dialog (covers the old
 *             AC-OB-16/17 cluster)
 *   AC-OB-14  onboardingComplete persists across restart — wizard does not
 *             reappear
 *   AC-OB-15  Dev reset (onboarding:reset, hard) clears the flag; wizard
 *             reappears on next restart
 *   AC-OB-16  SKIPPED — the old validate-path-per-keystroke IPC debounce has
 *             no equivalent: the new live "WILL BE CREATED AT" preview
 *             (computeFullPath) is a pure local string computation, not an
 *             IPC round-trip per keystroke, so there is nothing to debounce
 *   AC-OB-17  Liquid Neon --accent CSS token present on wizard screens
 *   AC-OB-18  SKIPPED — no persistent aria-live region exists on any wizard
 *             screen (same reasoning as the old AC-OB-23)
 *   AC-OB-19  No microphone permission prompt during onboarding
 *   AC-OB-20  §4c reachability: fresh profile, real click-through of the
 *             3-step flow (blank path), vault created ON DISK at a chosen
 *             NON-DEFAULT location — real IPC/filesystem throughout, only
 *             the native OS folder-picker dialog is stubbed
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
  screenWelcome: '[data-testid="screen-welcome"]',
  screenImport: '[data-testid="screen-import"]',
  screenImportReport: '[data-testid="screen-import-report"]',
  screenName: '[data-testid="screen-name"]',

  cardTemplate: '[data-testid="card-template"]',
  cardStartBlank: '[data-testid="card-start-blank"]',
  cardImportObsidian: '[data-testid="card-import-obsidian"]',

  vaultNameInput: '[data-testid="step3-vault-name"]',
  vaultPathInput: '[data-testid="step3-path-path"]',
  vaultPathBrowse: '[data-testid="step3-path-browse"]',
  vaultPathReset: '[data-testid="step3-path-reset"]',
  fullPathPreview: '[data-testid="step3-full-path"]',
  createNote: '[data-testid="step3-create-note"]',
  openVaultBtn: '[data-testid="step3-open-vault"]',
  scaffoldError: '[data-testid="gs-scaffold-error"]',

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

async function firstWindow(app: ElectronApplication, timeout = 60_000): Promise<Page> {
  const page = await app.firstWindow({ timeout });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Recursive, sorted, relative file+dir list under root (for source-untouched diffing). */
function entryList(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(entry.isDirectory() ? `${rel}/` : rel);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
    }
  };
  walk(root, '');
  return out;
}

// ─── AC-OB-01: Welcome — exactly the 3 supported cards ────────────────────────

test.describe('AC-OB-01: Welcome screen — 3 path cards', () => {
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

  test('AC-OB-01: exactly 3 cards rendered; RECOMMENDED chip on card-template only; no sample/open-existing/restore cards', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });

    const cards = page.locator('.gs-cards .gs-card');
    await expect(cards).toHaveCount(3);

    await expect(page.locator(SELECTOR.cardTemplate)).toBeVisible();
    await expect(page.locator(SELECTOR.cardTemplate).locator('.gs-card__chip')).toHaveText('RECOMMENDED');
    await expect(page.locator(SELECTOR.cardStartBlank)).toBeVisible();
    await expect(page.locator(SELECTOR.cardStartBlank).locator('.gs-card__chip')).toHaveCount(0);
    await expect(page.locator(SELECTOR.cardImportObsidian)).toBeVisible();
    await expect(page.locator(SELECTOR.cardImportObsidian).locator('.gs-card__chip')).toHaveCount(0);

    await expect(page.locator('[data-testid="card-sample"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="card-open-existing"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="card-restore"]')).toHaveCount(0);
  });
});

// ─── AC-OB-02: Keyboard navigation — SKIPPED ──────────────────────────────────

test.describe('AC-OB-02: Keyboard navigation', () => {
  test('AC-OB-02: Arrow keys cycle focus within radiogroup; Enter activates path', async () => {
    test.skip(
      true,
      'SKY-11152: still no equivalent — the 3 welcome cards (StartingPointCard, ' +
      'frontend/src/OnboardingWizard.tsx) remain plain <button> elements activated by Enter/Space, ' +
      'not a role="radio" radiogroup with arrow-key cycling. This was already true under SKY-8210 ' +
      'and the SKY-11152 rewrite did not change it.',
    );
  });
});

// ─── AC-OB-03: Template mode creates the ready-shape skeleton ─────────────────

test.describe('AC-OB-03: Template mode creates Story Vault + Notes Vault skeleton', () => {
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

  test('AC-OB-03: template mode creates the 6 skeleton folders, zero notes, mythos.json records the template layout', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardTemplate).click();
    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.vaultPathInput).fill(vaultParent);
    await page.locator(SELECTOR.vaultNameInput).fill('AC-OB-03 Vault');
    await page.locator(SELECTOR.openVaultBtn).click();

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const mythosRoot = path.join(vaultParent, 'AC-OB-03 Vault');
    const storyVault = path.join(mythosRoot, 'Story Vault');
    const notesVault = path.join(mythosRoot, 'Notes Vault');
    expect(fs.existsSync(storyVault)).toBe(true);
    expect(fs.existsSync(notesVault)).toBe(true);

    for (const dir of ['Characters', 'Locations', 'Stories', 'Plot', 'Worldbuilding', 'Research']) {
      const full = path.join(notesVault, dir);
      expect(fs.existsSync(full), `Notes Vault/${dir} should exist`).toBe(true);
      expect(fs.readdirSync(full), `Notes Vault/${dir} should be empty (shape, not notes)`).toHaveLength(0);
    }

    const mythosJson = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(mythosJson.seed?.layout).toBe('template@SKY-11151');
  });
});

// ─── AC-OB-04: Vault name used as the on-disk folder name ─────────────────────

test.describe('AC-OB-04: Vault name reflected in the on-disk folder name', () => {
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

  test('AC-OB-04: "Dragon\'s Crossing" vault name used as the Mythos vault folder name on disk', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.vaultPathInput).fill(vaultParent);
    await page.locator(SELECTOR.vaultNameInput).fill("Dragon's Crossing");
    await expect(page.locator(SELECTOR.fullPathPreview)).toHaveText(path.join(vaultParent, "Dragon's Crossing"));
    await page.locator(SELECTOR.openVaultBtn).click();

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const storyVault = path.join(vaultParent, "Dragon's Crossing", 'Story Vault');
    expect(fs.existsSync(storyVault), "vaultParent/Dragon's Crossing/Story Vault should exist").toBe(true);
  });
});

// ─── AC-OB-05: Blank mode creates empty vault dirs ────────────────────────────

test.describe('AC-OB-05: Blank mode creates empty Story/Notes Vault dirs', () => {
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

  test('AC-OB-05: blank mode creates an empty Notes Vault (no skeleton, no demo content); mythos.json records the blank layout', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.vaultPathInput).fill(vaultParent);
    await page.locator(SELECTOR.vaultNameInput).fill('AC-OB-05 Vault');
    await page.locator(SELECTOR.openVaultBtn).click();

    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const mythosRoot = path.join(vaultParent, 'AC-OB-05 Vault');
    const notesVault = path.join(mythosRoot, 'Notes Vault');
    expect(fs.existsSync(notesVault)).toBe(true);
    expect(fs.readdirSync(notesVault), 'blank mode should not seed any Notes Vault folders').toHaveLength(0);

    const mythosJson = JSON.parse(fs.readFileSync(path.join(mythosRoot, 'mythos.json'), 'utf-8'));
    expect(mythosJson.seed?.mode).toBe('blank');
  });
});

// ─── AC-OB-06: Empty vault name falls back to "My Vault" ──────────────────────

test.describe('AC-OB-06: Empty vault name falls back to "My Vault"', () => {
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

  test('AC-OB-06: leaving VAULT NAME empty previews and creates "My Vault"', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });

    await page.locator(SELECTOR.vaultPathInput).fill(vaultParent);
    await expect(page.locator(SELECTOR.fullPathPreview)).toHaveText(path.join(vaultParent, 'My Vault'));

    await page.locator(SELECTOR.openVaultBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });
    expect(fs.existsSync(path.join(vaultParent, 'My Vault', 'Story Vault'))).toBe(true);
  });
});

// ─── AC-OB-07: Obsidian import — invalid folder shows dry-run error ──────────

test.describe('AC-OB-07: Import — invalid folder shows dry-run error', () => {
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

  test('AC-OB-07: folder with no .obsidian/ or .md files -> inline dry-run error; Continue stays enabled for retry; no report shown', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenImport)).toBeVisible({ timeout: 8_000 });

    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-obsidian-'));
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        error: "This doesn't look like an Obsidian vault (no .obsidian folder or markdown files found).",
      }));
    }, emptyDir);

    await page.locator('[data-testid="step2-notes-browse"]').click();
    await expect(page.locator('[data-testid="step2-notes-path"]')).toHaveValue(emptyDir);
    await page.locator('[data-testid="step2-continue"]').click();

    const error = page.locator('[data-testid="step2-dryrun-error"]');
    await expect(error).toBeVisible({ timeout: 6_000 });
    await expect(error).toContainText("doesn't look like an Obsidian vault");

    await expect(page.locator('[data-testid="step2-continue"]')).toBeEnabled();
    await expect(page.locator(SELECTOR.screenImportReport)).toHaveCount(0);

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-08: Obsidian import — dry-run report shows per-target counts ──────

test.describe('AC-OB-08: Import — dry-run report display', () => {
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
        return { path: title.toLowerCase().includes('story') ? dirs.storyDir : dirs.notesDir, cancelled: false };
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

    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenImport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="step2-notes-browse"]').click();
    await expect(page.locator('[data-testid="step2-notes-path"]')).toHaveValue(notesDir);
    await page.locator('[data-testid="step2-story-browse"]').click();
    await expect(page.locator('[data-testid="step2-story-path"]')).toHaveValue(storyDir);

    await page.locator('[data-testid="step2-continue"]').click();

    const report = page.locator(SELECTOR.screenImportReport);
    await expect(report).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="step2-report-notes"]')).toContainText('42');
    await expect(page.locator('[data-testid="step2-report-story"]')).toContainText('7');
    await expect(page.locator('[data-testid="step2-report-confirm"]')).toBeEnabled();

    fs.rmSync(notesDir, { recursive: true, force: true });
    fs.rmSync(storyDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-09: Restructured files list — SKIPPED ──────────────────────────────

test.describe('AC-OB-09: Restructured files shown in dry-run', () => {
  test('AC-OB-09: restructured section shows before/after list; Import button enabled', async () => {
    test.skip(
      true,
      'SKY-8210 / SKY-11152: still no equivalent. The dry-run preview ' +
      '(onboarding:dryRunObsidianImport) only ever carried markdownCount/attachmentCount/' +
      'totalFiles/topLevelFolders/sampleFiles — no restructured before/after mapping. This was ' +
      'never carried into the SKY-2993 Obsidian import redesign, and the SKY-11152 rewrite reused ' +
      'the same preview shape unchanged.',
    );
  });
});

// ─── AC-OB-10: Confirming the dry-run report lands on Name-your-vault ────────

test.describe('AC-OB-10: Import confirm lands on the shared Name-your-vault step', () => {
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

  test('AC-OB-10: confirming the report shows screen-name, not the app shell directly', async () => {
    const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs10-notes-'));
    fs.mkdirSync(path.join(notesDir, '.obsidian'));

    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
      ipcMain.removeHandler('onboarding:dryRunObsidianImport');
      ipcMain.handle('onboarding:dryRunObsidianImport', () => ({
        preview: { markdownCount: 3, attachmentCount: 0, totalFiles: 3, topLevelFolders: [], sampleFiles: [] },
      }));
    }, notesDir);

    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenImport)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="step2-notes-browse"]').click();
    await page.locator('[data-testid="step2-continue"]').click();
    await expect(page.locator(SELECTOR.screenImportReport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="step2-report-confirm"]').click();
    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(SELECTOR.appMenuBar)).toHaveCount(0);

    fs.rmSync(notesDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-11: Import creates a NEW vault; source is byte-for-byte untouched ──

test.describe('AC-OB-11: Import creates a NEW Mythos vault; source untouched (SKY-11132)', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  let vaultParent: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-11-'));
    vaultParent = path.join(userData, 'Vaults11');
    fs.mkdirSync(vaultParent, { recursive: true });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  // Real (unstubbed) UI + IPC + filesystem, same repo E2E standard as
  // e2e/vault-open-folder-guard-sky11132.spec.ts. Only the native OS
  // folder-picker dialog is stubbed — dry-run scan, vault creation and file
  // copy all run for real.
  test('AC-OB-11: confirming a real import creates a new vault on disk; the source folder is never adopted or modified', async () => {
    const obsidianDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-obsidian-11-'));
    fs.mkdirSync(path.join(obsidianDir, '.obsidian'));
    fs.mkdirSync(path.join(obsidianDir, 'Ideas'));
    // The importer copies notes byte-for-byte — the bare-stem [[wikilink]]
    // and everything else stays exactly as Obsidian wrote it (SKY-10383).
    fs.writeFileSync(path.join(obsidianDir, 'note1.md'), '# Note One\n\nLinks to [[Note Two]].\n');
    fs.writeFileSync(path.join(obsidianDir, 'Ideas', 'Note Two.md'), '# Note Two\n\nBody.\n');
    const sourceSnapshot = () => JSON.stringify({
      note1: fs.readFileSync(path.join(obsidianDir, 'note1.md'), 'utf8'),
      note2: fs.readFileSync(path.join(obsidianDir, 'Ideas', 'Note Two.md'), 'utf8'),
      entries: fs.readdirSync(obsidianDir).sort(),
    });
    const before = sourceSnapshot();

    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
    }, obsidianDir);

    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardImportObsidian).click();
    await expect(page.locator(SELECTOR.screenImport)).toBeVisible({ timeout: 8_000 });

    await page.locator('[data-testid="step2-notes-browse"]').click();
    await expect(page.locator('[data-testid="step2-notes-path"]')).toHaveValue(obsidianDir);
    await page.locator('[data-testid="step2-continue"]').click();
    await expect(page.locator(SELECTOR.screenImportReport)).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="step2-report-confirm"]').click();

    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });
    await page.locator(SELECTOR.vaultPathInput).fill(vaultParent);
    await page.locator(SELECTOR.vaultNameInput).fill('AC-OB-11 Vault');
    await page.locator(SELECTOR.openVaultBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    // A NEW Mythos vault exists at the CHOSEN destination — never at/inside
    // the source folder — with the source's notes copied into its Notes
    // Vault side, content byte-identical (SKY-10383: no wikilink rewrite, no
    // injected frontmatter).
    const mythosRoot = path.join(vaultParent, 'AC-OB-11 Vault');
    expect(fs.existsSync(path.join(mythosRoot, 'mythos.json'))).toBe(true);
    expect(fs.existsSync(path.join(mythosRoot, 'Story Vault'))).toBe(true);
    const importedNote1 = fs.readFileSync(path.join(mythosRoot, 'Notes Vault', 'note1.md'), 'utf8');
    expect(importedNote1).toBe('# Note One\n\nLinks to [[Note Two]].\n');
    expect(fs.existsSync(path.join(mythosRoot, 'Notes Vault', 'Ideas', 'Note Two.md'))).toBe(true);

    // The source Obsidian folder is untouched — the SKY-11132 pinned rule.
    expect(sourceSnapshot()).toBe(before);
    expect(entryList(obsidianDir)).not.toContain('mythos.json');

    fs.rmSync(obsidianDir, { recursive: true, force: true });
  });
});

// ─── AC-OB-12: Sample project + genre picker — SKIPPED ────────────────────────

test.describe('AC-OB-12: Sample project path (Path 4)', () => {
  test('AC-OB-12: sample project + genre/theme picker no longer exist', async () => {
    test.skip(
      true,
      'SKY-11152 (parent spec SKY-11141 §3): Path 4 (a generated Veynn demo/sample project, its ' +
      'genre picker with accordions, and the sample-project dismissible banner) was removed ' +
      'wholesale from the first-run wizard — "§3 removes the generated sample-story path from ' +
      'first run" (see createVaultFromOptions.ts doc comment). There are only 3 cards on ' +
      'screen-welcome (template / blank / import) and none of them lead to a genre step. This ' +
      'covers what were the old AC-OB-13, AC-OB-14 and AC-OB-15.',
    );
  });
});

// ─── AC-OB-13: ConflictDialog — SKIPPED ───────────────────────────────────────

test.describe('AC-OB-13: Path-conflict dialog (Open Existing / Create Alongside)', () => {
  test('AC-OB-13: ConflictDialog no longer exists', async () => {
    test.skip(
      true,
      'SKY-11152: the old gs-conflict-dialog (shown when the typed save path already had ' +
      'something at it, offering Open Existing vs Create Alongside) has no equivalent in the new ' +
      'screen-name step. createVaultFromOptions collision-suffixes the destination name silently ' +
      '(exactName defaults to false) rather than surfacing a choice UI, and vault-adoption ' +
      '("open existing") is out of scope for this wizard entirely — SKY-11151\'s primitive only ' +
      'creates NEW vaults. This covers what were the old AC-OB-16 and AC-OB-17.',
    );
  });
});

// ─── AC-OB-14: onboardingComplete persists across restart ─────────────────────

/**
 * Real (unstubbed) "Start blank" completion, which both marks
 * onboardingComplete and writes a real vault + vault-settings.json to
 * `userData`, then closes — leaving `userData` in the same on-disk state a
 * real prior run would.
 */
async function completeBlankOnboarding(userData: string): Promise<void> {
  const vaultParent = path.join(userData, 'DefaultVault');
  fs.mkdirSync(vaultParent, { recursive: true });
  const app = await launchFreshApp(userData);
  const page = await firstWindow(app);
  await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
  await page.locator(SELECTOR.cardStartBlank).click();
  await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });
  await page.locator(SELECTOR.vaultPathInput).fill(vaultParent);
  await page.locator(SELECTOR.vaultNameInput).fill('Default Vault');
  await page.locator(SELECTOR.openVaultBtn).click();
  await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });
  await app.close().catch(() => {});
}

test.describe('AC-OB-14: onboardingComplete persists across app restart', () => {
  let userData: string;
  let app: ElectronApplication;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-14-'));
    await completeBlankOnboarding(userData);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-14: launching with onboardingComplete:true skips the wizard; app opens to the main shell', async () => {
    app = await launchFreshApp(userData);
    const page = await firstWindow(app);

    await expect(page.locator(SELECTOR.screenWelcome)).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });
});

// ─── AC-OB-15: Dev reset via onboarding:reset ─────────────────────────────────

test.describe('AC-OB-15: onboarding:reset (hard) clears the flag; wizard reappears', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-15-'));
    await completeBlankOnboarding(userData);
    // SKY-11151: every wizard path now creates a v2 (mythos.json) vault, and
    // SETTINGS_GET's M29 marker guard force-re-completes onboarding for any
    // configured v2 vault on every read — a *soft* reset (onboardingComplete:
    // false only) is immediately undone before the renderer ever sees it.
    // `hard: true` (dev-only, MYTHOS_DEV=1) additionally resets vaultRoot
    // back to a fresh default path with no mythos.json beside it, so the
    // guard has nothing to re-complete against and the reset actually sticks
    // — same mechanism the pre-SKY-11152 file used for its non-v2 legacy
    // fixture, adapted for a build where every created vault is v2.
    app = await launchFreshApp(userData, { MYTHOS_DEV: '1' });
    page = await firstWindow(app);
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-15: calling onboarding:reset({hard:true}) then restarting shows the wizard again', async () => {
    await page.evaluate(async () => {
      if (window.api?.onboardingReset) {
        await window.api.onboardingReset({ hard: true });
      }
    });

    await app.close().catch(() => {});
    app = await launchFreshApp(userData, { MYTHOS_DEV: '1' });
    page = await firstWindow(app);

    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 20_000 });
  });
});

// ─── AC-OB-16: Path validation debounce — SKIPPED ─────────────────────────────

test.describe('AC-OB-16: Path validation fires at most once per 400ms idle', () => {
  test('AC-OB-16: rapid keystrokes produce at most 2 validate calls per 400ms idle window', async () => {
    test.skip(
      true,
      'SKY-11152: no equivalent. The old screen-step2 form called vault:validate-path over IPC on ' +
      'every keystroke (debounced 400ms) to show inline exists/writable errors. The new screen-name ' +
      'step\'s "WILL BE CREATED AT" preview (computeFullPath, OnboardingWizard.tsx) is a pure local ' +
      'string join — vaultGetPaths() is only called once on mount for the default-parent prefill, ' +
      'there is no per-keystroke IPC round-trip left to debounce. Any invalid/unwritable destination ' +
      'now only surfaces AFTER submit, as the createVaultFromOptions error (see AC-OB-06\'s sibling ' +
      'gs-scaffold-error coverage in AddVaultDialog/wizard unit tests).',
    );
  });
});

// ─── AC-OB-17: Liquid Neon tokens present on wizard screens ───────────────────

test.describe('AC-OB-17: Liquid Neon CSS tokens on wizard screens', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-17-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-17: wizard root element has --accent CSS custom property (Liquid Neon token)', async () => {
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });

    const hasAccentToken = await page.evaluate(() => {
      const root = document.documentElement;
      const accent = getComputedStyle(root).getPropertyValue('--accent');
      return accent.trim().length > 0;
    });
    expect(hasAccentToken, '--accent Liquid Neon token must be defined on :root').toBe(true);
  });
});

// ─── AC-OB-18: aria-live error region — SKIPPED ───────────────────────────────

test.describe('AC-OB-18: aria-live region always present on wizard', () => {
  test('AC-OB-18: aria-live="polite" region is in the DOM on screen-welcome (idle state)', async () => {
    test.skip(
      true,
      'SKY-8210 / SKY-11152: still no equivalent — grep of frontend/src/OnboardingWizard.tsx shows ' +
      'no aria-live region on screen-welcome, screen-import or screen-name. The dev-known-error ' +
      'surfaces (gs-scaffold-error, step2-dryrun-error) only mount when there is an active message, ' +
      'same as the shared Toast component — not "always in the DOM".',
    );
  });
});

// ─── AC-OB-19: No mic permission prompt during onboarding ─────────────────────

test.describe('AC-OB-19: No microphone permission prompt during onboarding', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-19-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-19: navigator.mediaDevices.getUserMedia is not called during wizard display', async () => {
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
    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });

    await page.waitForTimeout(2_000);

    const micRequested = await page.evaluate(
      () => (window as unknown as Record<string, boolean>).__micRequested__ ?? false,
    );
    expect(micRequested, 'getUserMedia(audio) must NOT be called during onboarding').toBe(false);
  });
});

// ─── AC-OB-20: §4c reachability — real click-through to a NON-DEFAULT location ─

test.describe('AC-OB-20: §4c reachability — real click-through, vault created at a custom location', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;
  let defaultParent: string;
  let customParent: string;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-20-'));
    // The default vaults parent (defaultMythosVaultsParentPath: <userData>/vaults)
    // — proving the created vault is NOT here is the point of this AC.
    defaultParent = path.join(userData, 'vaults');
    customParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-4path-20-custom-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(customParent, { recursive: true, force: true });
  });

  // Real UI, real IPC, real filesystem end to end. Only the native OS
  // folder-picker dialog is stubbed (same accepted pattern as
  // e2e/settings-vault-path.spec.ts's vault:chooseFolder stub) — the Browse
  // click, the destination write, and the vault scaffold on disk are all real.
  test('AC-OB-20: Welcome -> Start blank -> Browse to a custom parent -> Name -> vault created on disk at that custom (non-default) location', async () => {
    await app.evaluate(({ ipcMain }, dir) => {
      ipcMain.removeHandler('vault:chooseFolder');
      ipcMain.handle('vault:chooseFolder', () => ({ path: dir, cancelled: false }));
    }, customParent);

    await expect(page.locator(SELECTOR.screenWelcome)).toBeVisible({ timeout: 15_000 });
    await page.locator(SELECTOR.cardStartBlank).click();
    await expect(page.locator(SELECTOR.screenName)).toBeVisible({ timeout: 8_000 });

    // Sanity: the default prefill is NOT the custom folder we're about to pick.
    const prefilled = await page.locator(SELECTOR.vaultPathInput).inputValue();
    expect(prefilled).not.toBe(customParent);

    await page.locator(SELECTOR.vaultPathBrowse).click();
    await expect(page.locator(SELECTOR.vaultPathInput)).toHaveValue(customParent);

    await page.locator(SELECTOR.vaultNameInput).fill('§4c Reachability Vault');
    await expect(page.locator(SELECTOR.fullPathPreview)).toHaveText(path.join(customParent, '§4c Reachability Vault'));

    await page.locator(SELECTOR.openVaultBtn).click();
    await expect(page.locator(SELECTOR.appMenuBar)).toBeVisible({ timeout: 25_000 });

    const mythosRoot = path.join(customParent, '§4c Reachability Vault');
    expect(fs.existsSync(path.join(mythosRoot, 'mythos.json')), 'vault must exist ON DISK at the custom location').toBe(true);
    expect(fs.existsSync(path.join(mythosRoot, 'Story Vault'))).toBe(true);
    expect(fs.existsSync(path.join(mythosRoot, 'Notes Vault'))).toBe(true);
    // ...and definitely not under the default vaults parent.
    expect(fs.existsSync(path.join(defaultParent, '§4c Reachability Vault'))).toBe(false);
  });
});
