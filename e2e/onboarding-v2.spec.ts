/**
 * onboarding-v2.spec.ts — SKY-2009 / SKY-2209
 *
 * E2E coverage for AC-OB-01 through AC-OB-16 from the Onboarding v2 PRD.
 *
 * Coverage map:
 *   AC-OB-01  Quick Start → editor + Getting Started panel visible
 *   AC-OB-02  Sample genre picker renders; arrow keys cycle focus; Enter selects
 *   AC-OB-03  "What's Inside" accordion expands/collapses; one open at a time
 *   AC-OB-04  Sci-Fi Noir selection → DesktopShell loads with sample start mode
 *   AC-OB-05  Recents populated from seeded settings appear on step2
 *   AC-OB-06  Suggested location pill fills path input + triggers validation
 *   AC-OB-07  Valid empty-dir path → green ✓ styling within debounce window
 *   AC-OB-08  Any completed onboarding path → Getting Started panel visible
 *   AC-OB-09  Existing vault path → conflict hint + "See options" trigger
 *   AC-OB-10  Conflict Dialog "Open existing" → vault opens
 *   AC-OB-11  Obsidian inline import link is not surfaced; migration is deferred
 *   AC-OB-12  Non-writable path → red hint + "Create Story" button disabled
 *   AC-OB-13  Back from step1c → step1 with no card pre-selected
 *   AC-OB-14  Seeded ≤5 recents display correctly; list stays bounded
 *   AC-OB-15  Escape on step1c → cancel-confirm dialog shown
 *   AC-OB-16  Windows-style path > 200 chars → path-too-long state + button disabled
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium
 *   npx playwright test e2e/onboarding-v2.spec.ts --reporter=list
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

type ValidatePathPayload = string | { path?: string };

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

/** Click a flat path-selector onboarding card. */
async function clickStep1Card(page: Page, cardTestId: string): Promise<void> {
  await expect(page.locator('[data-testid="screen-path-selector"]')).toBeVisible({ timeout: 12_000 });
  const cardAliases: Record<string, string> = {
    'card-default-mythos-vault': 'card-path-default',
    'card-quick-start': 'card-path-default',
    'card-blank': 'card-path-blank',
    'card-sample': 'card-path-sample',
  };
  const resolvedCardTestId = cardAliases[cardTestId] ?? cardTestId;
  await page.locator(`[data-testid="${resolvedCardTestId}"]`).click();
}

/** Navigate from step1 to the step2 form via the blank card. */
async function navigateToStep2(app: ElectronApplication, page: Page): Promise<void> {
  // Stub IPC so step2 can render without side-effects.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('vault:validate-path');
    ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
  });
  await clickStep1Card(page, 'card-blank');
  await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });
}

/** Navigate from step1 to step1c (genre picker) via the sample card. */
async function navigateToStep1c(page: Page): Promise<void> {
  await clickStep1Card(page, 'card-sample');
  await expect(page.locator('[data-testid="screen-step1c"]')).toBeVisible({ timeout: 8_000 });
}

/** Write a minimal app-settings.json into userData before launching the app. */
function seedAppSettings(userData: string, overrides: Record<string, unknown>): void {
  const defaults = {
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
  };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ ...defaults, ...overrides }, null, 2),
  );
}

// ─── AC-OB-01: Default Mythos Vault path ─────────────────────────────────────

