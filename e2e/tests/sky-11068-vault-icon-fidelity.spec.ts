/**
 * sky-11068-vault-icon-fidelity.spec.ts — SKY-11068
 *
 * [SKY-11046 redo] Per-vault icon: the manuscript switcher (nav-rail vault
 * tiles) needs an author-settable image/icon per vault, stored vault-local
 * so it travels with the vault on move/copy (not app-global settings).
 *
 * §4c reachability: boots from exactly ONE seeded vault with NO icon field —
 * never pre-seeds an icon — and proves through the UI that:
 *   1. with no icon set, the tile shows the initials default (never empty)
 *   2. setting a glyph icon from the tile's right-click menu persists into
 *      the vault's own mythos.json (not app-settings)
 *   3. the icon survives an app restart
 *   4. the icon survives the vault being moved to a new path on disk —
 *      proof the storage is vault-local, not keyed off the old path
 *   5. setting an image icon copies the file into the vault root and shows it
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
const NOW = '2026-08-26T00:00:00.000Z';

// 1x1 transparent PNG — enough to exercise the real import/read path.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function seedV2Vault(bundle: string, name: string): { storyRoot: string; notesRoot: string } {
  const storyRoot = path.join(bundle, 'Story Vault');
  const notesRoot = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(storyRoot, { recursive: true });
  fs.mkdirSync(notesRoot, { recursive: true });
  fs.writeFileSync(path.join(bundle, 'mythos.json'), JSON.stringify({
    formatVersion: 2, id: `vault-${name}`, name, createdAt: NOW,
    stories: [], seed: null,
  }, null, 2));
  return { storyRoot, notesRoot };
}

function readMythosJson(bundle: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(bundle, 'mythos.json'), 'utf-8'));
}

interface VaultSettings {
  vaultRoot?: string;
  notesVaultRoot?: string;
  recentProjects?: Array<{ name: string; vaultRoot: string; notesVaultRoot?: string; openedAt: string }>;
}

function readVaultSettings(userData: string): VaultSettings {
  return JSON.parse(fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8'));
}

function writeVaultSettings(userData: string, settings: VaultSettings): void {
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(settings, null, 2));
}

async function launchApp(userData: string, homeOverride: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
    env: { ...process.env, HOME: homeOverride, USERPROFILE: homeOverride },
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

let userData: string;
let homeOverride: string;
let bundle: string;

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11068-ud-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11068-home-'));
  bundle = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11068-vault-'));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
  fs.rmSync(bundle, { recursive: true, force: true });
});

test('TC-SKY-11068-01: glyph icon set -> persists vault-local -> survives restart -> survives vault move', async () => {
  const { storyRoot, notesRoot } = seedV2Vault(bundle, 'Icon Test Vault');
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  writeVaultSettings(userData, {
    vaultRoot: storyRoot,
    notesVaultRoot: notesRoot,
    recentProjects: [{ name: 'Icon Test Vault', vaultRoot: storyRoot, notesVaultRoot: notesRoot, openedAt: NOW }],
  });

  // 1. Fresh boot, no icon pre-seeded — tile shows the initials default.
  let app = await launchApp(userData, homeOverride);
  try {
    let pg = await firstWindow(app);
    const tile = pg.locator(`[data-testid="nav-rail-vault-tile-${storyRoot}"]`);
    await tile.waitFor({ timeout: 30_000 });
    let avatar = tile.locator('[data-testid="vault-icon-avatar"]');
    await expect(avatar).toHaveAttribute('data-icon-kind', 'default');

    // 2. Right-click -> "Set icon" -> pick a glyph.
    await tile.click({ button: 'right' });
    await pg.locator('[data-testid="nav-rail-vault-menu"]').waitFor({ timeout: 5_000 });
    await pg.getByRole('menuitem', { name: 'Set icon' }).click();
    await pg.locator('[data-testid="nav-rail-vault-icon-edit-menu"]').waitFor({ timeout: 5_000 });
    await pg.getByRole('menuitem', { name: '📖' }).click();

    avatar = tile.locator('[data-testid="vault-icon-avatar"]');
    await expect(avatar).toHaveAttribute('data-icon-kind', 'glyph', { timeout: 10_000 });
    await expect(avatar).toHaveText('📖');

    // Real persistence — the vault's OWN mythos.json, not app-settings.
    await expect.poll(() => (readMythosJson(bundle).icon as { value?: string } | undefined)?.value, {
      timeout: 10_000,
    }).toBe('📖');
  } finally {
    await app.close().catch(() => {});
  }

  // 3. Survives restart — same paths, fresh process.
  app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    const tile = pg.locator(`[data-testid="nav-rail-vault-tile-${storyRoot}"]`);
    await tile.waitFor({ timeout: 30_000 });
    const avatar = tile.locator('[data-testid="vault-icon-avatar"]');
    await expect(avatar).toHaveAttribute('data-icon-kind', 'glyph', { timeout: 10_000 });
    await expect(avatar).toHaveText('📖');
  } finally {
    await app.close().catch(() => {});
  }

  // 4. Survives a vault move — the whole bundle relocates on disk, and
  // vault-settings is repointed at the new paths (the app's own move-vault
  // flow does the same repoint; we do it directly here to isolate the
  // icon-persistence assertion from that unrelated flow).
  const movedBundle = `${bundle}-moved`;
  fs.renameSync(bundle, movedBundle);
  const movedStoryRoot = path.join(movedBundle, 'Story Vault');
  const movedNotesRoot = path.join(movedBundle, 'Notes Vault');
  writeVaultSettings(userData, {
    vaultRoot: movedStoryRoot,
    notesVaultRoot: movedNotesRoot,
    recentProjects: [{ name: 'Icon Test Vault', vaultRoot: movedStoryRoot, notesVaultRoot: movedNotesRoot, openedAt: NOW }],
  });

  app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    const tile = pg.locator(`[data-testid="nav-rail-vault-tile-${movedStoryRoot}"]`);
    await tile.waitFor({ timeout: 30_000 });
    const avatar = tile.locator('[data-testid="vault-icon-avatar"]');
    await expect(avatar).toHaveAttribute('data-icon-kind', 'glyph', { timeout: 10_000 });
    await expect(avatar).toHaveText('📖');
  } finally {
    await app.close().catch(() => {});
    bundle = movedBundle; // afterEach cleans up the post-move path
  }
});

test('TC-SKY-11068-02: image icon — Upload image copies the file into the vault and shows it', async () => {
  const { storyRoot, notesRoot } = seedV2Vault(bundle, 'Image Icon Vault');
  const sourceImage = path.join(os.tmpdir(), `sky11068-src-${Date.now()}.png`);
  fs.writeFileSync(sourceImage, TINY_PNG);
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  writeVaultSettings(userData, {
    vaultRoot: storyRoot,
    notesVaultRoot: notesRoot,
    recentProjects: [{ name: 'Image Icon Vault', vaultRoot: storyRoot, notesVaultRoot: notesRoot, openedAt: NOW }],
  });

  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    const tile = pg.locator(`[data-testid="nav-rail-vault-tile-${storyRoot}"]`);
    await tile.waitFor({ timeout: 30_000 });

    await app.evaluate(({ dialog }, target: string) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
    }, sourceImage);

    await tile.click({ button: 'right' });
    await pg.locator('[data-testid="nav-rail-vault-menu"]').waitFor({ timeout: 5_000 });
    await pg.getByRole('menuitem', { name: 'Set icon' }).click();
    await pg.locator('[data-testid="nav-rail-vault-icon-edit-menu"]').waitFor({ timeout: 5_000 });
    await pg.getByRole('menuitem', { name: 'Upload image…' }).click();

    const avatar = tile.locator('[data-testid="vault-icon-avatar"]');
    await expect(avatar).toHaveAttribute('data-icon-kind', 'image', { timeout: 10_000 });
    await expect(avatar.locator('img')).toBeVisible();

    // Copied into the vault root — travels with it — not left at the source path.
    await expect.poll(() => (readMythosJson(bundle).icon as { file?: string } | undefined)?.file, {
      timeout: 10_000,
    }).toBe('vault-icon.png');
    expect(fs.existsSync(path.join(bundle, 'vault-icon.png'))).toBe(true);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(sourceImage, { force: true });
  }
});
