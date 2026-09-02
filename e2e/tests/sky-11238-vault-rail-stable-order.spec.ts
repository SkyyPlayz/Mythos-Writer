/**
 * sky-11238-vault-rail-stable-order.spec.ts — SKY-11238
 *
 * Owner-reported: the vault rail reordered itself on every switch (the active
 * vault's tile jumped), breaking muscle memory. The registry behind the rail
 * (`recentProjects` in vault-settings.json) was MRU; it is now order-stable.
 *
 * The defect was purely positional, so this spec asserts FULL tile order
 * before and after every switch — an activation-only assertion would pass
 * against the old MRU behavior and miss the bug entirely:
 *   1. three seeded vaults render in registry order
 *   2. switching vaults changes NO tile's position — twice, to different
 *      targets — while the active highlight moves in place
 *   3. the order survives an app restart (launch re-registers the active
 *      vault, which must refresh in place, not move to the front)
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
import { closeElectronApp } from '../helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const NOW = '2026-09-01T00:00:00.000Z';

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

interface VaultSettings {
  vaultRoot?: string;
  notesVaultRoot?: string;
  recentProjects?: Array<{ name: string; vaultRoot: string; notesVaultRoot?: string; openedAt: string }>;
}

function readVaultSettings(userData: string): VaultSettings {
  return JSON.parse(fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8'));
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

/** DOM order of the rail's vault tiles, as story-vault roots. */
async function tileOrder(pg: Page): Promise<string[]> {
  const tiles = pg.locator('.nav-rail__vault-tile');
  const count = await tiles.count();
  const roots: string[] = [];
  for (let i = 0; i < count; i++) {
    const testid = await tiles.nth(i).getAttribute('data-testid');
    roots.push((testid ?? '').replace('nav-rail-vault-tile-', ''));
  }
  return roots;
}

async function expectTileOrder(pg: Page, roots: string[]): Promise<void> {
  await expect.poll(() => tileOrder(pg), { timeout: 15_000 }).toEqual(roots);
}

let userData: string;
let homeOverride: string;
let bundles: string[];

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11238-ud-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11238-home-'));
  bundles = ['A', 'B', 'C'].map((n) => fs.mkdtempSync(path.join(os.tmpdir(), `sky11238-vault${n}-`)));
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
  for (const b of bundles) fs.rmSync(b, { recursive: true, force: true });
});

test('TC-SKY-11238-01: tile positions survive switches and a restart; only the highlight moves', async () => {
  const [alpha, beta, gamma] = bundles.map((bundle, i) => seedV2Vault(bundle, `Vault ${'ABC'[i]}`));

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, theme: 'dark',
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: alpha.storyRoot,
    notesVaultRoot: alpha.notesRoot,
    layoutMode: 'default',
    recentProjects: [
      { name: 'Vault A', vaultRoot: alpha.storyRoot, notesVaultRoot: alpha.notesRoot, openedAt: NOW },
      { name: 'Vault B', vaultRoot: beta.storyRoot, notesVaultRoot: beta.notesRoot, openedAt: NOW },
      { name: 'Vault C', vaultRoot: gamma.storyRoot, notesVaultRoot: gamma.notesRoot, openedAt: NOW },
    ],
  }, null, 2));

  const registryOrder = [alpha.storyRoot, beta.storyRoot, gamma.storyRoot];
  const activeTile = (pg: Page, root: string) =>
    pg.locator(`[data-testid="nav-rail-vault-tile-${root}"]`);

  let app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await pg.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });

    // 1. Seeded registry order renders verbatim; the active vault is FIRST
    // (under the old MRU code launch would already have kept it first, so the
    // meaningful checks are the post-switch ones below).
    await expectTileOrder(pg, registryOrder);
    await expect(activeTile(pg, alpha.storyRoot)).toHaveClass(/nav-rail__vault-tile--active/);

    // 2a. Switch A → B: every tile keeps its position; only the highlight
    // moves. The active-class assertion runs FIRST — it auto-retries until
    // the renderer has processed the switch, so the order check that follows
    // samples the post-switch rail, not a mid-switch one.
    await activeTile(pg, beta.storyRoot).click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, {
      timeout: 30_000, intervals: [200, 400, 800, 1000],
    }).toBe(beta.storyRoot);
    await expect(activeTile(pg, beta.storyRoot)).toHaveClass(/nav-rail__vault-tile--active/, { timeout: 15_000 });
    await expect(activeTile(pg, alpha.storyRoot)).not.toHaveClass(/nav-rail__vault-tile--active/);
    await expectTileOrder(pg, registryOrder);

    // 2b. Switch B → C (a middle→last hop, so a move-to-front AND a
    // move-to-bottom regression would both be caught).
    await activeTile(pg, gamma.storyRoot).click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, {
      timeout: 30_000, intervals: [200, 400, 800, 1000],
    }).toBe(gamma.storyRoot);
    await expect(activeTile(pg, gamma.storyRoot)).toHaveClass(/nav-rail__vault-tile--active/, { timeout: 15_000 });
    await expectTileOrder(pg, registryOrder);

    // The persisted registry itself must be untouched too — it is what every
    // other surface (title-bar switcher, Settings) renders.
    expect((readVaultSettings(userData).recentProjects ?? []).map((p) => p.vaultRoot))
      .toEqual(registryOrder);
  } finally {
    await closeElectronApp(app);
  }

  // 3. Restart with C active: launch re-registers the active vault — the
  // order must come back identical, not C-first.
  app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await pg.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });
    await expectTileOrder(pg, registryOrder);
    await expect(activeTile(pg, gamma.storyRoot)).toHaveClass(/nav-rail__vault-tile--active/);
  } finally {
    await closeElectronApp(app);
  }
});
