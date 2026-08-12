/**
 * notes-seed-once-sky9028.spec.ts — SKY-9028 / M8b (GAP P0 #1)
 *
 * Fixture-based proof of the PLAN.md M8 acceptance box:
 *   "A vault seeded with external folders/notes shows them all;
 *    relaunch ×3 → no duplicates, no re-seed (DOM + disk assert)"
 *
 * The notes vault is populated EXTERNALLY (plain fs writes, no app involved)
 * before the first boot — the exact setup the GAP-REPORT-v2 audit used when
 * its own test vault failed to appear. Every boot must:
 *   SD-01  show ALL external folders/notes in the Notes tree, exactly once,
 *          including a folder whose name collides with the SKY-15 seed layout
 *          (`Archive/`) — pre-existing content is adopted, never shadowed;
 *   SD-02  never scaffold the SKY-15 seed layout into the populated root
 *          (no `Universes/`, `Inbox/`, `Daily Notes/`, `Templates.md`, …)
 *          on boot #1 or on any of the three relaunches — the disk listing
 *          of user-visible (non-dot) entries is byte-identical across boots;
 *   SD-03  write the `.mythos-seeded` adoption marker on first boot so the
 *          legacy empty-dir heuristic can never re-arm.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/notes-seed-once-sky9028.spec.ts --reporter=list
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
const SEED_MARKER = '.mythos-seeded';

/** External fixture content, written before the app ever runs. */
const EXTERNAL_DIRS = ['Worldbuilding', 'Worldbuilding/Cities', 'Journal', 'Archive'];
const EXTERNAL_NOTES = [
  'Worldbuilding/Cities/Ravenspire.md',
  'Worldbuilding/Mira.md',
  'Journal/2026-01-01.md',
  'Archive/old-note.md',
  'Loose Ideas.md',
];

/** SKY-15 seed layout entries that must NEVER be scaffolded into this vault. */
const SEED_LAYOUT_ENTRIES = ['Universes', 'Stories', 'Inbox', 'Research', 'Daily Notes', 'Templates.md'];

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

function seedExternalNotesVault(root: string): void {
  for (const dir of EXTERNAL_DIRS) fs.mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
  for (const rel of EXTERNAL_NOTES) {
    fs.writeFileSync(path.join(root, ...rel.split('/')), `# ${rel}\n\nExternal content.\n`, 'utf-8');
  }
}

/**
 * Recursive listing of user-visible entries (dot-entries excluded — the app
 * owns its dotfile bookkeeping: `.mythos-seeded`, `.vb-order.json`, …).
 * Sorted POSIX relative paths, directories suffixed with '/'.
 */
function listUserVisible(root: string, rel = ''): string[] {
  const full = rel === '' ? root : path.join(root, rel);
  const out: string[] = [];
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(`${childRel}/`);
      out.push(...listUserVisible(root, childRel));
    } else {
      out.push(childRel);
    }
  }
  return out.sort();
}

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

/** Navigate to the Notes Editor tab and wait for the notes tree to paint. */
async function openNotesTree(pg: Page): Promise<void> {
  await expect(pg.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  // SKY-9022/M6: Vault Browser's function is the Notes workspace sidebar,
  // its one home — navigate to the Notes Editor tab to reach it.
  await pg.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
  await expect(pg.locator('[data-testid="vb-notes-vault"]')).toBeVisible({ timeout: 6_000 });
  await expect(pg.locator('[data-testid="vb-row-Loose Ideas.md"]')).toBeVisible({ timeout: 8_000 });
}

/** Every external entry renders exactly once; no seed-layout rows exist. */
async function assertTreeShowsExternalContentOnce(pg: Page): Promise<void> {
  // Folders may or may not be expanded (expansion persists per-root in
  // localStorage, and the fixture root is fresh per run) — walk parents
  // before children and expand any collapsed folder via its own
  // aria-expanded state so nested rows are assertable on every boot.
  for (const dir of EXTERNAL_DIRS) {
    const row = pg.locator(`[data-testid="vb-row-${dir}"]`);
    await expect(row).toBeVisible({ timeout: 8_000 });
    if ((await row.getAttribute('aria-expanded')) === 'false') await row.click();
  }
  for (const rel of EXTERNAL_NOTES) {
    await expect(pg.locator(`[data-testid="vb-row-${rel}"]`), `external note ${rel} must render`)
      .toHaveCount(1);
    await expect(pg.locator(`[data-testid="vb-row-${rel}"]`)).toBeVisible({ timeout: 8_000 });
  }
  for (const dir of EXTERNAL_DIRS) {
    await expect(pg.locator(`[data-testid="vb-row-${dir}"]`), `external folder ${dir} renders once`)
      .toHaveCount(1);
  }
  for (const seedEntry of SEED_LAYOUT_ENTRIES) {
    await expect(
      pg.locator(`[data-testid="vb-row-${seedEntry}"]`),
      `seed-layout entry ${seedEntry} must not be scaffolded into a populated external vault`,
    ).toHaveCount(0);
  }
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;
/** Disk listing captured after boot #1 — later boots must match it exactly. */
let baselineListing: string[];

test.beforeAll(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-seed-once-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-story-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-vault-'));
  seedExternalNotesVault(notesVaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('SD-01/SD-03: first boot shows all external content, adopts (marker) without scaffolding', async () => {
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openNotesTree(page);
  await assertTreeShowsExternalContentOnce(page);

  // SD-03: populated root is ADOPTED — marker written, no seed layout dumped.
  expect(fs.existsSync(path.join(notesVaultDir, SEED_MARKER)), '.mythos-seeded adoption marker').toBe(true);
  baselineListing = listUserVisible(notesVaultDir);
  for (const seedEntry of SEED_LAYOUT_ENTRIES) {
    expect(baselineListing, `disk must not contain scaffolded ${seedEntry}`)
      .not.toContain(seedEntry.endsWith('.md') ? seedEntry : `${seedEntry}/`);
  }
  // Every fixture entry survived boot untouched.
  for (const rel of EXTERNAL_NOTES) expect(baselineListing).toContain(rel);
});

for (const relaunch of [1, 2, 3]) {
  test(`SD-02: relaunch ${relaunch}/3 — no re-seed, no duplicates (DOM + disk)`, async () => {
    test.setTimeout(90_000);
    await app!.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openNotesTree(page);
    await assertTreeShowsExternalContentOnce(page);

    // Disk diff vs. the post-boot-#1 baseline: byte-identical user-visible tree.
    expect(listUserVisible(notesVaultDir), `relaunch ${relaunch}: disk listing changed`)
      .toEqual(baselineListing);
    expect(fs.existsSync(path.join(notesVaultDir, SEED_MARKER))).toBe(true);
  });
}
