/**
 * continuity-panel.spec.ts — SKY-1742
 *
 * Archive Agent v1 E2E coverage for the global right-sidebar Continuity panel
 * and InconsistencyCard flow. The suite seeds continuity_issues in the real
 * SQLite state DB under the Story Vault; no renderer IPC mocks are used.
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const STORY_ID = 'story-continuity-e2e';
const CHAPTER_ID = 'chapter-continuity-e2e';
const SCENE_ID = 'scene-continuity-e2e';
const NOW = '2026-06-16T08:00:00.000Z';

interface ContinuitySeed {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status?: 'open' | 'resolved' | 'ignored';
  manuscriptExcerpt?: string;
  vaultExcerpt?: string;
  rationale?: string;
}

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
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
        enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    rightSidebarVisible: true,
    rightSidebarWidth: 360,
    rightSidebarPanels: [{ id: 'archive-continuity', collapsed: false }],
    archiveStoryEditConsentGiven: true,
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

function seedVault(vaultDir: string): void {
  fs.mkdirSync(vaultDir, { recursive: true });
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: 'Continuity E2E Story',
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'Continuity Chapter',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: [{
          id: SCENE_ID,
          title: 'Continuity Scene',
          path: scenePath,
          order: 0,
          chapterId: CHAPTER_ID,
          storyId: STORY_ID,
          blocks: [],
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
    '---',
    `id: ${SCENE_ID}`,
    'title: Continuity Scene',
    `chapterId: ${CHAPTER_ID}`,
    `storyId: ${STORY_ID}`,
    '---',
    '',
    'Mara crossed the Glass Bridge under twin moons.',
  ].join('\n'));
}

function createContinuitySchema(db: DatabaseSync): void {
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
    CREATE TABLE IF NOT EXISTS archive_audit_log (
      id           TEXT PRIMARY KEY,
      action       TEXT NOT NULL,
      source       TEXT NOT NULL,
      item_id      TEXT NOT NULL,
      target_path  TEXT,
      changed_from TEXT,
      changed_to   TEXT,
      scene_id     TEXT,
      reason       TEXT,
      created_at   TEXT NOT NULL
    );
  `);
}

function seedContinuityIssues(vaultDir: string, issues: ContinuitySeed[]): void {
  const mythosDir = path.join(vaultDir, '.mythos');
  fs.mkdirSync(mythosDir, { recursive: true });
  const db = new DatabaseSync(path.join(mythosDir, 'state.db'));
  try {
    createContinuitySchema(db);
    const insert = db.prepare(`
      INSERT INTO continuity_issues
        (id, category, severity, manuscript_scene_id, manuscript_offset, manuscript_excerpt,
         vault_note_path, vault_line, vault_excerpt, rationale, proposed_match_archive,
         proposed_suggest_story, status, resolved_at, resolved_action, created_at)
      VALUES
        (?, 'character_attribute_drift', ?, ?, 12, ?, 'Universes/Aster/Characters/Mara.md',
         8, ?, ?, 'Update Mara note to say the bridge appears at night.',
         'Change the manuscript to match the daylight-only bridge note.', ?, NULL, NULL, ?)
    `);
    for (const issue of issues) {
      insert.run(
        issue.id,
        issue.severity,
        SCENE_ID,
        issue.manuscriptExcerpt ?? 'Glass Bridge under twin moons',
        issue.vaultExcerpt ?? 'Glass Bridge only appears in daylight',
        issue.rationale ?? 'The manuscript places Mara on the Glass Bridge at night, but the vault says it only appears in daylight.',
        issue.status ?? 'open',
        NOW,
      );
    }
  } finally {
    db.close();
  }
}

function readContinuityStatus(vaultDir: string, id: string): string | undefined {
  const db = new DatabaseSync(path.join(vaultDir, '.mythos', 'state.db'));
  try {
    const row = db.prepare('SELECT status FROM continuity_issues WHERE id = ?').get(id) as { status: string } | undefined;
    return row?.status;
  } finally {
    db.close();
  }
}

function createFixture(issues: ContinuitySeed[] = []): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cont-panel-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cont-panel-story-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cont-panel-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  seedVault(vaultDir);
  seedContinuityIssues(vaultDir, issues);
  return { userData, vaultDir, notesVaultDir };
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
  const page = await app.firstWindow();
  page.on('console', (m) => console.log(`[renderer:${m.type()}]`, m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openApp(fixture: Fixture): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchApp(fixture.userData);
  const page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await expect(page.getByTestId('global-right-sidebar')).toBeVisible({ timeout: 12_000 });
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
  } catch {
    // already exited
  }
}

function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.userData, { recursive: true, force: true });
  fs.rmSync(fixture.vaultDir, { recursive: true, force: true });
  fs.rmSync(fixture.notesVaultDir, { recursive: true, force: true });
}

test('TC-CP-01: right sidebar renders the Continuity panel empty state', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;
    const sidebar = page.getByTestId('global-right-sidebar');
    await expect(sidebar.getByRole('button', { name: /continuity panel/i })).toBeVisible();
    await expect(sidebar.locator('[data-panel-id="archive-continuity"]')).toBeVisible();
    await expect(sidebar.getByText('Save your scene to check for continuity issues.')).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /scan now for continuity issues/i })).toBeVisible();
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('TC-CP-02: seeded SQLite inconsistency renders, dismisses, and stays gone after restart', async () => {
  const fixture = createFixture([{ id: 'inc-dismiss', severity: 'medium' }]);
  let app: ElectronApplication | undefined;
  try {
    let opened = await openApp(fixture);
    app = opened.app;
    let page = opened.page;
    const sidebar = page.getByTestId('global-right-sidebar');

    const card = sidebar.getByRole('listitem', { name: /medium character attribute drift/i });
    await expect(card).toBeVisible({ timeout: 12_000 });
    await expect(card.getByRole('img', { name: /medium severity/i })).toBeVisible();
    await expect(card.getByTitle(/Glass Bridge under twin moons/)).toBeVisible();
    await expect(card.getByTitle(/Glass Bridge only appears in daylight/)).toBeVisible();
    await expect(card.getByRole('button', { name: /match archive to story/i })).toBeVisible();
    await expect(card.getByRole('button', { name: /suggest story change/i })).toBeVisible();

    const badge = card.getByRole('img', { name: /medium severity/i });
    await expect(badge).toHaveClass(/ic-severity-badge--medium/);
    await expect.poll(async () => badge.evaluate((el) => {
      const styles = getComputedStyle(el);
      const expected = getComputedStyle(document.documentElement).getPropertyValue('--ln-severity-medium-bg').trim();
      return { actual: styles.backgroundColor, expected };
    })).toEqual({ actual: 'rgba(234, 179, 8, 0.18)', expected: 'rgba(234, 179, 8, 0.18)' });

    await card.getByRole('button', { name: /dismiss/i }).click();
    await expect(sidebar.getByText(/Glass Bridge under twin moons/)).toBeHidden({ timeout: 8_000 });
    await closeApp(app);
    app = undefined;
    expect(readContinuityStatus(fixture.vaultDir, 'inc-dismiss')).toBe('ignored');

    opened = await openApp(fixture);
    app = opened.app;
    page = opened.page;
    await expect(page.getByTestId('global-right-sidebar').getByText(/Glass Bridge under twin moons/)).toBeHidden({ timeout: 8_000 });
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});

test('TC-CP-03: Match Archive resolution removes the card and persists resolved status', async () => {
  const fixture = createFixture([{ id: 'inc-resolve', severity: 'high' }]);
  let app: ElectronApplication | undefined;
  try {
    const opened = await openApp(fixture);
    app = opened.app;
    const page = opened.page;
    const sidebar = page.getByTestId('global-right-sidebar');
    const card = sidebar.getByRole('listitem', { name: /high character attribute drift/i });
    await expect(card).toBeVisible({ timeout: 12_000 });

    await card.getByRole('button', { name: /match archive to story/i }).click();
    await expect(sidebar.getByText('Proposed vault change')).toBeVisible();
    await card.getByRole('button', { name: /apply vault change/i }).click();

    await expect.poll(() => readContinuityStatus(fixture.vaultDir, 'inc-resolve')).toBe('resolved');
    await expect(sidebar.getByText(/Glass Bridge under twin moons/)).toBeHidden({ timeout: 8_000 });
    await closeApp(app);
    app = undefined;
    expect(readContinuityStatus(fixture.vaultDir, 'inc-resolve')).toBe('resolved');
  } finally {
    await closeApp(app);
    cleanupFixture(fixture);
  }
});
