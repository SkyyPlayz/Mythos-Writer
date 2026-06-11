/**
 * sky-906-default-vault-and-switcher.spec.ts — SKY-906
 *
 * End-to-end coverage for the one-click default Mythos Vault setup and the
 * vault-switcher Add/Switch flow. Boots Electron with no prior vault config
 * (so the onboarding wizard appears), clicks the "Create default Mythos Vault"
 * card on step 1, and asserts:
 *
 *   - the wizard advances to the scaffolding step then closes
 *   - main creates `<userDataParent>/Mythos Vaults/Mythos Vault/Story Vault`
 *     and `…/Notes Vault` with the expected SKY-15 seed layout
 *   - vault-settings.json is rewired to the new pair (Story + Notes)
 *
 * Then drives the multi-vault switcher:
 *
 *   - opens the switcher, creates a second Mythos Vault via "+ Create new",
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

test('TC-SKY-906-01: one-click default vault creates the bundle and lands on the editor', async () => {
  seedAppSettingsNoOnboarding(userData);
  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    // The wizard renders on step 1 with the new primary card. We dispatch a
    // direct click because waiting on every animation between steps is
    // brittle on headless Linux.
    await pg.locator('[data-testid="card-default-mythos-vault"]').waitFor({ timeout: 30_000 });
    await pg.locator('[data-testid="card-default-mythos-vault"]').click();

    // Wizard advances to step3 (scaffolding) then exits to DesktopShell when
    // main returns ok. Wait for the wizard overlay to be gone.
    await pg.locator('[data-testid="gs-overlay"]').waitFor({ state: 'detached', timeout: 30_000 });

    // Disk: the SKY-906 bundle landed under <home>/Mythos/Vaults/Mythos Vault.
    const mythosVaultRoot = path.join(homeOverride, 'Mythos', 'Vaults', 'Mythos Vault');
    const storyVaultPath = path.join(mythosVaultRoot, 'Story Vault');
    const notesVaultPath = path.join(mythosVaultRoot, 'Notes Vault');
    expect(fs.existsSync(storyVaultPath)).toBe(true);
    expect(fs.existsSync(notesVaultPath)).toBe(true);

    // The orchestrated path also seeds a first scene file so the editor lands
    // on something writable. The exact scene file name uses the slug "my-first-story".
    expect(fs.existsSync(path.join(storyVaultPath, 'Manuscript', 'my-first-story', 'chapter-1', 'chapter-1-scene-1.md'))).toBe(true);

    // vault-settings.json is rewired to the new pair and onboardingComplete=true.
    const vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(storyVaultPath);
    expect(vaultSettings.notesVaultRoot).toBe(notesVaultPath);
    expect(vaultSettings.recentProjects?.[0]?.vaultRoot).toBe(storyVaultPath);
    expect(vaultSettings.recentProjects?.[0]?.notesVaultRoot).toBe(notesVaultPath);
  } finally {
    await app.close().catch(() => {});
  }
});

test('TC-SKY-906-02: re-clicking the one-click button auto-suffixes the vault name to avoid collision', async () => {
  // Pre-populate "Mythos Vault" with a user file so the helper has to pick
  // "Mythos Vault 2" instead. This locks in the no-clobber guarantee that
  // the unit tests assert against the helper — exercised here through the
  // full IPC path.
  const preexisting = path.join(homeOverride, 'Mythos', 'Vaults', 'Mythos Vault');
  fs.mkdirSync(preexisting, { recursive: true });
  fs.writeFileSync(path.join(preexisting, 'user-data.md'), '# do not clobber\n', 'utf-8');

  seedAppSettingsNoOnboarding(userData);
  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await pg.locator('[data-testid="card-default-mythos-vault"]').waitFor({ timeout: 30_000 });
    await pg.locator('[data-testid="card-default-mythos-vault"]').click();
    await pg.locator('[data-testid="gs-overlay"]').waitFor({ state: 'detached', timeout: 30_000 });

    // The original folder must be untouched.
    expect(fs.readFileSync(path.join(preexisting, 'user-data.md'), 'utf-8')).toBe('# do not clobber\n');
    // The new bundle landed at "Mythos Vault 2".
    const newRoot = path.join(homeOverride, 'Mythos', 'Vaults', 'Mythos Vault 2');
    expect(fs.existsSync(path.join(newRoot, 'Story Vault'))).toBe(true);
    expect(fs.existsSync(path.join(newRoot, 'Notes Vault'))).toBe(true);

    const vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(path.join(newRoot, 'Story Vault'));
    expect(vaultSettings.notesVaultRoot).toBe(path.join(newRoot, 'Notes Vault'));
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

    // Electron's native prompt is not surfaced as a reliable Playwright `dialog`
    // event in this harness, so stub the prompt result in the renderer and then
    // exercise the same switcher create path.
    await pg.evaluate(() => {
      window.prompt = () => 'Second';
    });
    await pg.locator('[data-testid="project-switcher-create-new"]').click();

    // Wait until vault-settings reflects the new active vault.
    await expect.poll(
      () => readVaultSettings(userData).vaultRoot,
      { timeout: 30_000, intervals: [200, 400, 800, 1000] },
    ).toBe(path.join(homeOverride, 'Mythos', 'Vaults', 'Second', 'Story Vault'));

    let vaultSettings = readVaultSettings(userData);
    expect(vaultSettings.vaultRoot).toBe(path.join(homeOverride, 'Mythos', 'Vaults', 'Second', 'Story Vault'));
    expect(vaultSettings.notesVaultRoot).toBe(path.join(homeOverride, 'Mythos', 'Vaults', 'Second', 'Notes Vault'));
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
