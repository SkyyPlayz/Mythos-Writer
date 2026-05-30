/**
 * onboarding.spec.ts — MYT-379
 *
 * E2E smoke covering the three first-run onboarding paths:
 *
 *   TC-OB-01  Start Blank           — wizard completes; default vault + manifest.json created
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
  // --headless when no X display is available (CI / WSL without X server).
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

/** Wait for the welcome screen (entry point — vault choice cards are on this screen). */
async function advanceToVaultChoice(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 12_000 });
}

// ─── TC-OB-01: Start Blank ────────────────────────────────────────────────────
//
// With no app-settings.json seeded, onboardingComplete defaults to undefined (falsy)
// and the OnboardingWizard is rendered. The test navigates:
//   Welcome → Vault choice (blank) → API key (skip) → DesktopShell
// Then verifies manifest.json was created at the default vault path (<userData>/vault/).

test.describe('TC-OB-01: Start Blank', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob01-'));
    // No app-settings.json → onboardingComplete is undefined → wizard shows
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('blank vault: wizard completes and manifest.json is created at default vault path', async () => {
    await advanceToVaultChoice(page);

    // Choose "Start blank" card — navigates to the path-picker screen
    await page.locator('[data-testid="card-blank"]').click();
    await expect(page.locator('[data-testid="screen-blank-path"]')).toBeVisible({ timeout: 8_000 });

    // Route the vault inside userData so the manifest assertion below stays isolated
    await page.locator('[data-testid="blank-path-input"]').fill(path.join(userData, 'vault'));

    // Create the vault → wizard advances to API-key screen
    await page.locator('[data-testid="create-blank-vault"]').click();
    await expect(page.locator('[data-testid="screen-api-key"]')).toBeVisible({ timeout: 8_000 });

    // Skip the API key to finish onboarding
    await page.locator('[data-testid="skip-api-key"]').click();

    // DesktopShell must mount (onboardingComplete = true → App re-renders)
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });

    // The default vault is at <userData>/vault/. DesktopShell calls readManifest()
    // → ensureVaultDir() creates the directory and writes manifest.json.
    const manifestPath = path.join(userData, 'vault', 'manifest.json');
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
//   Welcome → Vault choice (existing) → Browse (mocked) → Dry-run report →
//   Import vault → API key (skip) → DesktopShell
//
// Mocking strategy:
//   vault:pick-folder   — returns fixture path + a synthetic token (avoids native dialog)
//   vault:obsidian-dry-run — returns a hardcoded report (token store is inside the
//                             bundled binary and cannot be seeded externally)
//   vault:obsidian-register — returns success (same reason)
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
    await advanceToVaultChoice(page);

    // Choose "Import Obsidian vault" card — navigates to the import-source screen
    await page.locator('[data-testid="card-import"]').click();
    await expect(page.locator('[data-testid="screen-import-source"]')).toBeVisible({ timeout: 8_000 });

    // Install IPC mocks BEFORE clicking Pick folder so the handler is in place
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
        // The token store is encapsulated inside the bundled binary and cannot
        // be seeded from outside, so we bypass token validation at the handler
        // level while preserving the full UI round-trip.
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

    // Click "Pick folder" → mocked vault:pick-folder fires immediately
    await page.locator('[data-testid="import-drop-zone-btn"]').click();

    // Dry-run report step must appear
    const dryRunStep = page.locator('[data-testid="screen-import-dryrun"]');
    await expect(dryRunStep).toBeVisible({ timeout: 12_000 });

    // Notes count must reflect the fixture vault
    await expect(dryRunStep.locator('.dry-run-stat-value')).toContainText(
      String(OBS_NOTE_COUNT),
      { timeout: 6_000 },
    );

    // No fatal scan error
    await expect(dryRunStep.locator('[data-testid="dry-run-fatal"]')).not.toBeVisible();

    // Click "Import →" → wizard calls obsidianRegister → shows import-success screen
    await dryRunStep.locator('[data-testid="confirm-import"]').click();
    await expect(page.locator('[data-testid="screen-import-success"]')).toBeVisible({ timeout: 12_000 });

    // Advance from success confirmation to the API-key step
    await page.locator('[data-testid="import-success-continue"]').click();
    await expect(page.locator('[data-testid="screen-api-key"]')).toBeVisible({ timeout: 8_000 });

    // Skip API key → DesktopShell mounts
    await page.locator('[data-testid="skip-api-key"]').click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  });
});

