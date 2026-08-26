/**
 * windows-vault-migration-lifecycle.spec.ts — SKY-10910
 *
 * Native-Windows port of mythos-migration.spec.ts's TC-BM-01 (silent
 * boot-time v0.4 → MythosVault v2 migration, `mythosMigrationStatus` /
 * `MythosMigrationCenter.tsx` path). The migrator copies a full vault tree
 * (manifest, scenes, comments sidecars, notes) into a sibling
 * "<name> (MythosVault)" folder and only then repoints vault-settings.json —
 * every step of that copy/verify/switch sequence touches real directories
 * and file handles, which is exactly the surface where POSIX and Windows
 * filesystem semantics diverge (open-handle renames/deletes, path
 * separators). This had no native-Windows E2E coverage before this suite.
 *
 * Run:
 *   npx playwright test e2e/tests/windows-vault-migration-lifecycle.spec.ts --reporter=list
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
const PROSE = 'The gate had waited under the sea, and it recognized her.';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** Write a small v0.4 vault with real user content (1 story, comments, a note). */
function seedV04Content(vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(path.join(vaultDir, 'Manuscript', 'the-deep', 'ch-1'), { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  const nowStr = '2026-06-01T00:00:00.000Z';
  const scenePath = 'Manuscript/the-deep/ch-1/the-gate.md';
  fs.writeFileSync(
    path.join(vaultDir, scenePath),
    `---\nid: scene-mv-1\ntitle: The Gate\npov: Mira\nupdatedAt: ${nowStr}\n---\n${PROSE}`,
  );
  const scene = {
    id: 'scene-mv-1', title: 'The Gate', path: scenePath, order: 0,
    chapterId: 'ch-mv-1', storyId: 'story-mv-1',
    blocks: [{ id: 'b1', type: 'prose', order: 0, content: PROSE, updatedAt: nowStr }],
    draftState: 'final', createdAt: nowStr, updatedAt: nowStr,
  };
  const manifest = {
    schemaVersion: 1, version: '2.0.0', vaultRoot: vaultDir,
    stories: [{
      id: 'story-mv-1', title: 'The Deep', path: 'Manuscript/the-deep',
      chapters: [{
        id: 'ch-mv-1', title: 'Chapter One', path: 'Manuscript/the-deep/ch-1',
        order: 0, scenes: [scene], createdAt: nowStr, updatedAt: nowStr,
      }],
      createdAt: nowStr, updatedAt: nowStr,
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
    provenance: {}, boardReferences: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(vaultDir, 'Manuscript', 'the-deep', 'comments.json'),
    JSON.stringify({
      version: 1,
      comments: [{
        id: 'c-mv-1', storyId: 'story-mv-1', sceneId: 'scene-mv-1',
        anchor: 'under the sea', author: 'You', kind: 'user',
        text: 'Expand the recognition beat.', createdAt: nowStr,
      }],
    }),
  );
  fs.writeFileSync(path.join(notesVaultDir, 'Mira.md'), '---\ntype: character\n---\nShe counts bells.');
}

async function launchApp(userData: string, envOverrides: Record<string, string>): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const env = Object.fromEntries(
    Object.entries({ ...process.env, ...envOverrides }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    env,
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function closeApp(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  await Promise.race([
    app.close().catch(() => undefined),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
}

/** Full recursive file → content snapshot (for original-untouched assertions). */
function treeSnapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else out[rel] = fs.readFileSync(full, 'utf-8');
    }
  };
  walk(root, '');
  return out;
}

test('SKY-10405 (native Windows): v0.4 vault silently migrates at boot — no prompt, content survives', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-win-migrate-'));
  const userData = path.join(tmp, 'user-data');
  const bundle = path.join(tmp, 'My Vault');
  const vaultDir = path.join(bundle, 'Story Vault');
  const notesVaultDir = path.join(bundle, 'Notes Vault');
  seedUserData(userData, vaultDir, notesVaultDir);
  seedV04Content(vaultDir, notesVaultDir);
  const storyBefore = treeSnapshot(vaultDir);
  const notesBefore = treeSnapshot(notesVaultDir);
  // Suite-wide default disables boot migration (playwright.config.ts) — this
  // spec re-enables the real path deliberately, same as mythos-migration.spec.ts.
  const app = await launchApp(userData, { MYTHOS_DISABLE_BOOT_MIGRATION: '0' });
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    const target = path.join(tmp, 'My Vault (MythosVault)');
    const settings = JSON.parse(
      fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8'),
    ) as { vaultRoot: string; notesVaultRoot?: string };
    expect(settings.vaultRoot).toBe(path.join(target, 'Story Vault'));
    expect(settings.notesVaultRoot).toBe(path.join(target, 'Notes Vault'));

    expect(fs.existsSync(path.join(target, 'mythos.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, '.mythos-migration-incomplete'))).toBe(false);

    const newScene = path.join(
      target, 'Story Vault', 'The Deep', 'Part 1', 'Chapter 01', 'Scene 01.md');
    expect(fs.readFileSync(newScene, 'utf-8')).toContain(PROSE);
    expect(
      fs.readFileSync(path.join(target, 'Story Vault', 'The Deep', 'comments.json'), 'utf-8'),
    ).toContain('Expand the recognition beat.');
    expect(
      fs.readFileSync(path.join(target, 'Notes Vault', 'Mira.md'), 'utf-8'),
    ).toContain('She counts bells.');

    // The original vault is byte-for-byte untouched…
    expect(treeSnapshot(vaultDir)).toEqual(storyBefore);
    expect(treeSnapshot(notesVaultDir)).toEqual(notesBefore);

    // …and the app opened the MIGRATED vault with zero prompts or errors.
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-testid="mythos-migration-prompt"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="mythos-boot-migration-error"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /The Deep/ }).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await closeApp(app);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
