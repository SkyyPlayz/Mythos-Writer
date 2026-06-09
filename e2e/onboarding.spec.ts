/**
 * onboarding.spec.ts — MYT-379 / SKY-942
 *
 * E2E smoke covering the three first-run onboarding paths:
 *
 *   TC-OB-01  Start Blank           — wizard completes; Story Vault + manifest.json created
 *   TC-OB-02  Import Obsidian vault — dry-run report shown, import applied, DesktopShell loads
 *   TC-OB-03  Open sample project   — sample files scaffolded, manifest reindexed, DesktopShell loads
 *
 * Each path runs in its own isolated tmp dir (fresh Electron app instance).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium   # first time only
 *   npx playwright test e2e/onboarding.spec.ts --reporter=list
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

// ─── Constants ───────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function launchFreshApp(userData: string): Promise<ElectronApplication> {
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

/** Poll `predicate` until it returns true or `timeoutMs` elapses. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 15_000,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Wait for the welcome screen, then click the given picker card to navigate
 * to that card's sub-screen.
 */
async function clickWelcomeCard(page: Page, cardTestId: string): Promise<void> {
  await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });
  await page.locator(`[data-testid="${cardTestId}"]`).click();
}

// ─── TC-OB-01: Start Blank ────────────────────────────────────────────────────
//
// With no app-settings.json seeded, onboardingComplete defaults to undefined (falsy)
// and the OnboardingWizard is rendered. The test navigates:
//   Welcome (screen-welcome) → card-blank → screen-blank-path → Create vaults → DesktopShell
// Then verifies manifest.json was created inside Story Vault.

test.describe('TC-OB-01: Start Blank', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob01-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('blank vault: wizard completes and manifest.json is created inside Story Vault', async () => {
    await clickWelcomeCard(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-blank-path"]')).toBeVisible({ timeout: 8_000 });

    // Override validatePath so the tmp dir is accepted without waiting on async IPC.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });

    // Set the parent path to our tmp dir. vaultSetPaths will create:
    //   <userData>/Story Vault/   — story vault root (manifest written here)
    //   <userData>/Notes Vault/   — notes vault root
    await page.locator('[data-testid="blank-path-input"]').fill(userData);
    await page.locator('[data-testid="create-blank-vault"]').click();

    // DesktopShell must mount (onboardingComplete = true → App re-renders)
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // manifest.json is written by vaultSetPaths → ensureVaultDir → writeManifest
    const manifestPath = path.join(userData, 'Story Vault', 'manifest.json');
    const manifestCreated = await waitUntil(() => fs.existsSync(manifestPath));
    expect(manifestCreated, `manifest.json not found at: ${manifestPath}`).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      stories?: unknown[];
      schemaVersion?: unknown;
    };
    expect(Array.isArray(manifest.stories), 'manifest.stories must be an array').toBe(true);
    expect(manifest.schemaVersion, 'manifest.schemaVersion must be present').toBeDefined();
  });
});

// ─── TC-OB-02: Import existing Obsidian vault ─────────────────────────────────
//
// Builds a minimal fixture Obsidian vault (two .md files with frontmatter),
// mocks the native folder-picker IPC so no OS dialog is required, then navigates:
//   Welcome → card-import → screen-import-source → Browse (mocked) →
//   screen-import-dryrun → confirm-import → screen-import-success → DesktopShell
//
// Mocking strategy:
//   vault:pick-folder        — returns fixture path + synthetic token (avoids native dialog)
//   vault:obsidian-dry-run   — returns a hardcoded report (token store is inside the
//                              bundled binary and cannot be seeded externally)
//   vault:obsidian-register  — returns success (same reason)
// The token forwarding by the wizard (MYT-367 fix) is verified by the existing
// unit tests in OnboardingWizard.test.tsx; here we confirm the full UI flow.

const OBS_NOTE_COUNT = 2;

function buildFixtureObsidianVault(dir: string): void {
  // Note 1: valid note with frontmatter; contains [[wiki-link]] to Note 2
  fs.writeFileSync(
    path.join(dir, 'captain-renn.md'),
    [
      '---',
      'name: Captain Renn',
      'type: character',
      '---',
      '',
      'Weathered sea captain and reluctant ally of [[Elara Voss]].',
    ].join('\n'),
  );
  // Note 2: valid note with frontmatter; no outgoing wiki-links
  fs.writeFileSync(
    path.join(dir, 'elara-voss.md'),
    [
      '---',
      'name: Elara Voss',
      'type: character',
      '---',
      '',
      'Marine archaeologist turned deep-sea explorer.',
    ].join('\n'),
  );
}

