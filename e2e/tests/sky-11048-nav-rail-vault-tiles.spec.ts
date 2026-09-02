/**
 * sky-11048-nav-rail-vault-tiles.spec.ts — SKY-11048
 *
 * [OWNER FIDELITY] Nav rail: Mythos-vault tiles above Settings — spec'd in
 * DESIGN-SPEC.md:19 ("vault tiles (per-universe vaults) with minimized `+`")
 * but never built. This covers the rail's own tile group (NOT the title-bar
 * switcher, already covered by sky-906-default-vault-and-switcher.spec.ts).
 *
 * §4c reachability: boots from exactly ONE seeded vault — never pre-seeds a
 * second — and proves through the UI that:
 *   1. the tile group is always visible: one tile for the lone vault + a
 *      trailing "+" tile, with no second vault pre-seeded
 *   2. the "+" tile creates a second vault via the same New-Mythos-vault flow
 *      the title bar uses (window.api.vaultCreateDefaultMythos)
 *   3. clicking a vault tile switches through the same IPC path as the
 *      title-bar switcher (window.api.projectSwitch → the one completion
 *      handler) — no second switch path
 *   4. the per-vault default theme (FULL-SPEC §66) visibly applies on switch:
 *      the stored preset's slot-A color lands on --n1, and the toast fires
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
  recentProjects?: Array<{ name: string; vaultRoot: string; notesVaultRoot?: string; openedAt: string }>;
}

function readVaultSettings(userData: string): VaultSettings {
  const file = path.join(userData, 'vault-settings.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VaultSettings;
}

async function launchApp(userData: string, homeOverride: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: homeOverride,
      USERPROFILE: homeOverride,
    },
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

let userData: string;
let homeOverride: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11048-ud-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11048-home-'));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
});

test('TC-SKY-11048-01: + tile creates a second vault, tiles switch, per-vault theme applies', async () => {
  // Exactly ONE vault on disk — reachability (§4c) forbids pre-seeding two.
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
    // FULL-SPEC §66: "dropdown on each vault card; switching vaults applies
    // its theme + toast" — First carries its own default (Aurora); a fresh
    // vault created mid-test carries none, so only the switch BACK to First
    // is expected to visibly re-theme.
    vaultThemes: { [firstStory]: 'aurora' },
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
    await pg.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });

    // 1. Always visible, even with one vault: one tile + the trailing "+".
    const firstTile = pg.locator(`[data-testid="nav-rail-vault-tile-${firstStory}"]`);
    await expect(firstTile).toBeVisible();
    await expect(firstTile).toHaveClass(/nav-rail__vault-tile--active/);
    await expect(pg.locator('[data-testid="nav-rail-vault-add"]')).toBeVisible();
    await expect(pg.locator('.nav-rail__vault-tile')).toHaveCount(1);
    // Baseline theme before any switch — classic slot A.
    await expect.poll(
      () => pg.evaluate(() => document.documentElement.style.getPropertyValue('--n1').trim()),
      { timeout: 10_000 },
    ).toBe('#00f0ff');

    // 2. "+" tile → the existing New-Mythos-vault flow (in-app text-prompt
    // modal, since window.prompt is unsupported in Electron).
    await pg.locator('[data-testid="nav-rail-vault-add"]').click();
    await pg.locator('.prompt-modal-input').waitFor({ timeout: 10_000 });
    await pg.locator('.prompt-modal-input').fill('Second');
    await pg.locator('.prompt-modal-ok').click();

    const secondStory = path.join(userData, 'vaults', 'Second', 'Story Vault');
    await expect.poll(
      () => readVaultSettings(userData).vaultRoot,
      { timeout: 30_000, intervals: [200, 400, 800, 1000] },
    ).toBe(secondStory);

    // The rail now reflects both vaults and the new one is active. SKY-11238:
    // the created vault APPENDS (registration order) — a front-insert here is
    // the MRU regression that reordered the rail.
    await expect(pg.locator('.nav-rail__vault-tile')).toHaveCount(2);
    const secondTile = pg.locator(`[data-testid="nav-rail-vault-tile-${secondStory}"]`);
    await expect(secondTile).toHaveClass(/nav-rail__vault-tile--active/);
    await expect(firstTile).not.toHaveClass(/nav-rail__vault-tile--active/);
    await expect(pg.locator('.nav-rail__vault-tile').nth(0)).toHaveAttribute(
      'data-testid', `nav-rail-vault-tile-${firstStory}`,
    );
    await expect(pg.locator('.nav-rail__vault-tile').nth(1)).toHaveAttribute(
      'data-testid', `nav-rail-vault-tile-${secondStory}`,
    );

    // 3. Switch back through the FIRST vault's tile (the rail path under
    // test, not the title-bar switcher already covered by sky-906).
    await firstTile.click();
    await expect.poll(
      () => readVaultSettings(userData).vaultRoot,
      { timeout: 30_000, intervals: [200, 400, 800, 1000] },
    ).toBe(firstStory);
    await expect(firstTile).toHaveClass(/nav-rail__vault-tile--active/);
    await expect(secondTile).not.toHaveClass(/nav-rail__vault-tile--active/);

    // 4. Per-vault theme applies + toasts (FULL-SPEC §66): First's stored
    // 'aurora' preset's slot-A color (#34ffc8) replaces the classic default.
    await expect.poll(
      () => pg.evaluate(() => document.documentElement.style.getPropertyValue('--n1').trim()),
      { timeout: 10_000 },
    ).toBe('#34ffc8');
    await expect(pg.locator('[data-testid="ln-toast"]')).toContainText('Aurora');

    // 5. Regression guard: "Settings → this vault" must land on Vault & Files
    // even when Settings is ALREADY open on a different category — a plain
    // setSettingsOpen(true) is a no-op then, so SettingsPanel must actually
    // remount to pick up the new initialCategory.
    await pg.locator('.nav-rail__settings').click();
    await pg.locator('[data-testid="settings-page-header"]').waitFor({ timeout: 10_000 });
    await expect(pg.locator('#settings-category-tab-appearance')).toHaveClass(/settings-cat-nav__tab--active/);
    await firstTile.click({ button: 'right' });
    await pg.locator('[data-testid="nav-rail-vault-menu"]').waitFor({ timeout: 5_000 });
    await pg.getByRole('menuitem', { name: 'Settings → this vault' }).click();
    await expect(pg.locator('#settings-category-tab-vaults')).toHaveClass(/settings-cat-nav__tab--active/, { timeout: 10_000 });
    await expect(pg.locator('[data-testid="mvs-new-vault"]')).toBeVisible();

    // 6. Regression guard (SKY-11086): "Settings → this vault" on an INACTIVE
    // tile must switch to THAT vault before opening Settings. The handler
    // used to drop the vaultId argument entirely and just reopen Settings
    // against whichever vault was already active — right-clicking Second
    // (inactive; First is active from step 5) would silently show First's
    // Vault & Files path instead of Second's.
    await secondTile.click({ button: 'right' });
    await pg.locator('[data-testid="nav-rail-vault-menu"]').waitFor({ timeout: 5_000 });
    await pg.getByRole('menuitem', { name: 'Settings → this vault' }).click();
    await expect.poll(
      () => readVaultSettings(userData).vaultRoot,
      { timeout: 30_000, intervals: [200, 400, 800, 1000] },
    ).toBe(secondStory);
    await expect(secondTile).toHaveClass(/nav-rail__vault-tile--active/);
    await expect(firstTile).not.toHaveClass(/nav-rail__vault-tile--active/);
    await expect(pg.locator('#settings-category-tab-vaults')).toHaveClass(/settings-cat-nav__tab--active/, { timeout: 10_000 });
    await expect(pg.locator('.settings-vault-path-display')).toHaveText(secondStory, { timeout: 10_000 });
  } finally {
    await app.close().catch(() => {});
  }
});