// ─── TC-OB-03: Open sample project ───────────────────────────────────────────
//
// "Open sample project" is the default vault choice. The wizard calls
// vault:load-sample which creates the sample files at:
//   <documents>/Mythos Sample/
// and reindexes the vault. The test then verifies:
//   • manifest.json exists in the sample vault
//   • Manuscript/the-lost-horizon/ directory exists (the bundled story)
//   • Universes/The Sunken Age/Characters/ directory exists with character notes
//   • Universes/The Sunken Age/Locations/ directory exists with location notes
//   • Story ideas/The Lost Horizon/scene-crafter.md exists (Kanban board)
//   • DesktopShell renders after wizard completion

test.describe('TC-OB-03: Open sample project', () => {
  let userData: string;
  let sampleRoot = ''; // filled after app.evaluate() resolves the documents path
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
    // Remove the sample vault created by vault:load-sample (lives in real documents dir)
    if (sampleRoot && fs.existsSync(sampleRoot)) {
      fs.rmSync(sampleRoot, { recursive: true, force: true });
    }
  });

  test('sample project: Manuscript + Universes/Story ideas scaffolded on disk, DesktopShell loads', async () => {
    await advanceToVaultChoice(page);

    // Choose "Open sample project" card — navigates to the sample path-picker screen
    await page.locator('[data-testid="card-sample"]').click();
    await expect(page.locator('[data-testid="screen-sample-path"]')).toBeVisible({ timeout: 8_000 });

    // Resolve the documents path in the main process without require (ESM context)
    sampleRoot = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('documents') + '/Mythos Sample'
    );

    // Click "Open sample →" → vault:load-sample handler scaffolds ~20 files on disk
    await page.locator('[data-testid="open-sample"]').click();

    // vault:load-sample may take a moment to create ~20 files
    await expect(page.locator('[data-testid="screen-api-key"]')).toBeVisible({ timeout: 20_000 });

    // Skip API key → DesktopShell mounts
    await page.locator('[data-testid="skip-api-key"]').click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });

    // ── On-disk assertions ────────────────────────────────────────────────────

    // manifest.json must exist (created by reindexVault inside vault:load-sample)
    const manifestPath = path.join(sampleRoot, 'manifest.json');
    const manifestFound = await waitUntil(() => fs.existsSync(manifestPath));
    expect(manifestFound, `manifest.json not found in sample vault: ${manifestPath}`).toBe(true);

    // Manuscript/the-lost-horizon/ must contain the two bundled chapters
    const storyDir = path.join(sampleRoot, 'Manuscript', 'the-lost-horizon');
    expect(
      fs.existsSync(storyDir),
      `Sample story directory not found: ${storyDir}`,
    ).toBe(true);

    const ch1 = path.join(storyDir, 'chapter-one');
    const ch2 = path.join(storyDir, 'chapter-two');
    expect(fs.existsSync(ch1), 'chapter-one directory missing').toBe(true);
    expect(fs.existsSync(ch2), 'chapter-two directory missing').toBe(true);

    // At least one .md scene file must exist under chapter-one
    const ch1Files = fs.readdirSync(ch1).filter((f) => f.endsWith('.md'));
    expect(ch1Files.length, 'No scene .md files in chapter-one').toBeGreaterThan(0);

    // Universes/The Sunken Age/Characters/ must exist with character notes
    const charsDir = path.join(sampleRoot, 'Universes', 'The Sunken Age', 'Characters');
    expect(fs.existsSync(charsDir), `Characters directory not found: ${charsDir}`).toBe(true);
    const charFiles = fs.readdirSync(charsDir).filter((f) => f.endsWith('.md'));
    expect(charFiles.length, 'No character .md files in Universes/The Sunken Age/Characters/').toBeGreaterThan(0);

    // Universes/The Sunken Age/Locations/ must exist with location notes
    const locsDir = path.join(sampleRoot, 'Universes', 'The Sunken Age', 'Locations');
    expect(fs.existsSync(locsDir), `Locations directory not found: ${locsDir}`).toBe(true);
    const locFiles = fs.readdirSync(locsDir).filter((f) => f.endsWith('.md'));
    expect(locFiles.length, 'No location .md files in Universes/The Sunken Age/Locations/').toBeGreaterThan(0);

    // Story ideas/The Lost Horizon/ must contain scene-crafter.md (Kanban board)
    const storyIdeasDir = path.join(sampleRoot, 'Story ideas', 'The Lost Horizon');
    expect(fs.existsSync(storyIdeasDir), `Story ideas directory not found: ${storyIdeasDir}`).toBe(true);
    const boardPath = path.join(storyIdeasDir, 'scene-crafter.md');
    expect(fs.existsSync(boardPath), `scene-crafter.md not found at: ${boardPath}`).toBe(true);
  });
});