test.describe('TC-OB-02: Import Obsidian vault', () => {
  let userData: string;
  let fixtureDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob02-'));
    fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-obs-fixture-'));
    buildFixtureObsidianVault(fixtureDir);
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  });

  test('obsidian path: dry-run report shown with note count, import applied, DesktopShell loads', async () => {
    await clickWelcomeCard(page, 'card-import');
    await expect(page.locator('[data-testid="screen-import-source"]')).toBeVisible({ timeout: 8_000 });

    // Install IPC mocks BEFORE clicking Browse so the handler is in place
    // when the renderer invokes vault:pick-folder.
    const capturedFixtureDir = fixtureDir;
    await app.evaluate(
      ({ ipcMain }, { fixturePath, noteCount }) => {
        // Replace vault:pick-folder to avoid the native OS folder dialog
        ipcMain.removeHandler('vault:pick-folder');
        ipcMain.handle('vault:pick-folder', () => ({
          vaultRoot: fixturePath,
          cancelled: false,
          registrationToken: 'e2e-smoke-token-ob02',
        }));

        // Replace vault:obsidian-dry-run: return a pre-canned report.
        ipcMain.removeHandler('vault:obsidian-dry-run');
        ipcMain.handle('vault:obsidian-dry-run', () => ({
          notesCount: noteCount,
          brokenLinks: [],
          nameCollisions: [],
          missingFrontmatter: [],
          fatalError: null,
        }));

        // Replace vault:obsidian-register: accept and return success
        ipcMain.removeHandler('vault:obsidian-register');
        ipcMain.handle('vault:obsidian-register', () => ({
          vaultRoot: fixturePath,
          notesIndexed: noteCount,
        }));
      },
      { fixturePath: capturedFixtureDir, noteCount: OBS_NOTE_COUNT },
    );

    // Click "Pick folder" inside the FolderDropZone → mocked vault:pick-folder fires
    await page.locator('[data-testid="import-drop-zone-btn"]').click();

    // Dry-run report step must appear
    const dryRunCard = page.locator('[data-testid="screen-import-dryrun"]');
    await expect(dryRunCard).toBeVisible({ timeout: 12_000 });

    // Notes count must reflect the fixture vault
    await expect(dryRunCard.locator('.dry-run-stat-value')).toContainText(
      String(OBS_NOTE_COUNT),
      { timeout: 6_000 },
    );

    // No fatal scan error
    await expect(dryRunCard.locator('[data-testid="dry-run-fatal"]')).not.toBeVisible();

    // Click "Import →" → wizard calls obsidianRegister → advances to import-success
    await dryRunCard.locator('[data-testid="confirm-import"]').click();
    await expect(page.locator('[data-testid="screen-import-success"]')).toBeVisible({ timeout: 12_000 });

    // Click "Continue →" → finishOnboarding → DesktopShell mounts
    await page.locator('[data-testid="import-success-continue"]').click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  });
});

// ─── TC-OB-03: Open sample project ───────────────────────────────────────────
//
// "Open sample project" card navigates to screen-sample-path. The wizard calls
// vault:load-sample-twovault which creates sample files at:
//   <userData>/Story Vault/   (copied from sample-project/story-vault)
//   <userData>/Notes Vault/   (copied from sample-project/notes-vault)
// and reindexes the vault. The test then verifies:
//   • manifest.json exists in Story Vault
//   • Story Vault/The Glass Library/Manuscript/ exists with .md scenes
//   • Notes Vault/Universes/Argent/Characters/ exists with character notes
//   • Notes Vault/Universes/Argent/Locations/ exists with location notes
//   • DesktopShell renders after wizard completion

test.describe('TC-OB-03: Open sample project', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob03-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('sample project: Story Vault + Notes Vault scaffolded on disk, DesktopShell loads', async () => {
    await clickWelcomeCard(page, 'card-sample');
    await expect(page.locator('[data-testid="screen-sample-path"]')).toBeVisible({ timeout: 8_000 });

    // Override validatePath so the tmp dir is accepted immediately.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });

    // Set parent path to our tmp dir. loadSampleTwoVault will create:
    //   <userData>/Story Vault/   (sample-project/story-vault)
    //   <userData>/Notes Vault/   (sample-project/notes-vault)
    await page.locator('[data-testid="sample-path-input"]').fill(userData);
    await page.locator('[data-testid="open-sample"]').click();

    // vault:load-sample-twovault copies ~15 files; allow generous timeout
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 25_000 });

    const storyVault = path.join(userData, 'Story Vault');
    const notesVault = path.join(userData, 'Notes Vault');

    // ── On-disk assertions ────────────────────────────────────────────────────

    // manifest.json written by reindexVault inside vault:load-sample-twovault
    const manifestPath = path.join(storyVault, 'manifest.json');
    const manifestFound = await waitUntil(() => fs.existsSync(manifestPath));
    expect(manifestFound, `manifest.json not found in Story Vault: ${manifestPath}`).toBe(true);

    // Story Vault/The Glass Library/Manuscript/ must contain chapter directories with .md scenes
    const manuscriptDir = path.join(storyVault, 'The Glass Library', 'Manuscript');
    expect(fs.existsSync(manuscriptDir), `Manuscript directory not found: ${manuscriptDir}`).toBe(true);
    const chapterDirs = fs.readdirSync(manuscriptDir).filter((f) =>
      fs.statSync(path.join(manuscriptDir, f)).isDirectory(),
    );
    expect(chapterDirs.length, 'No chapter directories in Manuscript/').toBeGreaterThan(0);
    const sceneFiles = chapterDirs.flatMap((ch) =>
      fs.readdirSync(path.join(manuscriptDir, ch)).filter((f) => f.endsWith('.md')),
    );
    expect(sceneFiles.length, 'No .md scene files under Manuscript/').toBeGreaterThan(0);

    // Notes Vault/Universes/Argent/Characters/ must exist with character notes
    const charsDir = path.join(notesVault, 'Universes', 'Argent', 'Characters');
    expect(fs.existsSync(charsDir), `Characters directory not found: ${charsDir}`).toBe(true);
    const charFiles = fs.readdirSync(charsDir).filter((f) => f.endsWith('.md'));
    expect(charFiles.length, 'No character .md files in Universes/Argent/Characters/').toBeGreaterThan(0);

    // Notes Vault/Universes/Argent/Locations/ must exist with location notes
    const locsDir = path.join(notesVault, 'Universes', 'Argent', 'Locations');
    expect(fs.existsSync(locsDir), `Locations directory not found: ${locsDir}`).toBe(true);
    const locFiles = fs.readdirSync(locsDir).filter((f) => f.endsWith('.md'));
    expect(locFiles.length, 'No location .md files in Universes/Argent/Locations/').toBeGreaterThan(0);
  });
});