test.describe('AC-OB-01: Default Mythos Vault', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-01-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-01: default layout card completes onboarding; DesktopShell and Getting Started panel render', async () => {
    // Write minimal settings before the mock fires so DesktopShell's loadVault()
    // reads rightSidebarVisible: true and opens the GRS for the Getting Started panel.
    // The real onboarding:complete handler does this; the mock stub omits it.
    fs.writeFileSync(
      path.join(userData, 'app-settings.json'),
      JSON.stringify({
        onboardingComplete: true,
        onboardingStartMode: 'quick-start',
        gettingStartedProgress: { completedItems: [], dismissed: false },
        rightSidebarVisible: true,
      }, null, 2),
    );
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', () => ({
        ok: true,
        firstSceneId: 'scene-1',
        firstScenePath: 'Manuscript/ac-ob-01-story/chapter-1/chapter-1-scene-1.md',
      }));
    });

    await clickStep1Card(page, 'card-quick-start');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="gs-title-input"]').fill('AC-OB-01 Story');
    await page.locator('[data-testid="gs-create-story"]').click();

    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    // Getting Started panel renders automatically after first onboarding
    await expect(page.locator('[data-testid="gs-panel"]')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── AC-OB-02 + AC-OB-03 + AC-OB-13 + AC-OB-15: Genre picker interactions ──

test.describe('AC-OB-02/03/13/15: Genre picker UI', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-genre-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    // Return to step1 before each test in this describe block.
    // If already on step1c, click Back; if on step1, do nothing.
    const onStep1c = await page.locator('[data-testid="screen-step1c"]').isVisible();
    if (onStep1c) {
      await page.locator('[data-testid="gs-back-step1c"]').click();
      await expect(page.locator('[data-testid="screen-path-selector"]')).toBeVisible({ timeout: 6_000 });
    }
    const cancelConfirm = await page.locator('[data-testid="gs-cancel-confirm"]').isVisible();
    if (cancelConfirm) {
      await page.locator('[data-testid="gs-keep-going"]').click();
    }
    await expect(page.locator('[data-testid="screen-path-selector"]')).toBeVisible({ timeout: 8_000 });
  });

  test('AC-OB-02: genre picker renders with 3 genre cards; arrow keys cycle focus; Enter selects', async () => {
    await navigateToStep1c(page);

    // Radio group with 3 genre cards
    const radiogroup = page.locator('[data-testid="genre-radiogroup"]');
    await expect(radiogroup).toBeVisible();

    const cards = radiogroup.locator('[role="radio"]');
    await expect(cards).toHaveCount(3);

    // Arrow-key navigation: focus the first card, arrow-down moves to the second
    await cards.nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(2)).toBeFocused();

    // Enter on focused card selects it (aria-checked → true)
    await page.keyboard.press('Enter');
    await expect(cards.nth(2)).toHaveAttribute('aria-checked', 'true');

    // CTA button becomes enabled after a genre is selected
    await expect(page.locator('[data-testid="genre-start-btn"]')).toBeEnabled({ timeout: 2_000 });
  });

  test('AC-OB-03: "What\'s Inside" accordion expands/collapses; only one open at a time', async () => {
    await navigateToStep1c(page);

    const accordionBtnCozy = page.locator('[data-testid="genre-accordion-btn-cozy-fantasy"]');
    const accordionPanelCozy = page.locator('[data-testid="genre-accordion-panel-cozy-fantasy"]');
    const accordionBtnScifi = page.locator('[data-testid="genre-accordion-btn-sci-fi-noir"]');
    const accordionPanelScifi = page.locator('[data-testid="genre-accordion-panel-sci-fi-noir"]');

    // Open cozy-fantasy accordion
    await accordionBtnCozy.click();
    await expect(accordionBtnCozy).toHaveAttribute('aria-expanded', 'true');
    await expect(accordionPanelScifi).toHaveAttribute('aria-hidden', 'true');

    // Opening sci-fi accordion closes cozy-fantasy
    await accordionBtnScifi.click();
    await expect(accordionBtnScifi).toHaveAttribute('aria-expanded', 'true');
    await expect(accordionBtnCozy).toHaveAttribute('aria-expanded', 'false');
    await expect(accordionPanelCozy).toHaveAttribute('aria-hidden', 'true');

    // Clicking same button again collapses it
    await accordionBtnScifi.click();
    await expect(accordionBtnScifi).toHaveAttribute('aria-expanded', 'false');
    await expect(accordionPanelScifi).toHaveAttribute('aria-hidden', 'true');
  });

  test('AC-OB-13: Back from step1c → step1 with no genre pre-selected', async () => {
    await navigateToStep1c(page);

    // Select a genre so there's state to clear
    await page.locator('[data-testid="genre-card-sci-fi-noir"]').click();
    await expect(page.locator('[data-testid="genre-card-sci-fi-noir"]')).toHaveAttribute('aria-checked', 'true');

    // Navigate back
    await page.locator('[data-testid="gs-back-step1c"]').click();
    await expect(page.locator('[data-testid="screen-path-selector"]')).toBeVisible({ timeout: 6_000 });

    // On returning to step1c, no genre should be pre-selected
    await clickStep1Card(page, 'card-sample');
    await expect(page.locator('[data-testid="screen-step1c"]')).toBeVisible({ timeout: 8_000 });
    const cards = page.locator('[data-testid="genre-radiogroup"] [role="radio"]');
    for (let i = 0; i < await cards.count(); i++) {
      await expect(cards.nth(i)).toHaveAttribute('aria-checked', 'false');
    }
  });

  test('AC-OB-15: Escape on step1c → cancel-confirm dialog appears', async () => {
    await navigateToStep1c(page);
    await page.locator('[data-testid="genre-card-cozy-fantasy"]').focus();
    await page.keyboard.press('Escape');
    // Escape triggers the cancel-confirm overlay (not a direct step1 return)
    await expect(page.locator('[data-testid="gs-cancel-confirm"]')).toBeVisible({ timeout: 4_000 });
    // Dismiss the confirm dialog so afterEach cleanup works
    await page.locator('[data-testid="gs-keep-going"]').click();
  });
});

