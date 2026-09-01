/**
 * notes-vault-swap-windows-real.spec.ts — SKY-11058 (native-Windows handle guard)
 *
 * Swapping the active notes vault (NOTES_VAULT_REGISTRY_SET_ACTIVE) re-points
 * the chokidar notes-vault watcher and any file handles from the old vault
 * dir to the new one. Windows refuses to rename/delete a directory with open
 * handles inside it (EPERM); POSIX does not — so a handle leak on swap is
 * invisible on every Linux job. This is the SKY-10895 pattern applied to the
 * notes-vault swap: do the op for real with the app's own watcher bound to
 * the source dir, then prove the OS will let us rename that dir afterwards.
 *
 * Flow (real app, real IPC, real fs — nothing on the swap seam is stubbed):
 *   1. Seed a v2 MythosVault (mythos.json + Story Vault/ + Notes Vault/) with
 *      completed onboarding. notes-vaults.json is deliberately NOT pre-seeded —
 *      the registry must be created by ensureNotesVaultRegistry on first list.
 *   2. Open the Notes tab and open a note from the original vault, so the
 *      watcher (and anything else) is live on the original notes vault dir.
 *   3. Create a second notes vault through the picker UI (useTextPrompt modal).
 *   4. Swap active to the new vault via the picker, confirming the pre-swap
 *      link-resolution dialog when it appears (the seeded story has wikilinks;
 *      a zero-link story swaps instantly — both paths are accepted).
 *   5. THE POINT: fs.renameSync the ORIGINAL notes vault dir to a sibling
 *      name, retrying up to ~5s to allow the async watcher close. On Windows
 *      this throws EPERM forever if the app still holds handles. Rename back.
 *   6. Prove the ACTIVE (new) vault is genuinely live: a file written into it
 *      on disk shows up in the notes tree (watcher re-pointed, list renders).
 *
 * The spec also passes on POSIX (rename always succeeds there) so it can be
 * smoke-run locally, but its real value is the native-Windows CI job.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/notes-vault-swap-windows-real.spec.ts --reporter=list
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
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-08-01T00:00:00.000Z';

const STORY_ID = 'story-nvs-1';
const STORY_TITLE = 'The Cartographer';
// The scene links to the seeded note, so the pre-swap link-resolution report
// has something real to say (the stem resolves in the original vault, not in
// the freshly created empty one).
const SCENE_PROSE =
  'She unrolled the map beside her notes on [[Alpha]] and began to draw.';
const NEW_VAULT_NAME = 'Field Research';
const FRESH_NOTE = 'Fresh Arrival.md';

// How long we allow the app to release its handles on the old vault dir
// after the swap before calling it a leak. Watcher close is async
// (stopNotesVaultWatcher().finally(start…)) so the first attempts may
// legitimately hit EPERM on Windows; a healthy app settles well within this.
const RENAME_RETRY_MS = 5_000;
const RENAME_RETRY_INTERVAL_MS = 250;

interface Dirs {
  tmpRoot: string;
  userData: string;
  bundle: string;
  storyVault: string;
  notesVault: string;
}

// ─── Fixture: a minimal hand-written MythosVault v2 bundle ───────────────────
// (same shape as comments-v2.spec.ts; agents disabled like folder-ops so no
// background agent can open handles of its own on the notes vault dir)

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
      theme: 'dark',
      agents: {
        writingAssistant: { ...agent, scanIntervalSeconds: 30 },
        brainstorm: { ...agent },
        archive: { ...agent, continuityCheckIntervalSeconds: 60 },
      },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** Write a v2 MythosVault: one story/chapter/scene + one note in Notes Vault. */
