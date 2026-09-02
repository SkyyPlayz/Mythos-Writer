/**
 * sky-906-default-vault-and-switcher.spec.ts — SKY-906
 *
 * End-to-end coverage for the first-run "Start blank" vault setup and the
 * vault-switcher Add/Switch flow. Boots Electron with no prior vault config
 * (so the onboarding wizard appears), clicks the "Start blank" card on step 1,
 * and asserts:
 *
 *   - SKY-11152/SKY-11151: the wizard is now three cards — template (RECOMMENDED)
 *     / blank / import — with no Quick Start entry point and no genre/theme/
 *     provider mini-flow. "Start blank" goes straight from screen-welcome to
 *     screen-name (accepting the default "My Vault" name), then closes.
 *   - main creates `<userData>/vaults/My Vault/Story Vault` and `…/Notes Vault`
 *     as an Obsidian-parity EMPTY vault — no demo seed content (SKY-11141 §3
 *     removed the generated Veynn sample-story path from every first-run
 *     option; see createVaultFromOptions.ts)
 *     (SKY-2157: default parent moved from ~/Mythos/Vaults to app.getPath('userData')/vaults)
 *   - vault-settings.json is rewired to the new pair (Story + Notes)
 *
 * Then drives the multi-vault switcher:
 *
 *   - opens the switcher, creates a second vault via "+ Create new",
 *     asserts the disk + recent-projects layout, and confirms the active
 *     project changes
 *   - switches back to the first vault and verifies vault-settings.json
 *     restores the original Story + Notes pair (per-vault state preserved).
 *
 * Acceptance criteria mapping:
 *   AC1  Clean first-run user can create a default vault with one action
 *   AC2  Manual custom path remains available (sanity: the "template" and
 *        "import" cards are still on Step 1; not exercised here — covered by
 *        existing onboarding.spec.ts)
 *   AC3  User can switch between ≥2 vaults without losing settings or state
 *   AC4  Regression coverage for default-vault creation AND vault switching
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

interface VaultSettings {
  vaultRoot?: string;
  notesVaultRoot?: string;
  layoutMode?: string;
  recentProjects?: Array<{ name: string; vaultRoot: string; notesVaultRoot?: string; openedAt: string }>;
}

function readVaultSettings(userData: string): VaultSettings {
  const file = path.join(userData, 'vault-settings.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VaultSettings;
}

async function waitForPersistedVaultPair(userData: string): Promise<{ vaultRoot: string; notesVaultRoot: string }> {
  await expect
    .poll(() => readVaultSettings(userData).vaultRoot, {
      timeout: 30_000,
      intervals: [200, 400, 800, 1000, 2000],
    })
    .toBeTruthy();
  await expect
    .poll(() => readVaultSettings(userData).notesVaultRoot, {
      timeout: 30_000,
      intervals: [200, 400, 800, 1000, 2000],
    })
    .toBeTruthy();

  const vaultSettings = readVaultSettings(userData);
  if (!vaultSettings.vaultRoot || !vaultSettings.notesVaultRoot) {
    throw new Error(`vault-settings.json missing vault roots in ${path.join(userData, 'vault-settings.json')}`);
  }
  return { vaultRoot: vaultSettings.vaultRoot, notesVaultRoot: vaultSettings.notesVaultRoot };
}

function seedAppSettingsNoOnboarding(userData: string): void {
  // Mark onboarding NOT complete so the wizard appears on first boot, but
  // pre-seed an agents/theme block so DesktopShell can render afterwards
  // without firing the settings reconciliation cold path.
  const appSettings = {
    apiKey: '',
    onboardingComplete: false,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
}

async function launchApp(userData: string, homeOverride: string): Promise<ElectronApplication> {
  // Headless on Linux/Windows without DISPLAY; macOS always has a window server.
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
    env: {
      ...process.env,
      // Pin app.getPath('home') so the test never writes outside its tmpdir.
      HOME: homeOverride,
      USERPROFILE: homeOverride,
    },
  });
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

// SKY-11152/SKY-11151: the first-run wizard is now three cards on
// screen-welcome — template (RECOMMENDED) / blank / import. "Start blank"
// (card-start-blank) goes straight to screen-name with no intermediate
// genre/theme/provider steps (those, and the old Quick Start one-click link,
// were retired by the rewrite — see OnboardingWizard.tsx's `pickMode`).
// Accepting the default name (the "My Vault" placeholder) and default
// location exercises the same "one action, sane defaults" path AC1 covers.
async function completeBlankVaultCreation(pg: Page): Promise<void> {
  await expect(pg.locator('[data-testid="screen-welcome"]')).toBeVisible({ timeout: 30_000 });
  await pg.locator('[data-testid="card-start-blank"]').click();
  await expect(pg.locator('[data-testid="screen-name"]')).toBeVisible({ timeout: 8_000 });
  await pg.locator('[data-testid="step3-open-vault"]').click();
  await Promise.race([
    pg.locator('[data-testid="gs-overlay"]').waitFor({ state: 'detached', timeout: 30_000 }),
    pg.locator('.app-menu-bar').waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
}

let userData: string;
let homeOverride: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky906-ud-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky906-home-'));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
});

test('TC-SKY-906-01: default layout creates an empty story/notes vault pair and lands on the shell', async () => {
  const saveParent = path.join(userData, 'vaults');
  fs.mkdirSync(saveParent, { recursive: true });
  seedAppSettingsNoOnboarding(userData);
  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await completeBlankVaultCreation(pg);

    const vaultPair = await waitForPersistedVaultPair(userData);
    expect(fs.existsSync(vaultPair.vaultRoot)).toBe(true);
    expect(fs.existsSync(vaultPair.notesVaultRoot)).toBe(true);
    expect(vaultPair.vaultRoot).toBe(path.join(saveParent, 'My Vault', 'Story Vault'));

    // SKY-11141 §3 / SKY-11151: "blank" is Obsidian-parity EMPTY — no demo
    // seed content, unlike the old Quick Start flow. There is no scene file
    // to assert on; the vault pair existing on disk is the whole contract.

    // vault-settings.json is rewired to the new pair and onboardingComplete=true.
    const vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(vaultPair.vaultRoot);
    expect(vaultSettings.notesVaultRoot).toBe(vaultPair.notesVaultRoot);

    // SKY-9262 (P0.5): with no story yet, the switcher has no single-story
    // title to fall back to, so it labels the vault by its project name (the
    // vault directory name) instead — ProjectSwitcher's `deriveVaultDisplayName`.
    await pg.locator('.project-switcher-btn').click();
    const activeRow = pg
      .locator('[data-testid="wc-project-menu"] .project-switcher-item')
      .filter({ has: pg.locator('.wc-active-dot') });
    await expect(activeRow.locator('.wc-pop-row-title')).toHaveText('My Vault', { timeout: 15_000 });
    await expect(activeRow.locator('.wc-pop-row-sub')).toHaveText(vaultPair.vaultRoot);
    await pg.keyboard.press('Escape');
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-SKY-906-02: Start blank avoids clobbering an existing same-named vault bundle', async () => {
  const saveParent = path.join(userData, 'vaults');
  // Pre-create a vault already named "My Vault" — the literal default name
  // OnboardingWizard's handleFinish sends when the name field is left at its
  // placeholder — to force the collision-avoidance path in
  // pickUniqueMythosVaultName (createVault.ts).
  const preexistingRoot = path.join(saveParent, 'My Vault');
  fs.mkdirSync(preexistingRoot, { recursive: true });
  fs.writeFileSync(path.join(preexistingRoot, 'user-data.md'), '# do not clobber\n', 'utf-8');

  seedAppSettingsNoOnboarding(userData);
  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await completeBlankVaultCreation(pg);

    expect(fs.readFileSync(path.join(preexistingRoot, 'user-data.md'), 'utf-8')).toBe('# do not clobber\n');

    const vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBeTruthy();
    expect(vaultSettings.notesVaultRoot).toBeTruthy();
    expect(fs.existsSync(vaultSettings.vaultRoot!)).toBe(true);
    expect(fs.existsSync(vaultSettings.notesVaultRoot!)).toBe(true);
    expect(vaultSettings.vaultRoot).not.toBe(path.join(preexistingRoot, 'Story Vault'));
    expect(vaultSettings.notesVaultRoot).not.toBe(path.join(preexistingRoot, 'Notes Vault'));
    // pickUniqueMythosVaultName suffixes on collision — the new vault lands
    // in a sibling folder, not inside the pre-existing "My Vault".
    expect(path.dirname(path.dirname(vaultSettings.vaultRoot!))).toBe(saveParent);
    expect(path.basename(path.dirname(vaultSettings.vaultRoot!))).not.toBe('My Vault');
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-SKY-906-03: vault switcher creates a 2nd vault, switches, and switches back preserving the pair', async () => {
  // Boot with a pre-seeded vault pair so the switcher has somewhere to start.
  // We bypass the wizard by marking onboardingComplete and writing a real
  // Story + Notes vault to a known location.
  const firstVaultRoot = path.join(homeOverride, 'Mythos', 'Vaults', 'First');
  const firstStory = path.join(firstVaultRoot, 'Story Vault');
  const firstNotes = path.join(firstVaultRoot, 'Notes Vault');
  fs.mkdirSync(firstStory, { recursive: true });
  fs.mkdirSync(firstNotes, { recursive: true });

  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: firstStory,
    notesVaultRoot: firstNotes,
    layoutMode: 'default',
    recentProjects: [{ name: 'First', vaultRoot: firstStory, notesVaultRoot: firstNotes, openedAt: new Date().toISOString() }],
  }, null, 2));

  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    // Wait for DesktopShell to render — the project switcher button is part of the toolbar.
    await pg.locator('.project-switcher-btn').waitFor({ timeout: 30_000 });
    await pg.locator('.project-switcher-btn').click();

    // The "+ Create new Mythos Vault" path uses the in-app useTextPrompt modal
    // (window.prompt is unsupported in Electron). Fill the modal and confirm.
    await pg.locator('[data-testid="project-switcher-create-new"]').click();
    await pg.locator('.prompt-modal-input').waitFor({ timeout: 10_000 });
    await pg.locator('.prompt-modal-input').fill('Second');
    await pg.locator('.prompt-modal-ok').click();

    // Wait until vault-settings reflects the new active vault.
    // "Second" vault lands under userData/vaults (SKY-2157: default parent → userData).
    const secondVaultStory = path.join(userData, 'vaults', 'Second', 'Story Vault');
    const secondVaultNotes = path.join(userData, 'vaults', 'Second', 'Notes Vault');
    await expect.poll(
      () => readVaultSettings(userData).vaultRoot,
      { timeout: 30_000, intervals: [200, 400, 800, 1000] },
    ).toBe(secondVaultStory);

    let vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(secondVaultStory);
    expect(vaultSettings.notesVaultRoot).toBe(secondVaultNotes);
    // Both pairs are in recent-projects.
    expect(vaultSettings.recentProjects?.length).toBeGreaterThanOrEqual(2);
    expect(vaultSettings.recentProjects?.some((p) => p.vaultRoot === firstStory)).toBe(true);
    expect(vaultSettings.recentProjects?.some((p) => p.vaultRoot.endsWith('Second/Story Vault'))).toBe(true);

    // Switch back to the first vault via the switcher.
    await pg.locator('.project-switcher-btn').click();
    // Click the row that matches the first vault path. The switcher renders
    // one button per recent project; we identify by data-attribute fallback.
    const firstRow = pg.locator(`.project-switcher-item`).filter({ hasText: 'First' }).first();
    await firstRow.click();

    await expect.poll(
      () => readVaultSettings(userData).vaultRoot,
      { timeout: 30_000, intervals: [200, 400, 800, 1000] },
    ).toBe(firstStory);

    vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(firstStory);
    // Critical SKY-906 acceptance: the paired Notes Vault is restored, not lost.
    expect(vaultSettings.notesVaultRoot).toBe(firstNotes);
  } finally {
    await app.close().catch(() => {});
  }
});
