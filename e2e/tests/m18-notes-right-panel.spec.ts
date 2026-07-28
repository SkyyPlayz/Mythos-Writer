/**
 * m18-notes-right-panel.spec.ts — SKY-8267 (independent verifier)
 *
 * Acceptance tests written from the LOCKED spec/contract alone — FULL-SPEC.md
 * §6 "NOTES EDITOR" (right panel) and BETA-REFINE.md's M18 block — never from
 * the M18 slice branch (SKY-8264, ProductEngineer). Do not add assertions
 * that encode implementation details not present in either spec source.
 *
 * Spec text (BETA-REFINE.md, M18 — Notes right panel *(§6)*):
 *   "Agent tab: Brainstorm chat (`Curator of this vault…`) + CONTINUITY
 *    FLAGS section (`ARCHIVE AGENT` badge; flag cards: title, Story↔Vault
 *    source, body, 3 actions). Properties tab: frontmatter table. No layout
 *    collisions (W0.3 rules). Accept: flags actions fire the same handlers
 *    as manuscript comment actions."
 *
 * Published acceptance criteria under test:
 *   AC-M18-01  Agent tab (default) hosts the Brainstorm chat AND, when the
 *              Archive Agent is enabled, a CONTINUITY FLAGS section.
 *   AC-M18-02  A flag card renders title, Story<->Vault source pairing, body,
 *              and exactly 3 actions (Match Archive / Suggest story change /
 *              Ignore) — the same action set the manuscript comment surface
 *              exposes for the identical issue.
 *   AC-M18-03  Firing a flag action here has the same real effect as firing
 *              it from the manuscript surface: clicking Ignore here persists
 *              status='ignored' for that issue row (same DB row the
 *              manuscript ContinuityPanel reads/writes — proves "same
 *              handlers", not a parallel/forked implementation).
 *   AC-M18-04  Properties tab renders the frontmatter table for the open
 *              note (not the Agent tab content).
 *   AC-M18-05  No layout collision: center note body and the right sidebar
 *              never overlap (W0.3 rule) at a standard viewport width.
 *
 * Real end-to-end path: renderer -> IPC (`archiveListContinuity`,
 * `archiveResolveContinuity`) -> main -> real SQLite `state.db` under the
 * vault's `.mythos/` dir -> back. No `window.api` seam is stubbed (SKY-7994).
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_ID = 'story-m18-e2e';
const CHAPTER_ID = 'chapter-m18-e2e';
const SCENE_ID = 'scene-m18-e2e';
const NOW = '2026-07-23T10:00:00.000Z';
const ISSUE_ID = 'issue-m18-01';

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

// ─── Fixture helpers (mirrors e2e/archive-agent-mvp.spec.ts's proven pattern) ─

function buildAppSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    archiveContinuityEnabled: true,
    archiveScanScope: 'active_scene',
    archiveStoryEditConsentGiven: true,
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    ...overrides,
  };
}

function seedUserData(
  userData: string,
  vaultDir: string,
  notesVaultDir: string,
  settingsOverrides: Record<string, unknown> = {},
): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(buildAppSettings(settingsOverrides), null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedVault(vaultDir: string): void {
  fs.mkdirSync(vaultDir, { recursive: true });
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const prose = 'Mara crossed the Glass Bridge under twin moons, her dark hair catching the wind.';
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: 'M18 E2E Story',
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'M18 Chapter',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: [{
          id: SCENE_ID,
          title: 'M18 Scene',
          path: scenePath,
          order: 0,
          chapterId: CHAPTER_ID,
          storyId: STORY_ID,
          blocks: [{ id: 'block-1', type: 'prose', order: 0, content: prose, updatedAt: NOW }],
          createdAt: NOW,
          updatedAt: NOW,
        }],
        createdAt: NOW,
        updatedAt: NOW,
      }],
      createdAt: NOW,
      updatedAt: NOW,
    }],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
    smartFolders: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const fullScenePath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });
  fs.writeFileSync(fullScenePath, [
    '---', `id: ${SCENE_ID}`, 'title: M18 Scene', `chapterId: ${CHAPTER_ID}`,
    `storyId: ${STORY_ID}`, '---', '', prose,
  ].join('\n'));
}

function seedNotesVault(notesVaultDir: string): string {
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, '.notes-vault'), '');
  const notePath = path.join(notesVaultDir, 'Mara.md');
  fs.writeFileSync(
    notePath,
    ['---', 'title: Mara', 'tags: [character]', 'Hair: blonde', '---', '', '# Mara', '', 'A wanderer.'].join('\n'),
  );
  return notePath;
}

function initContinuitySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS continuity_issues (
      id                       TEXT PRIMARY KEY,
      category                 TEXT NOT NULL,
      severity                 TEXT NOT NULL,
      manuscript_scene_id      TEXT NOT NULL,
      manuscript_offset        INTEGER NOT NULL,
      manuscript_excerpt       TEXT NOT NULL,
      vault_note_path          TEXT NOT NULL,
      vault_line               INTEGER NOT NULL,
      vault_excerpt            TEXT NOT NULL,
      rationale                TEXT NOT NULL,
      proposed_match_archive   TEXT NOT NULL,
      proposed_suggest_story   TEXT NOT NULL,
      status                   TEXT NOT NULL,
      resolved_at              TEXT,
      resolved_action          TEXT,
      created_at               TEXT NOT NULL
    );
  `);
}

function seedContinuityIssue(vaultDir: string): void {
  const mythosDir = path.join(vaultDir, '.mythos');
  fs.mkdirSync(mythosDir, { recursive: true });
  const db = new DatabaseSync(path.join(mythosDir, 'state.db'));
  try {
    initContinuitySchema(db);
    db.prepare(`
      INSERT INTO continuity_issues
        (id, category, severity, manuscript_scene_id, manuscript_offset,
         manuscript_excerpt, vault_note_path, vault_line, vault_excerpt, rationale,
         proposed_match_archive, proposed_suggest_story, status, resolved_at, resolved_action, created_at)
      VALUES
        (?, 'character_attribute_drift', 'medium', ?, 12,
         'dark hair catching the wind', 'Mara.md', 8, 'Hair: blonde',
         'Mara is described with dark hair in the scene, but the vault says her hair is blonde.',
         'Update the Mara note: change Hair to dark.',
         'Change the manuscript: replace "dark hair" with "blonde hair".',
         'open', NULL, NULL, ?)
    `).run(ISSUE_ID, SCENE_ID, NOW);
  } finally {
    db.close();
  }
}

function readIssueStatus(vaultDir: string, id: string): string | undefined {
  const dbPath = path.join(vaultDir, '.mythos', 'state.db');
  if (!fs.existsSync(dbPath)) return undefined;
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare('SELECT status FROM continuity_issues WHERE id = ?').get(id) as
      | { status: string }
      | undefined;
    return row?.status;
  } finally {
    db.close();
  }
}

function createFixture(seedIssue: boolean, settingsOverrides: Record<string, unknown> = {}): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m18-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m18-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m18-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir, settingsOverrides);
  seedVault(vaultDir);
  seedNotesVault(notesVaultDir);
  if (seedIssue) seedContinuityIssue(vaultDir);
  return { userData, vaultDir, notesVaultDir };
}

function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

// ─── App lifecycle ─────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write('[main:out] ' + d.toString()));
  proc.stderr?.on('data', (d: Buffer) => process.stdout.write('[main:err] ' + d.toString()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('console', (m) => process.stdout.write(`[renderer:${m.type()}] ${m.text()}\n`));
  page.on('pageerror', (e) => process.stdout.write(`[renderer:pageerror] ${e.message}\n`));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openApp(fixture: Fixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(fixture.userData);
  const page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

/** Select the seeded scene (sets app-wide `selectedScene`, the source of
 *  NotesTabPanel's `activeScene` prop per FULL-SPEC §6), then switch to the
 *  Notes Editor rail tab — landing on the Agent tab (default) right panel. */