function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  const notesVault = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-nvs-1',
      name: 'Swap Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-nvs-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: ${STORY_ID}`,
      `title: ${STORY_TITLE}`,
      `createdAt: ${NOW}`,
      `updatedAt: ${NOW}`,
      '---',
      `# ${STORY_TITLE}`,
      '',
      '## Part 1',
      '',
      '- [[Part 1/Chapter 01|Chapter One]]',
      '',
      '<!-- mythos:spine',
      JSON.stringify(spine),
      '-->',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-nvs-1\ntitle: The Map Room\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SCENE_PROSE}`,
  );

  // The note the manuscript links to — opened in step 2 so the original vault
  // dir has live UI + watcher activity before the swap.
  fs.writeFileSync(path.join(notesVault, 'Alpha.md'), '# Alpha\n\nFirst note.\n');
}

function makeDirs(): Dirs {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-vault-swap-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Swap Vault');
  const storyVault = path.join(bundle, 'Story Vault');
  const notesVault = path.join(bundle, 'Notes Vault');
  seedV2Vault(bundle);
  seedUserData(userData, storyVault, notesVault);
  return { tmpRoot, userData, bundle, storyVault, notesVault };
}

// ─── App plumbing (same pattern as move-vault-local-real.spec.ts) ────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
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
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Rename `from` → `to`, retrying on EPERM/EBUSY/ENOTEMPTY for up to
 * `budgetMs` to allow the app's async watcher close to finish. Returns the
 * last error when the budget is exhausted without success, null on success.
 */
async function renameWithRetry(from: string, to: string, budgetMs: number): Promise<NodeJS.ErrnoException | null> {
  const deadline = Date.now() + budgetMs;
  let lastErr: NodeJS.ErrnoException | null = null;
  for (;;) {
    try {
      fs.renameSync(from, to);
      return null;
    } catch (err) {
      lastErr = err as NodeJS.ErrnoException;
      if (Date.now() >= deadline) return lastErr;
      await sleep(RENAME_RETRY_INTERVAL_MS);
    }
  }
}

// ─── The test ────────────────────────────────────────────────────────────────

test('notes-vault swap releases every handle on the old vault dir (native Windows EPERM guard)', async () => {
  // Launch + UI drive + create + swap + bounded rename retries: comfortably
  // more than the suite's 60s default on a cold contended Windows runner.
  test.setTimeout(120_000);

  const dirs = makeDirs();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(dirs.userData);
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });

    // ── 2. Notes tab: open a note from the ORIGINAL vault ────────────────
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 10_000 });
    const alphaRow = page.locator('[data-testid="vb-row-Alpha.md"]');
    await expect(alphaRow).toBeVisible({ timeout: 10_000 });
    await alphaRow.click();
    await expect(page.locator('[data-testid="notes-tab-center"]')).toContainText('Alpha', { timeout: 10_000 });

    // Mounting the picker ran notesVaultRegistry:list, which lazily created
    // the registry (ensureNotesVaultRegistry) — nothing was pre-seeded.
    const pickerBtn = page.locator('[data-testid="notes-vault-picker-btn"]');
    await expect(pickerBtn).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(() => fs.existsSync(path.join(dirs.bundle, 'notes-vaults.json')), { timeout: 10_000 })
      .toBe(true);

    // ── 3. Create a second notes vault through the picker UI ─────────────
    await pickerBtn.click();
    await page.locator('[data-testid="notes-vault-picker-menu"] [data-testid="menu-item-create"]').click();
    // useTextPrompt modal (window.prompt is unsupported in Electron).
    const promptOverlay = page.locator('.prompt-modal-overlay');
    await expect(promptOverlay).toBeVisible({ timeout: 5_000 });
    await promptOverlay.locator('input').fill(NEW_VAULT_NAME);
    await promptOverlay.locator('.prompt-modal-ok').click();
    await expect(promptOverlay).toHaveCount(0);

    // createBlankNotesVault slugifies the display name into the dir name; a
    // collision-free name maps 1:1, directly inside the MythosVault root.
    const newVaultDir = path.join(dirs.bundle, NEW_VAULT_NAME);
    await expect
      .poll(() => fs.existsSync(newVaultDir), { timeout: 10_000 })
      .toBe(true);

    // ── 4. Swap active to the new vault ──────────────────────────────────
    await pickerBtn.click();
    await page
      .locator('[data-testid="notes-vault-picker-menu"]')
      .getByRole('menuitem', { name: NEW_VAULT_NAME })
      .click();

    // The seeded story carries wikilinks, so the pre-swap link-resolution
    // confirm dialog should appear ([[Alpha]] resolves only in the original
    // vault). Tolerate the instant zero-link path too — the assertion that
    // matters is that the picker ends on the new vault.
    const switchDialog = page.locator('[data-testid="notes-vault-switch-dialog"]');
    const confirmed = await switchDialog
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (confirmed) {
      await page.locator('[data-testid="notes-vault-switch-confirm"]').click();
      await expect(switchDialog).toHaveCount(0, { timeout: 10_000 });
    }
    await expect(pickerBtn).toContainText(NEW_VAULT_NAME, { timeout: 10_000 });

    // The swap persisted server-side before we probe for leaked handles.
    await expect
      .poll(() => {
        try {
          const settings = JSON.parse(
            fs.readFileSync(path.join(dirs.userData, 'vault-settings.json'), 'utf-8'),
          ) as { notesVaultRoot?: string };
          return settings.notesVaultRoot ?? null;
        } catch {
          return null;
        }
      }, { timeout: 10_000 })
      .toBe(newVaultDir);
    const registry = JSON.parse(
      fs.readFileSync(path.join(dirs.bundle, 'notes-vaults.json'), 'utf-8'),
    ) as { vaults: Array<{ id: string; dirName: string }>; activeId: string };
    expect(registry.vaults.map((v) => v.dirName).sort()).toEqual([NEW_VAULT_NAME, 'Notes Vault']);
    expect(registry.vaults.find((v) => v.id === registry.activeId)?.dirName).toBe(NEW_VAULT_NAME);

    // ── 5. THE POINT: the old vault dir must be renameable ───────────────
    // On Windows this throws EPERM for as long as the app holds any handle
    // (watcher, DB, stray fd) inside the original dir. POSIX always allows
    // it, so a pass here on Linux is necessary-but-not-sufficient — the
    // Windows CI job is where this assertion has teeth.
    const renamedAside = path.join(dirs.bundle, 'Notes Vault (renamed)');
    const renameErr = await renameWithRetry(dirs.notesVault, renamedAside, RENAME_RETRY_MS);
    expect(
      renameErr,
      `original notes vault dir still locked ${RENAME_RETRY_MS}ms after the swap — ` +
        `the app is leaking a handle on the old vault (${renameErr?.code}: ${renameErr?.message})`,
    ).toBeNull();
    expect(fs.existsSync(renamedAside)).toBe(true);
    expect(fs.existsSync(dirs.notesVault)).toBe(false);

    // Put it back so the registry's 'Notes Vault' entry stays valid.
    const renameBackErr = await renameWithRetry(renamedAside, dirs.notesVault, RENAME_RETRY_MS);
    expect(renameBackErr, `failed to restore original notes vault dir: ${renameBackErr?.message}`).toBeNull();

    // ── 6. The ACTIVE (new) vault is genuinely live ──────────────────────
    // Create a note through the real UI (notes toolbar "New note" →
    // NoteTemplateDialog blank-note path → writeNotesVault IPC). It must
    // land on disk inside the NEW vault dir, and the tree — re-listed by the
    // dialog's onCreated reload — must show it, from the new root (the old
    // vault's Alpha.md disappears from the listing).
    const notesPanel = page.locator('[data-testid="notes-tab-panel"]');
    await notesPanel.locator('button[aria-label="New note"]').first().click();
    await expect(page.locator('[data-testid="ntd-blank-title"]')).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="ntd-blank-title"]').fill('Fresh Arrival');
    await page.locator('[data-testid="ntd-submit"]').click();
    await expect(page.locator(`[data-testid="vb-row-${FRESH_NOTE}"]`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="vb-row-Alpha.md"]')).toHaveCount(0);
    expect(fs.existsSync(path.join(newVaultDir, FRESH_NOTE)), 'note must be written into the ACTIVE (new) vault dir').toBe(true);
    expect(fs.existsSync(path.join(dirs.notesVault, FRESH_NOTE)), 'note must NOT land in the old vault dir').toBe(false);
  } finally {
    await closeElectronApp(app);
    removeTempDirs(dirs.tmpRoot);
  }
});
