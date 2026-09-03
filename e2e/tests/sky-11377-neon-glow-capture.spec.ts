/**
 * sky-11377-neon-glow-capture.spec.ts — SKY-11390 real-render evidence
 *
 * Not a permanent regression spec — a one-shot capture harness that boots the
 * ACTUAL built Electron binary (out/main/main.js), seeds 3 real vaults on
 * disk, switches between them, and screenshots the nav rail so PR #1438 gets
 * a genuine render instead of a static HTML mockup. Also asserts exactly one
 * tile carries `.nav-rail__vault-tile--active` at every step — DOM-verified,
 * not just visual — per SKY-11377's acceptance criteria (correct binding,
 * 3+ vaults, no stale frame on switch).
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
const NOW = '2026-09-03T00:00:00.000Z';
const SHOTS_DIR = path.resolve(__dirname, '../../../sky11377-real-shots');

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
  await pg.setViewportSize({ width: 1440, height: 900 });
  return pg;
}

async function assertExactlyOneActive(pg: Page, expectedRoot: string): Promise<void> {
  const active = pg.locator('.nav-rail__vault-tile--active');
  await expect(active).toHaveCount(1, { timeout: 15_000 });
  await expect(active).toHaveAttribute('data-testid', `nav-rail-vault-tile-${expectedRoot}`);
}

let userData: string;
let homeOverride: string;
let bundles: string[];

test.beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11377cap-ud-'));
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11377cap-home-'));
  bundles = ['A', 'B', 'C'].map((n) => fs.mkdtempSync(path.join(os.tmpdir(), `sky11377cap-vault${n}-`)));
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
});

test.afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
  for (const b of bundles) fs.rmSync(b, { recursive: true, force: true });
});

test('TC-SKY-11390-01: neon-glow active tile tracks the real open vault across 3 vaults', async () => {
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

  const activeTile = (pg: Page, root: string) =>
    pg.locator(`[data-testid="nav-rail-vault-tile-${root}"]`);
  const rail = (pg: Page) => pg.locator('[data-testid="nav-rail-vaults"]');

  const app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await rail(pg).waitFor({ timeout: 30_000 });

    // A is open at launch — real render #1.
    await assertExactlyOneActive(pg, alpha.storyRoot);
    await rail(pg).screenshot({ path: path.join(SHOTS_DIR, '01-vault-A-active.png') });

    // Switch to C (skip a tile, not just A<->B, to rule out an off-by-one).
    await activeTile(pg, gamma.storyRoot).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8')).vaultRoot, {
      timeout: 30_000, intervals: [200, 400, 800, 1000],
    }).toBe(gamma.storyRoot);
    await assertExactlyOneActive(pg, gamma.storyRoot);
    await rail(pg).screenshot({ path: path.join(SHOTS_DIR, '02-vault-C-active.png') });

    // Switch to B.
    await activeTile(pg, beta.storyRoot).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8')).vaultRoot, {
      timeout: 30_000, intervals: [200, 400, 800, 1000],
    }).toBe(beta.storyRoot);
    await assertExactlyOneActive(pg, beta.storyRoot);
    await rail(pg).screenshot({ path: path.join(SHOTS_DIR, '03-vault-B-active.png') });

    // Back to A — repeated switching (acceptance criterion 1), no stale frame.
    await activeTile(pg, alpha.storyRoot).click();
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8')).vaultRoot, {
      timeout: 30_000, intervals: [200, 400, 800, 1000],
    }).toBe(alpha.storyRoot);
    await assertExactlyOneActive(pg, alpha.storyRoot);

    // Full-window shot for PR evidence: rail + whichever surface is open,
    // proving this is the real app, not an isolated component mock.
    await pg.screenshot({ path: path.join(SHOTS_DIR, '04-full-window-vault-A-active.png') });
  } finally {
    await closeElectronApp(app);
  }
});
