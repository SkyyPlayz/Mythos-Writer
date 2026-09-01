/**
 * vault-open-folder-guard-sky11132.spec.ts — SKY-11132 (owner data-safety bug)
 *
 * Root cause: `vault:open-folder` (window.api.openVaultFolder — wired up in
 * the UI as VaultBrowser's "Open a Mythos vault…" row, formerly mislabeled
 * "Import a vault…") accepted ANY OS-dialog folder unconditionally and
 * immediately repointed the Story Vault at it, then called ensureVaultDir(),
 * which seeded app files (.mythos-seeded, manifest.json, the .mythos/ runtime
 * dir) directly into whatever was picked — no copy, no validation. That is
 * how the owner's real Obsidian vault (a non-empty folder with a `.obsidian`
 * subdirectory) got adopted as the Story Vault and had app files written
 * into it, in violation of the 2026-08-14 copy-only ruling (SKY-10370
 * R2/R3, SKY-10385).
 *
 * The M24 "Import another vault" flow (ImportVaultSection.tsx ->
 * vault:import-run -> convertVaultSource -> obsidianImporter.ts) was already
 * copy-only and already covered by e2e/obsidian-import-fidelity.spec.ts —
 * that surface was never the bug. This spec covers the surface that was:
 * checkOpenFolderGate (vaultGate.ts) now refuses to adopt a non-empty folder
 * that isn't already a recognized Mythos vault, real IPC end to end.
 *
 * Real IPC, no stub: only dialog.showOpenDialog is patched (Playwright
 * cannot drive the native OS picker), matching the accepted pattern in
 * e2e/obsidian-import-fidelity.spec.ts and e2e/export-formats.spec.ts.
 *
 * Windows-only guard on the notes-windows CI job: mtime/content preservation
 * on a real Obsidian-shaped folder is exactly the class of bug that native
 * Windows filesystem semantics (case-insensitive paths, Explorer/Defender
 * touching files) can hide from POSIX runners — see the CI job comment in
 * .github/workflows/ci.yml.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/vault-open-folder-guard-sky11132.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

interface FileSnapshot {
  rel: string;
  mtimeMs: number;
  size: number;
  content: Buffer;
}

/** A small but representative real-looking Obsidian vault — non-empty,
 *  carries a `.obsidian` config directory, has real user notes. */
function buildObsidianFixture(root: string): void {
  fs.mkdirSync(path.join(root, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{}');
  fs.mkdirSync(path.join(root, 'Daily Notes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'Daily Notes', '2026-08-14.md'),
    '# 2026-08-14\n\nReal notes the owner wrote himself — must never be touched.\n',
  );
  fs.writeFileSync(path.join(root, 'Ideas.md'), '# Ideas\n\nSomething I do not want mutated.\n');
}

/** Recursively snapshot every file under root: relative path, mtime, size,
 *  and content — enough to prove byte-for-byte + timestamp preservation. */
function snapshotDir(root: string, base = ''): FileSnapshot[] {
  const out: FileSnapshot[] = [];
  for (const entry of fs.readdirSync(path.join(root, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(root, rel);
    if (entry.isDirectory()) {
      out.push(...snapshotDir(root, rel));
    } else if (entry.isFile()) {
      const stat = fs.statSync(full);
      out.push({ rel, mtimeMs: stat.mtimeMs, size: stat.size, content: fs.readFileSync(full) });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function seedCompletedOnboarding(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

/** Patch ONLY dialog.showOpenDialog to return dir (real vault:open-folder IPC runs). */
async function patchOpenDialog(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, { d }: { d: string }) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [d],
    });
  }, { d: dir });
}

async function firstReadyWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  return page;
}

test('SKY-11132: opening a real Obsidian vault via Open Vault Folder is refused and the source is byte-for-byte, mtime-for-mtime unchanged', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-open-folder-guard-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(tempRoot, 'Story Vault');
  const notesVault = path.join(tempRoot, 'Notes Vault');
  const obsidianVault = path.join(tempRoot, 'Obsidian Vault');

  fs.mkdirSync(obsidianVault, { recursive: true });
  buildObsidianFixture(obsidianVault);
  seedCompletedOnboarding(userData, storyVault, notesVault);

  // Snapshot the source BEFORE any app interaction — this is the "SOURCE
  // folder's contents and mtimes" the fix must never touch.
  const before = snapshotDir(obsidianVault);
  expect(before.length).toBeGreaterThan(0);

  const app = await launchApp(userData);
  try {
    await patchOpenDialog(app, obsidianVault);
    const page = await firstReadyWindow(app);

    // Real IPC end to end: renderer -> preload -> vault:open-folder ->
    // checkOpenFolderGate -> (refused, so nothing below the gate runs).
    const result = await page.evaluate(() => window.api!.openVaultFolder!());

    expect(result.cancelled).toBe(false);
    expect(result.vaultRoot).toBeNull();
    expect(result.error, 'the picked Obsidian vault must be refused with an explanatory error').toBeTruthy();
    expect(result.error).toMatch(/Obsidian vault, not a Mythos vault/);
    expect(result.error).toMatch(/Import another vault/);

    // ── Assert against real disk state — no mocking below this point ──────

    // Story Vault must still be the original vault, never repointed.
    const settingsPath = path.join(userData, 'vault-settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { vaultRoot: string };
    expect(settings.vaultRoot).toBe(storyVault);
    expect(settings.vaultRoot).not.toBe(obsidianVault);

    // No app files were ever written into the Obsidian vault: same file set,
    // same bytes, same mtimes as the pre-launch snapshot.
    const after = snapshotDir(obsidianVault);
    expect(after.map((f) => f.rel)).toEqual(before.map((f) => f.rel));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].size, `${before[i].rel} size changed`).toBe(before[i].size);
      expect(after[i].content.equals(before[i].content), `${before[i].rel} content changed`).toBe(true);
      expect(after[i].mtimeMs, `${before[i].rel} mtime changed`).toBe(before[i].mtimeMs);
    }

    // None of the app's own scaffold markers ever landed in the source.
    for (const marker of ['.mythos-seeded', 'manifest.json', '.mythos', 'stories', '.snapshots']) {
      expect(fs.existsSync(path.join(obsidianVault, marker)), `${marker} must never appear in the source`).toBe(false);
    }
  } finally {
    await app.close();
  }
});

test('SKY-11132 control: Open Vault Folder still works for an empty folder (guard does not over-block legitimate use)', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-open-folder-guard-ok-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(tempRoot, 'Story Vault');
  const notesVault = path.join(tempRoot, 'Notes Vault');
  const emptyTarget = path.join(tempRoot, 'Fresh Vault Location');
  fs.mkdirSync(emptyTarget, { recursive: true });

  seedCompletedOnboarding(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  try {
    await patchOpenDialog(app, emptyTarget);
    const page = await firstReadyWindow(app);

    const result = await page.evaluate(() => window.api!.openVaultFolder!());

    expect(result.error).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect(result.vaultRoot).toBe(emptyTarget);

    const settingsPath = path.join(userData, 'vault-settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { vaultRoot: string };
    expect(settings.vaultRoot).toBe(emptyTarget);
  } finally {
    await app.close();
  }
});
