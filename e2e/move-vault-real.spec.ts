/**
 * move-vault-real.spec.ts — SKY-8006
 *
 * Real E2E for the Move Vault wizard: launches the actual Electron app,
 * drives Settings → Sync & Backup → Move vault… through every wizard step,
 * and lets the genuine `vault:guidedFolderMove` IPC handler perform a real
 * `fs.rename` on disk. Nothing on the guided-move seam is stubbed.
 *
 * The only mock in this spec is `dialog.showOpenDialog` at the Electron
 * `dialog` module — Playwright cannot drive the native OS folder picker, so
 * we fake *that* single native call to return a real, pre-existing empty
 * directory. Everything downstream of it (`vault:pick-folder`'s real
 * registration-token issuance, `vault:validate-path`, `vault:guidedFolderMove`'s
 * gate + `fs.rename`) runs unmodified. Contrast with e2e/cloud-sync.spec.ts,
 * which stubs `vault:pick-folder` and `vault:guidedFolderMove` themselves via
 * `ipcMain.handle` overrides and is skipped (SKY-6933) — that spec never
 * exercises a real move.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/move-vault-real.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

interface Dirs {
  homeRoot: string;
  userData: string;
  storyVault: string;
  notesVault: string;
  targetVault: string;
}

function makeDirs(): Dirs {
  // vault:guidedFolderMove requires targetPath to be a strict child of
  // app.getPath('home') (vaultGate.ts checkGuidedMoveGate). We control that by
  // overriding HOME to a temp root and keeping every path under it.
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-move-vault-home-'));
  const userData = path.join(homeRoot, 'user-data');
  const storyVault = path.join(homeRoot, 'Story Vault');
  const notesVault = path.join(homeRoot, 'Notes Vault');
  const targetVault = path.join(homeRoot, 'Dropbox', 'Mythos Story Vault');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.mkdirSync(targetVault, { recursive: true }); // pre-existing empty synced folder
  fs.mkdirSync(path.join(storyVault, 'stories', 'story-1', 'chapters', 'chapter-1', 'scenes'), { recursive: true });

  fs.writeFileSync(
    path.join(storyVault, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        version: 1,
        vaultRoot: storyVault,
        stories: [
          {
            id: 'story-1',
            title: 'Vault Chronicles',
            chapters: [
              {
                id: 'chapter-1',
                title: 'The First Chamber',
                scenes: [{ id: 'scene-1', title: 'Opening', path: 'stories/story-1/chapters/chapter-1/scenes/Opening.md' }],
              },
            ],
          },
        ],
        entities: [],
        suggestions: [],
        provenance: [],
        boards: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(storyVault, 'stories', 'story-1', 'chapters', 'chapter-1', 'scenes', 'Opening.md'),
    'The vault held every secret the kingdom had ever kept.\n',
  );

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );

  return { homeRoot, userData, storyVault, notesVault, targetVault };
}

function cleanup(dirs: Dirs): void {
  fs.rmSync(dirs.homeRoot, { recursive: true, force: true });
}

/** Recursively collect all file paths under `dir`, relative to `dir`. */
function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full).map((f) => path.join(entry.name, f)));
    else out.push(entry.name);
  }
  return out;
}