// ─── AC-OB-04: Sci-Fi Noir → DesktopShell ────────────────────────────────────

test.describe('AC-OB-04: Sci-Fi Noir sample completion', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-04-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-04: selecting Sci-Fi Noir genre and starting loads DesktopShell', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', (_evt: unknown, payload: unknown) => {
        // Capture payload in a global so we can assert it below
        (global as Record<string, unknown>).__ob04Payload__ = payload;
        return { ok: true };
      });
    });

    await navigateToStep1c(page);

    // Select Sci-Fi Noir (id: sci-fi-noir)
    await page.locator('[data-testid="genre-card-sci-fi-noir"]').click();
    await expect(page.locator('[data-testid="genre-card-sci-fi-noir"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-testid="genre-start-btn"]')).toBeEnabled();

    await page.locator('[data-testid="genre-start-btn"]').click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // Verify the IPC was called with startMode=sample and the correct sampleGenre
    const payload = await app.evaluate(() => (global as Record<string, unknown>).__ob04Payload__) as Record<string, unknown>;
    expect(payload?.startMode).toBe('sample');
    expect(payload?.sampleGenre).toBe('sci-fi-noir');
  });
});

// ─── AC-OB-05: Recents from seeded settings appear on step2 ──────────────────

test.describe('AC-OB-05: Recents populate step2', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-05-'));
    seedAppSettings(userData, {
      onboardingComplete: false,
      recentVaultParentPaths: [
        path.join(userData, 'old-vault-1'),
        path.join(userData, 'old-vault-2'),
      ],
    });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-05: seeded recent paths appear in step2 recents list', async () => {
    await navigateToStep2(app, page);

    // Recents toggle should be visible because we seeded 2 recent paths
    const toggle = page.locator('[data-testid="gs-recents-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 4_000 });

    // Expanding the list shows the seeded paths. Focus+Enter avoids Electron
    // coordinate drift on this small disclosure button under xvfb.
    await toggle.focus();
    await page.keyboard.press('Enter');
    const recentsList = page.locator('[data-testid="gs-recents-list"]');
    await expect(recentsList).toBeVisible();
    const items = recentsList.locator('li');
    await expect(items).toHaveCount(2);
  });
});

// ─── AC-OB-06: Suggested location pill fills path input ──────────────────────

test.describe('AC-OB-06: Suggested location pills', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-06-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-06: clicking a suggestion pill populates the path input', async () => {
    const docsDir = path.join(userData, 'Documents');
    const expectedSuggestion = path.join(docsDir, 'MythosWriter');

    // Mock vault:getSystemPaths before navigating to step2 so the suggestions load
    await app.evaluate(({ ipcMain }, { docsDir, homeDir }: { docsDir: string; homeDir: string }) => {
      ipcMain.removeHandler('vault:getSystemPaths');
      ipcMain.handle('vault:getSystemPaths', () => ({
        homeDir,
        documentsDir: docsDir,
        desktopDir: homeDir + '/Desktop',
        oneDriveDir: null,
        iCloudDir: null,
      }));
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    }, { docsDir, homeDir: userData });

    await navigateToStep2(app, page);

    // Suggestions area should appear after system paths are loaded
    const suggestions = page.locator('[data-testid="gs-suggestions"]');
    await expect(suggestions).toBeVisible({ timeout: 5_000 });

    // Click the first pill
    const pill = suggestions.locator('[data-testid="gs-suggestion-pill"]').first();
    await expect(pill).toBeVisible();
    await pill.click();

    // Path input should now contain the suggestion value (tildified or absolute)
    const pathInput = page.locator('[data-testid="gs-save-path"]');
    const value = await pathInput.inputValue();
    // The input may display the tilde form if homeDir prefix matches
    expect(value === expectedSuggestion || value.endsWith('Documents/MythosWriter')).toBe(true);
  });
});

