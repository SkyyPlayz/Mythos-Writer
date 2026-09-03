/**
 * sky-11236-per-vault-tab-isolation.spec.ts — SKY-11236
 *
 * Owner-reported: open note tabs were GLOBAL while note paths resolve against
 * the ACTIVE vault, so every vault switch left the outgoing vault's tabs in the
 * bar; their notes don't exist in the incoming vault → the editor rendered
 * "Could not load note." (screenshot: a "Mira Veynn" tab, red error).
 *
 * This drives a REAL Mythos-vault switch through the nav-rail tiles (the same
 * projectSwitch path the UI uses) across two pre-seeded vaults and asserts:
 *   AC1  A → B → A restores exactly A's original tab, active tab included.
 *   AC2  While in B, none of A's tabs are visible.
 *   AC3  No "Could not load note." from a vault switch, ever.
 *   AC4  A's tab set survives an app restart (per vault).
 *   AC5  Isolation proven BOTH ways through the UI (this is that test; a
 *        single-vault test passes today with the feature fully broken).
 *
 * §4c reachability: both vaults are real on disk and reached only through the
 * rail; nothing about the tab state is pre-seeded — the tabs are opened by
 * clicking notes in the tree, exactly as a user would.
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
const NOW = '2026-09-01T00:00:00.000Z';

// The owner's screenshot showed a "Mira Veynn" tab failing after a switch —
// keep that exact note name here so the regression reads true to the report.
const NOTE_A = 'Mira Veynn.md';
const NOTE_A_TITLE = 'Mira Veynn';
const NOTE_B = 'Borin Cask.md';
const NOTE_B_TITLE = 'Borin Cask';

interface VaultSettings {
  vaultRoot?: string;
  notesVaultRoot?: string;
  recentProjects?: Array<{ name: string; vaultRoot: string; notesVaultRoot?: string; openedAt: string }>;
}

function readVaultSettings(userData: string): VaultSettings {
  const file = path.join(userData, 'vault-settings.json');
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as VaultSettings;
}

/** A minimal hand-written MythosVault v2 bundle with one note in Notes Vault. */
function seedVault(bundle: string, opts: { id: string; name: string; noteFile: string }): void {
  const storyTitle = `${opts.name} Story`;
  const chapterDir = path.join(bundle, 'Story Vault', storyTitle, 'Part 1', 'Chapter 01');
  const notesVault = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });

  const storyId = `story-${opts.id}`;
  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: `vault-${opts.id}`,
      name: opts.name,
      createdAt: NOW,
      stories: [{ id: storyId, title: storyTitle, folder: storyTitle, createdAt: NOW, updatedAt: NOW }],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [{ dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: `ch-${opts.id}`, title: 'Chapter One' }] }];
  fs.writeFileSync(
    path.join(bundle, 'Story Vault', storyTitle, 'book.md'),
    [
      '---', `id: ${storyId}`, `title: ${storyTitle}`, `createdAt: ${NOW}`, `updatedAt: ${NOW}`, '---',
      `# ${storyTitle}`, '', '## Part 1', '', '- [[Part 1/Chapter 01|Chapter One]]', '',
      '<!-- mythos:spine', JSON.stringify(spine), '-->', '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-${opts.id}\ntitle: Opening\nstatus: draft\nupdatedAt: ${NOW}\n---\nThe scene body.`,
  );

  // The note that will be opened as a tab. A bare .md is enough for the tree;
  // NoteViewer falls back to the file stem for the title.
  fs.writeFileSync(path.join(notesVault, opts.noteFile), `# ${opts.noteFile.replace(/\.md$/, '')}\n\nBody.\n`);
}

const AGENT = {
  enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
  maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
};

function seedUserData(userData: string, storyA: string, notesA: string, storyB: string, notesB: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      apiKey: '', onboardingComplete: true, theme: 'dark',
      agents: {
        writingAssistant: { ...AGENT, scanIntervalSeconds: 30 },
        brainstorm: { ...AGENT },
        archive: { ...AGENT, continuityCheckIntervalSeconds: 60 },
      },
    }, null, 2),
  );
  // Vault A active; BOTH vaults in recentProjects so both rail tiles render.
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: storyA,
      notesVaultRoot: notesA,
      recentProjects: [
        { name: 'Alpha', vaultRoot: storyA, notesVaultRoot: notesA, openedAt: NOW },
        { name: 'Beta', vaultRoot: storyB, notesVaultRoot: notesB, openedAt: NOW },
      ],
    }, null, 2),
  );
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
  return pg;
}

/** Open the Notes section and its tree; the tab bar lives inside this panel. */
async function gotoNotes(pg: Page): Promise<void> {
  await pg.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await pg.locator('[data-testid="vb-notes-vault"]').waitFor({ timeout: 15_000 });
}

/** The Notes-section workspace tab bar (scoped so the Story bar can't match). */
function notesTabs(pg: Page) {
  return pg.locator('[data-testid="notes-tab-panel"]').getByRole('tablist', { name: 'Workspace tabs' });
}

