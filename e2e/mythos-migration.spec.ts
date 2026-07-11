/**
 * mythos-migration.spec.ts — Beta 4 M5
 *
 * End-to-end acceptance for the MythosVault migration wizard (packaged
 * runtime, real IPC, real files):
 *
 *   TC-MV-01  A v0.4 vault WITH user content shows the upgrade prompt on
 *             boot; the wizard walks plan → run → report and builds the new
 *             vault in a sibling folder while the ORIGINAL stays untouched.
 *   TC-MV-02  Confirming switches the app to the new vault; after the
 *             renderer reloads, the migrated story/chapter/scene open with
 *             prose intact, and the vault-settings point at the new folder.
 *   TC-MV-03  A fresh (seed-only) v0.4 vault shows NO prompt — fresh-vault
 *             fixtures render unchanged (visual-regression safety).
 *
 * Not wired into a CI shard yet (M5 lands the flow; wiring is a Wave-2
 * follow-up) — run locally with:
 *   npx playwright test e2e/mythos-migration.spec.ts --reporter=list
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
const PROSE = 'The gate had waited under the sea, and it recognized her.';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  const agent = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
  };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      apiKey: '',
      onboardingComplete: true,
      agents: {
        writingAssistant: { ...agent, scanIntervalSeconds: 30 },
        brainstorm: agent,
        archive: { ...agent, continuityCheckIntervalSeconds: 60 },
      },
      theme: 'dark',
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** Write a small v0.4 vault with real user content (2 stories, comments, a note). */
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
    stories: [
      {
        id: 'story-mv-1', title: 'The Deep', path: 'Manuscript/the-deep',
        chapters: [{
          id: 'ch-mv-1', title: 'Chapter One', path: 'Manuscript/the-deep/ch-1',
          order: 0, scenes: [scene], createdAt: nowStr, updatedAt: nowStr,
        }],
        createdAt: nowStr, updatedAt: nowStr,
      },
      {
        id: 'story-mv-2', title: 'Second Story', path: 'Manuscript/second',
        chapters: [], createdAt: nowStr, updatedAt: nowStr,
      },
    ],
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

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
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

test.describe.serial('MythosVault migration wizard (M5)', () => {
  let tmpRoot: string;
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mv-e2e-'));
    userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'My Vault');
    vaultDir = path.join(bundle, 'Story Vault');
    notesVaultDir = path.join(bundle, 'Notes Vault');
    seedUserData(userData, vaultDir, notesVaultDir);
    seedV04Content(vaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    const proc = app?.process();
    await Promise.race([
      app?.close().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('TC-MV-01: prompt appears; wizard builds + verifies; original untouched', async () => {
    // Sanity: SQLite/.mythos state created by boot is machine-local — snapshot
    // the USER files only (the migrator's read-only promise covers them all,
    // but boot itself legitimately writes .mythos/state.db + seed markers).
    await expect(page.locator('[data-testid="mythos-migration-prompt"]')).toBeVisible({
      timeout: 15_000,
    });
    const storyBefore = treeSnapshot(vaultDir);
    const notesBefore = treeSnapshot(notesVaultDir);

    await page.locator('[data-testid="mythos-migration-prompt-upgrade"]').click();
    await expect(page.locator('[data-testid="mythos-migration-step-intro"]')).toBeVisible();
    await page.locator('[data-testid="mythos-migration-review"]').click();
    await expect(page.locator('[data-testid="mythos-migration-run"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="mythos-migration-run"]').click();
    const report = page.locator('[data-testid="mythos-migration-step-report"]');
    await expect(report).toBeVisible({ timeout: 30_000 });
    await expect(report).toContainText('Verified');

    // New vault exists with the canonical layout…
    const target = path.join(tmpRoot, 'My Vault (MythosVault)');
    expect(fs.existsSync(path.join(target, 'mythos.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'timelines.json'))).toBe(true);
    const newScene = path.join(
      target, 'Story Vault', 'The Deep', 'Part 1', 'Chapter 01', 'Scene 01.md');
    expect(fs.readFileSync(newScene, 'utf-8')).toContain(PROSE);
    expect(fs.readFileSync(newScene, 'utf-8')).toContain('status: done');
    expect(
      fs.readFileSync(path.join(target, 'Story Vault', 'The Deep', 'comments.json'), 'utf-8'),
    ).toContain('Expand the recognition beat.');
    expect(
      fs.readFileSync(path.join(target, 'Notes Vault', 'Mira.md'), 'utf-8'),
    ).toContain('She counts bells.');

    // …and the ORIGINAL is byte-for-byte untouched.
    expect(treeSnapshot(vaultDir)).toEqual(storyBefore);
    expect(treeSnapshot(notesVaultDir)).toEqual(notesBefore);
  });

  test('TC-MV-02: confirm switches the app onto the migrated vault', async () => {
    await page.locator('[data-testid="mythos-migration-confirm"]').click();
    // The renderer reloads itself after the switch.
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);

    const settings = JSON.parse(
      fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8'),
    ) as { vaultRoot: string; notesVaultRoot?: string };
    const target = path.join(tmpRoot, 'My Vault (MythosVault)');
    expect(settings.vaultRoot).toBe(path.join(target, 'Story Vault'));
    expect(settings.notesVaultRoot).toBe(path.join(target, 'Notes Vault'));

    // The migrated story tree is served through the v2 gate: the story,
    // chapter, and scene rows appear and the scene opens with prose intact.
    const storyRow = page.getByRole('button', { name: /The Deep/ }).first();
    await expect(storyRow).toBeVisible({ timeout: 20_000 });
    const chapterRow = page.getByRole('button', { name: /Chapter One/ }).first();
    await expect(chapterRow).toBeVisible({ timeout: 10_000 });
    // Boot-time reindex re-renders the navigator and can collapse a freshly
    // expanded chapter — retry the expand until the scene row stays visible.
    const sceneRow = page.getByText('The Gate', { exact: true }).first();
    for (let attempt = 0; attempt < 4; attempt++) {
      await chapterRow.click();
      try {
        await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
        break;
      } catch {
        /* collapsed again — retry */
      }
    }
    await expect(sceneRow).toBeVisible({ timeout: 5_000 });
    await sceneRow.click();
    await expect(page.getByText('under the sea, and it recognized her').first()).toBeVisible({
      timeout: 15_000,
    });

    // No migration prompt on the new-format vault.
    await expect(page.locator('[data-testid="mythos-migration-prompt"]')).toHaveCount(0);
  });
});

test('TC-MV-03: a fresh seed-only v0.4 vault shows no prompt', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mv-fresh-'));
  const userData = path.join(tmp, 'user-data');
  const vaultDir = path.join(tmp, 'Fresh', 'Story Vault');
  const notesVaultDir = path.join(tmp, 'Fresh', 'Notes Vault');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  seedUserData(userData, vaultDir, notesVaultDir);
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-testid="mythos-migration-prompt"]')).toHaveCount(0);
  } finally {
    const proc = app.process();
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