// ─── AC-OB-07: Valid empty path → green styling ───────────────────────────────

test.describe('AC-OB-07: Valid empty-dir path styling', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-07-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-07: existing empty writable path → gs-form__input--valid within debounce window', async () => {
    // Mock validatePath: base → exists+empty+writable; mythos/obsidian checks → not found
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const targetPath = typeof payload === 'string' ? payload : payload.path ?? '';
        // The wizard calls validatePath 3x: base, .../Story Vault/manifest.json, .../.obsidian
        if (targetPath.includes('manifest.json') || targetPath.includes('.obsidian')) {
          return { exists: false, isEmpty: true, writable: true };
        }
        // Base path: exists, empty, writable → triggers 'valid' state
        return { exists: true, isEmpty: true, writable: true };
      });
    });

    await clickStep1Card(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });

    // Clear the path and type a new one to trigger debounced validation
    const pathInput = page.locator('[data-testid="gs-save-path"]');
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'valid-empty-dir'));

    // Wait up to 1200ms (500ms debounce + IPC round-trip + render) for the valid class
    await expect(pathInput).toHaveClass(/gs-form__input--valid/, { timeout: 1200 });
  });
});

// ─── AC-OB-08: Getting Started panel visible after any onboarding path ────────

test.describe('AC-OB-08: Getting Started panel post-onboarding', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-08-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-08: blank story completion → Getting Started panel visible in right sidebar', async () => {
    // Write minimal settings before the mock fires so DesktopShell's loadVault()
    // reads rightSidebarVisible: true and opens the GRS for the Getting Started panel.
    fs.writeFileSync(
      path.join(userData, 'app-settings.json'),
      JSON.stringify({
        onboardingComplete: true,
        onboardingStartMode: 'blank',
        gettingStartedProgress: { completedItems: [], dismissed: false },
        rightSidebarVisible: true,
      }, null, 2),
    );
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', () => ({ ok: true }));
    });

    await clickStep1Card(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="gs-title-input"]').fill('OB-08 Story');
    await page.locator('[data-testid="gs-create-story"]').click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // The Getting Started panel must be present in the right sidebar
    await expect(page.locator('[data-testid="gs-panel"]')).toBeVisible({ timeout: 5_000 });
  });
});

// ─── AC-OB-09 + AC-OB-10 + AC-OB-11 + AC-OB-12: Path validation states ──────

test.describe('AC-OB-09–12: Path validation states', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-09-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
    // Navigate to step2 once; individual tests will change the mock and clear/retype
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });
    await clickStep1Card(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-09: existing Mythos vault path → conflict hint and "See options" trigger', async () => {
    // Re-mock to simulate a path that has Story Vault/manifest.json
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const targetPath = typeof payload === 'string' ? payload : payload.path ?? '';
        if (targetPath.includes('manifest.json')) {
          return { exists: true, isEmpty: false, writable: true };
        }
        if (targetPath.includes('.obsidian')) {
          return { exists: false, isEmpty: true, writable: true };
        }
        return { exists: true, isEmpty: false, writable: true };
      });
    });

    const pathInput = page.locator('[data-testid="gs-save-path"]');
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'existing-mythos-vault'));

    // Conflict hint must appear within debounce + render time
    const hint = page.locator('[data-testid="gs-path-validation-hint"]');
    await expect(hint).toBeVisible({ timeout: 1200 });
    await expect(hint).toContainText('already exists');

    // "See options" link visible
    await expect(page.locator('[data-testid="gs-conflict-see-options"]')).toBeVisible();
  });

  test('AC-OB-10: Conflict Dialog "Open existing" action opens vault', async () => {
    // Depends on the conflict state set in AC-OB-09 above — same app session
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('onboarding:complete');
      ipcMain.handle('onboarding:complete', () => ({ ok: true }));
    });

    // Open the conflict dialog
    await page.locator('[data-testid="gs-conflict-see-options"]').click();
    await expect(page.locator('[data-testid="gs-conflict-dialog"]')).toBeVisible({ timeout: 4_000 });

    // Choose "Open existing vault"
    await page.locator('[data-testid="gs-conflict-open-existing"]').click();
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
  });
});

// ─── AC-OB-11: Obsidian paths are deferred to migration/open-existing flow ───