/** The visible NoteViewer error ("Could not load note." and friends). */
function noteError(pg: Page) {
  return pg.locator('.note-viewer-error');
}

let userData: string;
let homeOverride: string;
let tmpRoot: string;
let storyA: string;
let storyB: string;

test.beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11236-'));
  userData = path.join(tmpRoot, 'user-data');
  homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'sky11236-home-'));
  const bundleA = path.join(tmpRoot, 'Alpha');
  const bundleB = path.join(tmpRoot, 'Beta');
  seedVault(bundleA, { id: 'a', name: 'Alpha', noteFile: NOTE_A });
  seedVault(bundleB, { id: 'b', name: 'Beta', noteFile: NOTE_B });
  storyA = path.join(bundleA, 'Story Vault');
  storyB = path.join(bundleB, 'Story Vault');
  seedUserData(userData, storyA, path.join(bundleA, 'Notes Vault'), storyB, path.join(bundleB, 'Notes Vault'));
});

test.afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(homeOverride, { recursive: true, force: true });
});

test('TC-SKY-11236-01: open tabs are isolated per vault across a real switch, both ways + restart', async () => {
  let app = await launchApp(userData, homeOverride);
  try {
    let pg = await firstWindow(app);
    await pg.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });
    const tileA = pg.locator(`[data-testid="nav-rail-vault-tile-${storyA}"]`);
    const tileB = pg.locator(`[data-testid="nav-rail-vault-tile-${storyB}"]`);
    await expect(tileA).toHaveClass(/nav-rail__vault-tile--active/);

    // ── In vault A: open A's note as a tab. ──────────────────────────────────
    await gotoNotes(pg);
    await pg.locator(`[data-testid="vb-row-${NOTE_A}"]`).click();
    await expect(notesTabs(pg).locator('.wtb-tab-label', { hasText: NOTE_A_TITLE })).toHaveCount(1, { timeout: 8_000 });
    await expect(noteError(pg)).toHaveCount(0); // AC3

    // ── Switch to vault B (real projectSwitch via the rail tile). ────────────
    await tileB.click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, { timeout: 30_000 }).toBe(storyB);
    await expect(tileB).toHaveClass(/nav-rail__vault-tile--active/);
    await gotoNotes(pg);
    // AC2 + AC3: A's tab must be gone, and NO "Could not load note." appears.
    await expect(pg.locator('[data-testid="vb-row-' + NOTE_B + '"]')).toBeVisible({ timeout: 15_000 });
    await expect(pg.locator('[data-testid="vb-row-' + NOTE_A + '"]')).toHaveCount(0);
    await expect(notesTabs(pg).locator('.wtb-tab-label', { hasText: NOTE_A_TITLE })).toHaveCount(0);
    await expect(noteError(pg)).toHaveCount(0);

    // Open B's own note; it lives only in B.
    await pg.locator(`[data-testid="vb-row-${NOTE_B}"]`).click();
    await expect(notesTabs(pg).locator('.wtb-tab-label', { hasText: NOTE_B_TITLE })).toHaveCount(1, { timeout: 8_000 });
    await expect(noteError(pg)).toHaveCount(0);

    // ── Switch back to vault A: exactly A's original tab, active. ────────────
    await tileA.click();
    await expect.poll(() => readVaultSettings(userData).vaultRoot, { timeout: 30_000 }).toBe(storyA);
    await expect(tileA).toHaveClass(/nav-rail__vault-tile--active/);
    await gotoNotes(pg);
    // AC1: A's tab restored and active; B's tab not present; no error.
    await expect(notesTabs(pg).locator('.wtb-tab-label', { hasText: NOTE_A_TITLE })).toHaveCount(1, { timeout: 8_000 });
    await expect(notesTabs(pg).locator('.wtb-tab-label', { hasText: NOTE_B_TITLE })).toHaveCount(0);
    await expect(
      notesTabs(pg).locator('[role="tab"][aria-selected="true"] .wtb-tab-label'),
    ).toContainText(NOTE_A_TITLE);
    await expect(noteError(pg)).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
  }

  // ── AC4: relaunch (vault A still active) → A's tab restores from disk. ─────
  app = await launchApp(userData, homeOverride);
  try {
    const pg = await firstWindow(app);
    await pg.locator('[data-testid="nav-rail-vaults"]').waitFor({ timeout: 30_000 });
    await expect(pg.locator(`[data-testid="nav-rail-vault-tile-${storyA}"]`)).toHaveClass(/nav-rail__vault-tile--active/);
    await gotoNotes(pg);
    await expect(notesTabs(pg).locator('.wtb-tab-label', { hasText: NOTE_A_TITLE })).toHaveCount(1, { timeout: 8_000 });
    await expect(noteError(pg)).toHaveCount(0);
  } finally {
    await app.close().catch(() => {});
  }
});