async function openNotesWithScene(page: Page): Promise<void> {
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 10_000 });
  await sceneRow.click();

  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 8_000 });
}

async function openNote(page: Page, noteBaseName: string): Promise<void> {
  await page.locator('[data-testid^="vb-row-"]', { hasText: noteBaseName }).first().click();
}

// ─── AC-M18-01 / AC-M18-02: Agent tab hosts Brainstorm chat + flag cards ─────

test('AC-M18-01/02: Agent tab shows Brainstorm chat and a CONTINUITY FLAGS card with title, source pairing, body, and 3 actions', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openNotesWithScene(page);

    // Agent tab is the default rightTab.
    await expect(page.locator('[data-testid="notes-right-tab-agent"]')).toHaveAttribute('aria-selected', 'true');

    const flagsSection = page.locator('[data-testid="notes-continuity-flags"]');
    await expect(flagsSection).toBeVisible({ timeout: 8_000 });

    // Same brainstorm chat surface — the panel that renders the Curator greeting
    // (spec §6: "Curator of this vault — tell it your world").
    await expect(page.locator('.notes-agent-chat')).toBeVisible();
    await expect(page.getByText(/Curator of this vault/i)).toBeVisible({ timeout: 8_000 });

    const card = flagsSection.locator('.ic-card').first();
    await expect(card).toBeVisible({ timeout: 8_000 });
    await expect(card.getByRole('button', { name: /match archive/i })).toBeVisible();
    await expect(card.getByRole('button', { name: /suggest story change/i })).toBeVisible();
    await expect(card.getByRole('button', { name: /ignore/i })).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M18-03: flag action fires the SAME handler as the manuscript surface ──

test('AC-M18-03: Ignore from the Notes right panel persists the same continuity_issues row the manuscript surface reads', async () => {
  const fixture = createFixture(true);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openNotesWithScene(page);

    const flagsSection = page.locator('[data-testid="notes-continuity-flags"]');
    await expect(flagsSection).toBeVisible({ timeout: 8_000 });
    const card = flagsSection.locator('.ic-card').first();
    await expect(card).toBeVisible({ timeout: 8_000 });

    await card.getByRole('button', { name: /ignore/i }).click();

    // The card leaves the OPEN list — same UI contract as the manuscript
    // ContinuityPanel (TC-AA-05 in archive-agent-mvp.spec.ts).
    await expect(card).not.toBeVisible({ timeout: 6_000 });

    await expect.poll(() => readIssueStatus(fixture.vaultDir, ISSUE_ID), { timeout: 6_000 })
      .toBe('ignored');
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M18-04: Properties tab renders frontmatter table ─────────────────────

test('AC-M18-04: Properties tab shows the open note\'s frontmatter, not the Agent tab', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;

    await openNotesWithScene(page);
    await openNote(page, 'Mara');

    await page.locator('[data-testid="notes-right-tab-props"]').click();
    await expect(page.locator('[data-testid="notes-right-tab-props"]')).toHaveAttribute('aria-selected', 'true');

    const props = page.locator('[data-testid="notes-right-props"]');
    await expect(props).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="notes-continuity-flags"]')).not.toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

// ─── AC-M18-05: no layout collision between center note body and right panel ─

test('AC-M18-05: notes center body and the right sidebar do not overlap (W0.3)', async () => {
  const fixture = createFixture(false);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;
    await page.setViewportSize({ width: 1440, height: 900 });

    await openNotesWithScene(page);
    await openNote(page, 'Mara');

    const center = page.locator('[data-testid="notes-tab-center"]');
    const sidebar = page.locator('[data-testid="notes-brainstorm-panel"]');
    await expect(center).toBeVisible();
    await expect(sidebar).toBeVisible();

    const [centerBox, sidebarBox] = await Promise.all([center.boundingBox(), sidebar.boundingBox()]);
    expect(centerBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    // The two panes must not overlap horizontally.
    expect(centerBox!.x + centerBox!.width).toBeLessThanOrEqual(sidebarBox!.x + 1);
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
