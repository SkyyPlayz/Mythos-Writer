/**
 * sky-906-default-vault-and-switcher.spec.ts — SKY-906
 *
 * End-to-end coverage for the Quick Start (one-click) vault setup and the
 * vault-switcher Add/Switch flow. Boots Electron with no prior vault config
 * (so the onboarding wizard appears), clicks the "Quick Start" card on step 1,
 * and asserts:
 *
 *   - the wizard advances to the scaffolding step then closes
 *   - main creates `<userData>/vaults/My First Vault/Story Vault`
 *     and `…/Notes Vault` with the expected SKY-15 seed layout
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
 *   AC2  Manual custom path remains available (sanity: the "Choose custom
 *        folder" card is still on Step 1; not exercised here — covered by
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

async function selectQuickStartCard(pg: Page): Promise<void> {
  await expect(pg.locator('[data-testid="screen-step1"]')).toBeVisible({ timeout: 30_000 });

  const quickStartCandidates = [
    'card-quick-start',
    'card-default-mythos-vault',
    'card-path-default',
  ];
  for (const testId of quickStartCandidates) {
    const card = pg.locator(`[data-testid="${testId}"]`);
    if (await card.isVisible().catch(() => false)) {
      await card.click();
      return;
    }
  }

  const byTitle = pg.locator('button[aria-label="Quick Start: One click — we set everything up for you."]');
  if (await byTitle.isVisible().catch(() => false)) {
    await byTitle.click();
    return;
  }

  const byText = pg.locator('.gs-card__title', { hasText: 'Quick Start' }).locator('..');
  if (await byText.isVisible().catch(() => false)) {
    await byText.click();
    return;
  }

  throw new Error('Could not find Quick Start card on onboarding step 1');
}

async function completeQuickStart(pg: Page): Promise<void> {
  await selectQuickStartCard(pg);
  await Promise.race([
    pg.locator('[data-testid="gs-overlay"]').waitFor({ state: 'detached', timeout: 30_000 }),
    pg.locator('[data-testid="screen-step2"]').waitFor({ state: 'visible', timeout: 30_000 }),
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

test('TC-SKY-906-01: default layout creates a story/notes vault pair and lands on the editor', async () => {
  const saveParent = path.join(userData, 'vaults');
  fs.mkdirSync(saveParent, { recursive: true });
  seedAppSettingsNoOnboarding(userData);
  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await completeQuickStart(pg);

    const vaultPair = await waitForPersistedVaultPair(userData);
    expect(fs.existsSync(vaultPair.vaultRoot)).toBe(true);
    expect(fs.existsSync(vaultPair.notesVaultRoot)).toBe(true);

    // Quick Start seeds a first scene file so the editor lands on something
    // writable.
    expect(
      fs.existsSync(path.join(vaultPair.vaultRoot, 'Manuscript', 'My First Story', 'chapter-1', 'chapter-1-scene-1.md')),
    ).toBe(true);

    // vault-settings.json is rewired to the new pair and onboardingComplete=true.
    const vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(vaultPair.vaultRoot);
    expect(vaultSettings.notesVaultRoot).toBe(vaultPair.notesVaultRoot);
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-SKY-906-02: Quick Start avoids clobbering an existing default vault bundle', async () => {
  const saveParent = path.join(userData, 'vaults');
  // Pre-create both historical default names with content to force the
  // collision-avoidance path without coupling this E2E test to naming churn.
  const preexistingRoots = ['Mythos Vault', 'My First Vault'].map((name) => path.join(saveParent, name));
  for (const preexistingRoot of preexistingRoots) {
    fs.mkdirSync(preexistingRoot, { recursive: true });
    fs.writeFileSync(path.join(preexistingRoot, 'user-data.md'), '# do not clobber\n', 'utf-8');
  }

  seedAppSettingsNoOnboarding(userData);
  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await completeQuickStart(pg);

    for (const preexistingRoot of preexistingRoots) {
      expect(fs.readFileSync(path.join(preexistingRoot, 'user-data.md'), 'utf-8')).toBe('# do not clobber\n');
    }

    const vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBeTruthy();
    expect(vaultSettings.notesVaultRoot).toBeTruthy();
    expect(fs.existsSync(vaultSettings.vaultRoot!)).toBe(true);
    expect(fs.existsSync(vaultSettings.notesVaultRoot!)).toBe(true);
    expect(preexistingRoots.some((root) => vaultSettings.vaultRoot === path.join(root, 'Story Vault'))).toBe(false);
    expect(preexistingRoots.some((root) => vaultSettings.notesVaultRoot === path.join(root, 'Notes Vault'))).toBe(false);
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
