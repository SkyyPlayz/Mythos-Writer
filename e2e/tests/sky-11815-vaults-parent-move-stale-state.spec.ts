/**
 * sky-11815-vaults-parent-move-stale-state.spec.ts — SKY-11815
 *
 * Follow-on regression to the SKY-8882/10368 "Move Vaults folder" fix
 * (SKY-11154), found on the SKY-11789 owner-acceptance pass. The headline
 * SKY-8882/10368 criterion — the old vaults parent is actually gone from
 * disk after a Move — still holds and is re-asserted here as a regression
 * guard. The bug this spec targets is a follow-on: main.ts's
 * VAULT_SURFACE_MOVE_VAULTS_PARENT handler remaps every path in
 * vault-settings.json correctly, but nothing told the renderer, so:
 *
 *   1. Repro 1 — Settings > Mythos vaults kept rendering (and switching
 *      against) the pre-move vaultRoot for the rest of the session, and the
 *      switch failed because main's recent-projects allowlist only
 *      recognizes the post-move path.
 *   2. Repro 2 — the New-vault Destination field is prefilled once from a
 *      main-process round trip and never refreshed, so it kept offering the
 *      deleted pre-move Vaults folder; clicking Create would silently
 *      recreate exactly the folder Move had just removed.
 *
 * Real IPC end to end: the actual VAULT_SURFACE_MOVE_VAULTS_PARENT handler
 * runs a real fs.renameSync + remapVaultSettingsPaths + saveVaultSettings,
 * and the actual PROJECT_SWITCH / CREATE_VAULT_FROM_OPTIONS handlers run
 * against the result. Nothing on the vault-move or vault-switch seam is
 * stubbed; the only mock is `dialog.showOpenDialog` (Playwright cannot drive
 * the native OS folder picker), matching move-vault-real.spec.ts's pattern.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/sky-11815-vaults-parent-move-stale-state.spec.ts --reporter=list
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
  vaultsParentPath?: string;
  recentProjects?: Array<{ name: string; vaultRoot: string; notesVaultRoot?: string; openedAt: string }>;
}

interface Dirs {
  userData: string;
  homeOverride: string;
  vaultsParent: string;
  newGrandparent: string;
  storyA: string;
  notesA: string;
  storyB: string;
  notesB: string;
}

function readVaultSettings(userData: string): VaultSettings {
  const file = path.join(userData, 'vault-settings.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VaultSettings;
}

function makeDirs(): Dirs {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11815-ud-'));
  const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11815-home-'));
  const vaultsParent = path.join(userData, 'vaults');
  const storyA = path.join(vaultsParent, 'Alpha', 'Story Vault');
  const notesA = path.join(vaultsParent, 'Alpha', 'Notes Vault');
  const storyB = path.join(vaultsParent, 'Beta', 'Story Vault');
  const notesB = path.join(vaultsParent, 'Beta', 'Notes Vault');
  // The Move… destination picker: a fresh, empty parent folder elsewhere.
  const newGrandparent = path.join(homeOverride, 'relocated');
  fs.mkdirSync(storyA, { recursive: true });
  fs.mkdirSync(notesA, { recursive: true });
  fs.mkdirSync(storyB, { recursive: true });
  fs.mkdirSync(notesB, { recursive: true });
  fs.mkdirSync(newGrandparent, { recursive: true });

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: storyA,
      notesVaultRoot: notesA,
      vaultsParentPath: vaultsParent,
      recentProjects: [
        { name: 'Alpha', vaultRoot: storyA, notesVaultRoot: notesA, openedAt: '2026-09-01T00:00:00.000Z' },
        { name: 'Beta', vaultRoot: storyB, notesVaultRoot: notesB, openedAt: '2026-09-01T00:00:01.000Z' },
      ],
    }, null, 2),
  );

  return { userData, homeOverride, vaultsParent, newGrandparent, storyA, notesA, storyB, notesB };
}

function cleanup(dirs: Dirs): void {
  fs.rmSync(dirs.userData, { recursive: true, force: true });
  fs.rmSync(dirs.homeOverride, { recursive: true, force: true });
}

async function launchApp(dirs: Dirs): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${dirs.userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, HOME: dirs.homeOverride, USERPROFILE: dirs.homeOverride },
    timeout: 60_000,
  });

  // The ONLY fake in this spec: the native OS folder-picker dialog, mocked to
  // return the real, pre-existing `newGrandparent` directory. Everything
  // downstream (vault:surface:moveVaultsParent's real fs.renameSync +
  // remapVaultSettingsPaths + saveVaultSettings, project:switch's real
  // recent-projects allowlist check, vault:createDefaultVaultFromOptions's
  // real destination handling) runs unmodified.
  await app.evaluate(({ dialog }, newGrandparent: string) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [newGrandparent] })) as typeof dialog.showOpenDialog;
  }, dirs.newGrandparent);

  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function openSettingsOnVaultsTab(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('#settings-category-tab-vaults').click();
  await expect(page.locator('[data-testid="vaults-folder-path"]')).toBeVisible({ timeout: 10_000 });
}

test('Vaults folder Move refreshes the vault list, switch, and New-vault Destination — no stale pre-move state', async () => {
  const dirs = makeDirs();
  const app = await launchApp(dirs);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    await openSettingsOnVaultsTab(page);
    await expect(page.locator('[data-testid="vaults-folder-path"]')).toHaveText(dirs.vaultsParent);

    // Real vault:surface:moveVaultsParent — real fs.renameSync + real
    // remapVaultSettingsPaths + real saveVaultSettings. Scoped to the
    // "Vaults folder" section — its Move… button shares a data-testid with
    // the unrelated single-vault Sync & Backup "Move vault…" flow.
    const vaultsFolderSection = page.locator('section[aria-labelledby="section-vaults-folder"]');
    await vaultsFolderSection.locator('[data-testid="move-vault-btn"]').click();
    await expect(page.locator('[data-testid="vaults-folder-move-dialog"]')).toBeVisible();
    await page.locator('[data-testid="vaults-folder-move-dest-browse"]').click();
    await expect(page.locator('[data-testid="vaults-folder-move-dest-path"]')).toHaveText(dirs.newGrandparent);
    await page.locator('[data-testid="vaults-folder-move-confirm"]').click();
    await expect(page.locator('[data-testid="vaults-folder-move-dialog"]')).not.toBeVisible({ timeout: 15_000 });

    const movedParent = path.join(dirs.newGrandparent, path.basename(dirs.vaultsParent));
    const movedStoryA = path.join(movedParent, 'Alpha', 'Story Vault');
    const movedNotesA = path.join(movedParent, 'Alpha', 'Notes Vault');
    const movedStoryB = path.join(movedParent, 'Beta', 'Story Vault');

    // SKY-8882/10368 regression guard: the headline criterion this ticket
    // must NOT regress — the old parent is really gone from disk.
    expect(fs.existsSync(dirs.vaultsParent)).toBe(false);
    expect(fs.existsSync(movedStoryA)).toBe(true);
    await expect.poll(() => readVaultSettings(dirs.userData).vaultRoot, { timeout: 10_000 }).toBe(movedStoryA);
    await expect.poll(() => readVaultSettings(dirs.userData).vaultsParentPath, { timeout: 10_000 }).toBe(movedParent);

    // The row itself refreshes via its own local `refresh()` call.
    await expect(page.locator('[data-testid="vaults-folder-path"]')).toHaveText(movedParent);

    // Repro 1: Settings > Mythos vaults must show the POST-move path for
    // Beta, and switching to it via its card must actually succeed — before
    // the fix, the card kept the pre-move `dirs.storyB` path and the switch
    // failed the recent-projects allowlist every time.
    await page.locator('#settings-category-tab-vaults').click();
    await expect(page.locator(`[data-testid="mvs-card-${movedStoryB}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="mvs-card-${dirs.storyB}"]`)).toHaveCount(0);

    await page.locator(`[data-testid="mvs-card-${movedStoryB}"]`).click();
    await expect.poll(() => readVaultSettings(dirs.userData).vaultRoot, { timeout: 10_000 }).toBe(movedStoryB);
    // A completed switch remounts SettingsPanel back to its default category
    // (see sky-11048's note on this) — re-select Vault & Files to re-assert.
    await page.locator('#settings-category-tab-vaults').click();
    await expect(page.locator(`[data-testid="mvs-card-${movedStoryB}"]`)).toHaveAttribute(
      'aria-label', /Current vault/, { timeout: 10_000 },
    );

    // Switch back to Alpha through the nav rail so its active tile is
    // provable too (repro 1 also covers the nav-rail, which shares the same
    // projectList fetch this pushes) — close Settings first, it's a modal
    // and would intercept the rail click.
    await page.locator('.settings-close').click();
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator(`[data-testid="nav-rail-vault-tile-${movedStoryA}"]`)).toBeVisible({ timeout: 10_000 });
    await page.locator(`[data-testid="nav-rail-vault-tile-${movedStoryA}"]`).click();
    await expect.poll(() => readVaultSettings(dirs.userData).vaultRoot, { timeout: 10_000 }).toBe(movedStoryA);
    await expect(page.locator(`[data-testid="nav-rail-vault-tile-${movedStoryA}"]`)).toHaveClass(
      /nav-rail__vault-tile--active/,
    );

    // Repro 2: "New vault…" Destination must prefill from the CURRENT
    // (post-move) parent, not the deleted pre-move one — before the fix this
    // read the wrong vaultGetPaths field, and a Create here would have
    // silently recreated `dirs.vaultsParent` on disk.
    await openSettingsOnVaultsTab(page);
    await page.locator('[data-testid="mvs-new-vault"]').click();
    await page.locator('[data-testid="mvs-choose-blank"]').click();
    await expect(page.locator('[data-testid="mvs-create-dest-path"]')).toHaveText(movedParent, { timeout: 10_000 });

    await page.locator('[data-testid="mvs-create-name"]').fill('Gamma');
    await page.locator('[data-testid="mvs-create-confirm"]').click();
    await expect(page.locator('[data-testid="mvs-create-done"]')).toBeVisible({ timeout: 15_000 });

    // The new vault landed under the CURRENT parent — the deleted pre-move
    // folder was never resurrected.
    expect(fs.existsSync(dirs.vaultsParent)).toBe(false);
    expect(fs.existsSync(path.join(movedParent, 'Gamma', 'Stories', 'Story Vault'))).toBe(true);
  } finally {
    await app.close().catch(() => {});
    cleanup(dirs);
  }
});