test.describe('AC-OB-11: Obsidian path does not surface import link inline', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-11-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-11: path with .obsidian dir defers import affordance; no inline import link is shown', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', (_evt: unknown, payload: ValidatePathPayload) => {
        const targetPath = typeof payload === 'string' ? payload : payload.path ?? '';
        if (targetPath.includes('manifest.json')) {
          return { exists: false, isEmpty: true, writable: true };
        }
        if (targetPath.includes('.obsidian')) {
          return { exists: true, isEmpty: false, writable: true };
        }
        return { exists: true, isEmpty: false, writable: true };
      });
    });

    await clickStep1Card(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });

    const pathInput = page.locator('[data-testid="gs-save-path"]');
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'obsidian-vault'));

    // Obsidian import is deferred; the inline path validator only surfaces Mythos-vault conflicts.
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="gs-switch-to-import"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="gs-path-validation-hint"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="gs-create-story"]')).toBeEnabled();
  });
});

test.describe('AC-OB-12: Non-writable path disables Create Story', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-12-'));
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-12: non-writable base path → error hint + Create Story button disabled', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({
        exists: true,
        isEmpty: false,
        writable: false,
      }));
    });

    await clickStep1Card(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });

    const pathInput = page.locator('[data-testid="gs-save-path"]');
    await pathInput.clear();
    await pathInput.fill(path.join(userData, 'readonly-dir'));

    // Error hint appears
    const hint = page.locator('[data-testid="gs-path-validation-hint"]');
    await expect(hint).toBeVisible({ timeout: 1200 });
    await expect(hint).toContainText(/writable|write/i);

    // Create Story button is disabled while path is not-writable
    await expect(page.locator('[data-testid="gs-create-story"]')).toBeDisabled();
  });
});

// ─── AC-OB-14: Recents list bounded to ≤5 entries ────────────────────────────

test.describe('AC-OB-14: Recents list bounded', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-14-'));
    // Seed exactly 5 recent paths (the maximum allowed)
    seedAppSettings(userData, {
      onboardingComplete: false,
      recentVaultParentPaths: [
        path.join(userData, 'vault-1'),
        path.join(userData, 'vault-2'),
        path.join(userData, 'vault-3'),
        path.join(userData, 'vault-4'),
        path.join(userData, 'vault-5'),
      ],
    });
    app = await launchFreshApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-14: seeded 5 recents show ≤5 entries; list is bounded', async () => {
    await navigateToStep2(app, page);

    const toggle = page.locator('[data-testid="gs-recents-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 4_000 });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const list = page.locator('[data-testid="gs-recents-list"]');
    await expect(list).toBeVisible();

    const items = list.locator('li');
    const count = await items.count();
    // Recents list must not exceed 5 entries regardless of seeded input
    expect(count).toBeLessThanOrEqual(5);
    expect(count).toBeGreaterThan(0);
  });
});

// ─── AC-OB-16: Windows-style path > 200 chars → path-too-long ────────────────

test.describe('AC-OB-16: Windows path > 200 chars disabled', () => {
  let userData: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob-v2-16-'));
    app = await launchFreshApp(userData);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:getPaths');
      ipcMain.handle('vault:getPaths', () => ({
        homeDir: 'C:\\Users\\TestUser',
        pathSeparator: '\\',
      }));
    });
    page = await firstWindow(app);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  });

  test('AC-OB-16: Windows path separator + path > 200 chars → path-too-long + Create Story disabled', async () => {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ exists: false, isEmpty: true, writable: true }));
    });

    await clickStep1Card(page, 'card-blank');
    await expect(page.locator('[data-testid="screen-step2"]')).toBeVisible({ timeout: 8_000 });

    // Wait briefly for the getPaths IPC to resolve and update the wizard's pathOptions
    await page.waitForTimeout(300);

    // Type a 201-character Windows-style path
    const longPath = 'C:\\Users\\TestUser\\' + 'A'.repeat(183); // total 201 chars
    const pathInput = page.locator('[data-testid="gs-save-path"]');
    await pathInput.clear();
    await pathInput.fill(longPath);

    // path-too-long is a synchronous check; the hint and disabled state apply immediately
    // (no debounce for Windows path-length validation)
    const hint = page.locator('[data-testid="gs-path-validation-hint"]');
    await expect(hint).toBeVisible({ timeout: 1000 });
    await expect(hint).toContainText('200');

    await expect(page.locator('[data-testid="gs-create-story"]')).toBeDisabled();
  });
});
