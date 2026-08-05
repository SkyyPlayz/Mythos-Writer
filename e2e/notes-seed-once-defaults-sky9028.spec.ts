/**
 * notes-seed-once-defaults-sky9028.spec.ts — SKY-9028 (M8b, GAP P0 #1)
 *
 * Sibling of notes-seed-once-sky9028.spec.ts, which proves the SKY-15/W0.1
 * marker system under an agents-DISABLED settings fixture. This spec runs the
 * harder variant: DEFAULT settings (agents enabled) and the Notes TAB open —
 * the surface that mounts BrainstormPage — with the disk baseline captured
 * BEFORE first boot. That combination is what exposed the on-mount vault
 * writers (Sessions/<date> brainstorm.md, Boards/brainstorm.board.json)
 * escaping the seed-once markers.
 *
 *   TC-SEED-01  A notes vault populated OUTSIDE the app (external folders +
 *               notes) shows all of them in the Notes tree; relaunch ×3 →
 *               no duplicates in the DOM, no writes of ANY kind into the
 *               vault (disk diffed byte-for-byte on paths across every
 *               relaunch, dotfiles included after boot #1).
 *   TC-SEED-02  A fresh empty notes vault is seeded exactly once; folders
 *               the user then deletes on disk stay deleted across relaunch
 *               (the marker — not the empty-dir heuristic — gates seeding).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/notes-seed-once-defaults-sky9028.spec.ts --reporter=list
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

// ─── fixture helpers ─────────────────────────────────────────────────────────

function writeSettings(userData: string, vaultDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
  );
}

/** Notes content created OUTSIDE the app — plain folders + markdown files. */
function seedExternalNotes(notesDir: string): void {
  fs.mkdirSync(path.join(notesDir, 'Worldbuilding', 'People'), { recursive: true });
  fs.mkdirSync(path.join(notesDir, 'Session Logs'), { recursive: true });
  fs.writeFileSync(
    path.join(notesDir, 'Worldbuilding', 'Cities.md'),
    '# Cities\n\nThree rival port cities.\n',
  );
  fs.writeFileSync(
    path.join(notesDir, 'Worldbuilding', 'People', 'Heroes.md'),
    '# Heroes\n\nWho they are.\n',
  );
  fs.writeFileSync(path.join(notesDir, 'Journal.md'), '# Journal\n\nDay one.\n');
}

/** Recursive sorted listing of vault-relative POSIX paths (dirs get a trailing /). */
function diskSnapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        out.push(`${rel}/`);
        walk(abs);
      } else {
        out.push(rel);
      }
    }
  };
  walk(root);
  return out;
}

const visibleOnly = (snapshot: string[]) =>
  snapshot.filter((p) => !p.split('/').some((seg) => seg.startsWith('.')));

// ─── app helpers ─────────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

/** Boot, open the Notes tab, wait for the notes tree to render. */
async function openNotesTree(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 10_000 });
  return page;
}

/** All row paths currently rendered in the notes tree (top level is enough —
 *  duplicates from re-seeding always show up at the root). */
async function notesTreeRowPaths(page: Page): Promise<string[]> {
  const rows = page.locator('[data-testid="vb-notes-vault"] [data-testid^="vb-row-"]');
  const ids = await rows.evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-testid') ?? ''),
  );
  return ids.map((id) => id.replace(/^vb-row-/, ''));
}

// ─── TC-SEED-01: external content survives; relaunch ×3 → no re-seed ─────────

