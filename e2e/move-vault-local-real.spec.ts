/**
 * move-vault-local-real.spec.ts — SKY-10367
 *
 * Real E2E for the default local-folder path through the Move Vault wizard:
 * launches the actual Electron app, drives Settings → Sync & Backup → Move
 * vault… straight through the local folder step (no provider selection, no
 * sync-client confirmation checkbox), and lets the genuine
 * `vault:localFolderMove` IPC handler perform a real `fs.rename` on disk.
 * Nothing on the local-move seam is stubbed.
 *
 * The only mock is `dialog.showOpenDialog` — Playwright cannot drive the
 * native OS folder picker, so we fake that single native call to return a
 * real, pre-existing empty directory. The chosen target deliberately sits
 * OUTSIDE the user's home directory (unlike move-vault-real.spec.ts's cloud
 * target) to prove the local-move gate (checkSinglePathGate) authorises any
 * user-picked path, not just locations under $HOME the way the cloud-sync
 * gate does.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/move-vault-local-real.spec.ts --reporter=list
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
  outsideRoot: string;
  userData: string;
  storyVault: string;
  notesVault: string;
  targetVault: string;
}

function makeDirs(): Dirs {
  const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-move-vault-local-home-'));
  // Deliberately outside homeRoot — the local-move gate must accept this.
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-move-vault-local-external-'));
  const userData = path.join(homeRoot, 'user-data');
  const storyVault = path.join(homeRoot, 'Story Vault');
  const notesVault = path.join(homeRoot, 'Notes Vault');
  const targetVault = path.join(outsideRoot, 'MythosVault');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.mkdirSync(targetVault, { recursive: true }); // pre-existing empty destination folder
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

  return { homeRoot, outsideRoot, userData, storyVault, notesVault, targetVault };
}

function cleanup(dirs: Dirs): void {
  fs.rmSync(dirs.homeRoot, { recursive: true, force: true });
  fs.rmSync(dirs.outsideRoot, { recursive: true, force: true });
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
  // vault:localFolderMove's gate + fs.rename) is untouched.
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

test('Move Vault wizard defaults to a local folder move with no stubbed IPC handler', async () => {
  const dirs = makeDirs();
  const app = await launchApp(dirs);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

    await openSettingsOnSyncTab(page);
    await expect(page.locator('[data-testid="sync-vault-path"]')).toHaveText(dirs.storyVault);

    await page.locator('[data-testid="sync-move-vault"]').click();

    // Step 0 — local folder is the default entry point; no provider list,
    // no "cloud sync" title.
    await expect(page.getByRole('dialog', { name: /move vault to a different folder/i })).toBeVisible();
    await expect(page.locator('[data-testid="provider-option-dropbox"]')).toHaveCount(0);

    // Browse triggers the real vault:pick-folder handler, which calls
    // dialog.showOpenDialog (mocked above) and mints a real one-shot
    // registration token bound to the returned path.
    await page.locator('[data-testid="mv-browse"]').click();
    await expect(page.locator('[data-testid="mv-folder-display"]')).toHaveValue(dirs.targetVault);
    await page.locator('[data-testid="mv-next-folder"]').click();

    // Step 1 — confirm. No sync-client checkbox gate for a local move.
    await expect(page.locator('[data-testid="mv-from-path"]')).toContainText(dirs.storyVault);
    await expect(page.locator('[data-testid="mv-to-path"]')).toContainText(dirs.targetVault);
    await expect(page.locator('[data-testid="mv-confirm-checkbox"]')).toHaveCount(0);
    await page.locator('[data-testid="mv-proceed-confirm"]').click();

    // Step 2 — real vault:validate-path write-access check, then real
    // vault:localFolderMove (checkSinglePathGate + fs.promises.rename).
    await expect(page.locator('[data-testid="mv-test-ok"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="mv-migrate"]').click();

    // Step 3 — result
    await expect(page.locator('[data-testid="mv-success-message"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="mv-new-path"]')).toContainText(dirs.targetVault);
    await page.locator('[data-testid="mv-done"]').click();
    await expect(page.locator('[data-testid="sync-vault-path"]')).toHaveText(dirs.targetVault);

    // ── Disk assertions: real move, not a stub ────────────────────────────
    // Old location no longer holds vault files (fs.rename removed the source dir).
    expect(fs.existsSync(dirs.storyVault), `stale source vault still on disk at ${dirs.storyVault}`).toBe(false);

    const movedFiles = listFilesRecursive(dirs.targetVault);
    expect(movedFiles).toContain('manifest.json');
    expect(movedFiles).toContain(path.join('stories', 'story-1', 'chapters', 'chapter-1', 'scenes', 'Opening.md'));
    expect(movedFiles).toContain(path.join('.mythos', 'settings_audit.log'));

    const auditLog = JSON.parse(
      fs.readFileSync(path.join(dirs.targetVault, '.mythos', 'settings_audit.log'), 'utf-8').trim().split('\n').pop()!,
    );
    expect(auditLog.action).toBe('vault:localFolderMove');
    expect(auditLog.syncProvider).toBe('local');

    // guidedFolderMove/localFolderMove only relocates the Story Vault; the
    // separate Notes Vault is untouched by design.
    expect(fs.existsSync(dirs.notesVault)).toBe(true);

    const vaultSettings = JSON.parse(fs.readFileSync(path.join(dirs.userData, 'vault-settings.json'), 'utf-8'));
    expect(vaultSettings.vaultRoot).toBe(dirs.targetVault);
  } finally {
    await app.close().catch(() => undefined);
    cleanup(dirs);
  }
});