/** Poll predicate until it returns true or timeoutMs elapses. */
async function waitUntil(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function launchApp(dirs: Dirs): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${dirs.userData}`, '--no-sandbox', ...extraArgs],
    env: { ...process.env, HOME: dirs.homeRoot },
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));

  // The ONLY fake in this spec: the native OS folder-picker dialog. Everything
  // downstream (vault:pick-folder's real token issuance, vault:validate-path,
  // vault:guidedFolderMove's gate + fs.rename) is untouched.
  await app.evaluate(({ dialog }, targetVault: string) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [targetVault] })) as typeof dialog.showOpenDialog;
  }, dirs.targetVault);

  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function openSettingsOnSyncTab(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 5_000 });
  await page.getByRole('tab', { name: 'Sync & Backup' }).click();
}

test('Move Vault wizard performs a real fs move with no stubbed IPC handler', async () => {
  const dirs = makeDirs();
  const app = await launchApp(dirs);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    await openSettingsOnSyncTab(page);
    await expect(page.locator('[data-testid="sync-vault-path"]')).toHaveText(dirs.storyVault);

    await page.locator('[data-testid="sync-move-vault"]').click();
    await expect(page.getByRole('dialog', { name: /move vault to cloud sync/i })).toBeVisible();

    // Step 0 — provider
    await page.locator('[data-testid="provider-option-dropbox"]').click();
    await page.locator('[data-testid="mv-next-provider"]').click();

    // Step 1 — folder. Browse triggers the real vault:pick-folder handler,
    // which calls dialog.showOpenDialog (mocked above) and mints a real
    // one-shot registration token bound to the returned path.
    await page.locator('[data-testid="mv-browse"]').click();
    await expect(page.locator('[data-testid="mv-folder-display"]')).toHaveValue(dirs.targetVault);
    await page.locator('[data-testid="mv-next-folder"]').click();

    // Step 2 — confirm
    await expect(page.locator('[data-testid="mv-from-path"]')).toContainText(dirs.storyVault);
    await expect(page.locator('[data-testid="mv-to-path"]')).toContainText(dirs.targetVault);
    await page.locator('[data-testid="mv-confirm-checkbox"]').check();
    await page.locator('[data-testid="mv-proceed-confirm"]').click();

    // Step 3 — real vault:validate-path write-access check, then real
    // vault:guidedFolderMove (gate validation + fs.promises.rename).
    await expect(page.locator('[data-testid="mv-test-ok"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="mv-migrate"]').click();

    // Step 4 — result
    await expect(page.locator('[data-testid="mv-success-message"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="mv-new-path"]')).toContainText(dirs.targetVault);
    await page.locator('[data-testid="mv-done"]').click();
    await expect(page.locator('[data-testid="sync-vault-path"]')).toHaveText(dirs.targetVault);

    // ── Disk assertions: real move, not a stub ────────────────────────────
    // Old location no longer holds vault files (fs.rename removed the source dir).
    expect(fs.existsSync(dirs.storyVault), `stale source vault still on disk at ${dirs.storyVault}`).toBe(false);

    // New location has the full file set: manifest, scene prose, and the
    // guided-move audit log.
    const movedFiles = listFilesRecursive(dirs.targetVault);
    expect(movedFiles).toContain('manifest.json');
    expect(movedFiles).toContain(path.join('stories', 'story-1', 'chapters', 'chapter-1', 'scenes', 'Opening.md'));
    expect(movedFiles).toContain(path.join('.mythos', 'settings_audit.log'));
    expect(
      fs.readFileSync(path.join(dirs.targetVault, 'stories', 'story-1', 'chapters', 'chapter-1', 'scenes', 'Opening.md'), 'utf-8'),
    ).toContain('The vault held every secret the kingdom had ever kept.');

    // guidedFolderMove only relocates the Story Vault; the separate Notes
    // Vault is untouched by design (getVaultRoot() vs getNotesVaultRoot()).
    expect(fs.existsSync(dirs.notesVault)).toBe(true);

    // vault-settings.json (config) was updated in place to point at the new location.
    const vaultSettings = JSON.parse(fs.readFileSync(path.join(dirs.userData, 'vault-settings.json'), 'utf-8'));
    expect(vaultSettings.vaultRoot).toBe(dirs.targetVault);

    await app.close().catch(() => undefined);

    // ── Restart: app must re-point at the new location and read/write there ──
    const app2 = await launchApp(dirs);
    try {
      const page2 = await firstWindow(app2);
      await expect(page2.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
      // No "vault not found" recovery screen — app booted straight into the moved vault.
      await expect(page2.locator('.vault-not-found, [data-testid="vault-not-found"]')).toHaveCount(0);

      await openSettingsOnSyncTab(page2);
      await expect(page2.locator('[data-testid="sync-vault-path"]')).toHaveText(dirs.targetVault);
      await page2.locator('[role="dialog"][aria-label="Settings"] .settings-close').click();

      // Write proof: open the migrated scene, type new prose, and confirm the
      // write lands in the .md file at the NEW location (read via editor +
      // write via vault:write both round-trip against the moved vault).
      const storiesPanel = page2.locator('[data-panel-id="stories"]');
      if (await storiesPanel.isVisible().catch(() => false)) {
        const collapsed = await storiesPanel
          .evaluate((el) => el.classList.contains('lr-panel--collapsed'))
          .catch(() => false);
        if (collapsed) await storiesPanel.locator('.lr-panel-collapse-btn').click();
      }
      const sceneRow = page2.locator('.nav-scene-row', { hasText: 'Opening' }).first();
      await expect(sceneRow).toBeVisible({ timeout: 8_000 });
      await sceneRow.click();

      const editor = page2.locator('.ProseMirror');
      await expect(editor).toBeVisible({ timeout: 8_000 });
      // Read proof: the moved file's prose loaded into the editor.
      await expect(editor).toContainText('The vault held every secret the kingdom had ever kept.');

      await page2.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'));
      await page2.keyboard.press('End');
      const APPENDED_PROSE = ' Post-move addendum: sync restored.';
      await page2.keyboard.type(APPENDED_PROSE);
      await expect(editor).toContainText(APPENDED_PROSE);

      const scenePath = path.join(dirs.targetVault, 'stories', 'story-1', 'chapters', 'chapter-1', 'scenes', 'Opening.md');
      const writeFlushed = await waitUntil(
        () => fs.existsSync(scenePath) && fs.readFileSync(scenePath, 'utf-8').includes(APPENDED_PROSE),
        12_000,
      );
      expect(writeFlushed, `Post-restart edit not flushed to ${scenePath}`).toBe(true);
      expect(fs.existsSync(dirs.storyVault), 'old vault location resurrected after restart').toBe(false);
    } finally {
      await app2.close().catch(() => undefined);
    }
  } finally {
    await app.close().catch(() => undefined);
    cleanup(dirs);
  }
});