test('TC-SEED-01: externally created folders/notes all appear; relaunch x3 -> no duplicates, no re-seed', async () => {
  test.setTimeout(240_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-seed-once-'));
  const userData = path.join(tempRoot, 'userData');
  const vaultDir = path.join(tempRoot, 'story');
  const notesDir = path.join(tempRoot, 'notes');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  seedExternalNotes(notesDir);
  writeSettings(userData, vaultDir, notesDir);

  const beforeBoot = visibleOnly(diskSnapshot(notesDir));
  let afterFirstBoot: string[] = [];

  try {
    for (let boot = 1; boot <= 4; boot++) {
      const app = await launchApp(userData);
      try {
        const page = await openNotesTree(app);

        // Every external folder and note appears.
        for (const rowPath of ['Worldbuilding', 'Journal.md', 'Session Logs']) {
          await expect
            .soft(page.locator(`[data-testid="vb-notes-vault"] [data-testid="vb-row-${rowPath}"]`),
              `boot ${boot}: external entry "${rowPath}" must be in the Notes tree`)
            .toBeVisible({ timeout: 10_000 });
        }

        // DOM: no duplicate rows (a re-seed shows up as repeated top-level rows).
        const rowPaths = await notesTreeRowPaths(page);
        const dupes = rowPaths.filter((p, i) => rowPaths.indexOf(p) !== i);
        expect(dupes, `boot ${boot}: duplicate notes-tree rows`).toEqual([]);

        // DOM: the SKY-15 seed layout must NOT have been scaffolded into a
        // vault that already had user content.
        for (const seeded of ['Universes', 'Inbox', 'Daily Notes', 'Archive', 'Templates.md']) {
          expect(rowPaths, `boot ${boot}: seed entry "${seeded}" leaked into a user vault`)
            .not.toContain(seeded);
        }
        // DOM: story-vault internals never render in the Notes tree.
        expect(rowPaths.some((p) => p === 'Manuscript' || p.startsWith('Manuscript/')),
          `boot ${boot}: story-vault internals leaked into the Notes tree`).toBe(false);
      } finally {
        await app.close().catch(() => undefined);
      }

      // Disk: user-visible content is untouched — no seeded folders, no dupes.
      const snap = diskSnapshot(notesDir);
      expect(visibleOnly(snap), `boot ${boot}: visible disk contents changed`).toEqual(beforeBoot);
      if (boot === 1) {
        afterFirstBoot = snap;
      } else {
        // Full snapshot (dotfiles included) is stable after the first boot —
        // the seed decision is recorded once, then nothing is written again.
        expect(snap, `boot ${boot}: disk changed after the seed decision was recorded`)
          .toEqual(afterFirstBoot);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ─── TC-SEED-02: seed exactly once — user deletions stick across relaunch ────

test('TC-SEED-02: empty vault seeds once; user-deleted seed folders stay deleted after relaunch', async () => {
  test.setTimeout(180_000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-seed-del-'));
  const userData = path.join(tempRoot, 'userData');
  const vaultDir = path.join(tempRoot, 'story');
  const notesDir = path.join(tempRoot, 'notes');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  writeSettings(userData, vaultDir, notesDir);

  try {
    // Boot 1: fresh empty vault gets the default layout exactly once.
    let app = await launchApp(userData);
    try {
      const page = await openNotesTree(app);
      await expect(page.locator('[data-testid="vb-notes-vault"] [data-testid="vb-row-Universes"]'))
        .toBeVisible({ timeout: 10_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
    expect(fs.existsSync(path.join(notesDir, 'Inbox'))).toBe(true);

    // The user deletes two seeded folders on disk between sessions.
    fs.rmSync(path.join(notesDir, 'Inbox'), { recursive: true, force: true });
    fs.rmSync(path.join(notesDir, 'Universes'), { recursive: true, force: true });

    // Boot 2: nothing may be re-created — the marker, not the empty-dir
    // heuristic, owns the decision now.
    app = await launchApp(userData);
    try {
      const page = await openNotesTree(app);
      await expect(page.locator('[data-testid="vb-notes-vault"] [data-testid="vb-row-Research"]'))
        .toBeVisible({ timeout: 10_000 });
      const rowPaths = await notesTreeRowPaths(page);
      expect(rowPaths).not.toContain('Inbox');
      expect(rowPaths).not.toContain('Universes');
    } finally {
      await app.close().catch(() => undefined);
    }
    expect(fs.existsSync(path.join(notesDir, 'Inbox')), 'deleted seed folder re-appeared on disk').toBe(false);
    expect(fs.existsSync(path.join(notesDir, 'Universes')), 'deleted seed folder re-appeared on disk').toBe(false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
