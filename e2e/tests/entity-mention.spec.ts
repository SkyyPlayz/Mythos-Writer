/**
 * entity-mention.spec.ts — SKY-616
 *
 * Playwright E2E tests for the @-mention autocomplete feature in the scene editor.
 *
 * Acceptance criteria covered:
 *   EM-01  Typing '@' opens the autocomplete picker
 *   EM-02  Query string filters entities by name / alias
 *   EM-03  Selecting an entry via click inserts a mention chip
 *   EM-04  Round-trip: scene with mention → save → reload → mention chip still present
 *   EM-05  Keyboard navigation: ArrowDown / Enter selects a mention
 *   EM-06  Escape dismisses the picker without inserting
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'Mention Chronicle';
const CHAPTER_TITLE = 'Prologue';
const SCENE_TITLE = 'The Meeting';
const ENTITY_ID = 'ent_mention_e2e_001';
const ENTITY_NAME = 'Lyra Ashveil';
const ENTITY_TYPE = 'character';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

/** Pre-seed an entity file in the story vault so it shows in the picker.
 *
 * Entities live in the story vault (vaultRoot), not the notes vault.
 * reindexEntities() scans vaultRoot/entities/<type>s/ on every entity:list
 * call and picks up any .md files not yet tracked in the manifest.
 */
function seedEntity(storyVaultDir: string): void {
  const now = new Date().toISOString();
  const dir = path.join(storyVaultDir, 'entities', `${ENTITY_TYPE}s`);
  fs.mkdirSync(dir, { recursive: true });
  const content = [
    '---',
    `id: ${ENTITY_ID}`,
    `name: ${ENTITY_NAME}`,
    `type: ${ENTITY_TYPE}`,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    '---',
    '',
    'A wandering scholar from the northern reaches.',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `${ENTITY_ID}.md`), content);
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
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mention-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mention-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-mention-notes-'));

  seedUserData(userData, vaultDir, notesVaultDir);
  seedEntity(vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── Setup: create story / chapter / scene ────────────────────────────────────

test('EM-00: boot app and create a story, chapter, and scene', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Ensure Stories tab
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  // Create story
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Create chapter
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  // Create scene
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });
  await expect(sceneRow).toContainText(SCENE_TITLE);
});

// ─── EM-01: Typing '@' opens the autocomplete picker ─────────────────────────

test('EM-01: typing @ in scene editor opens entity autocomplete picker', async () => {
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 10_000 });

  await editor.click();
  // Type some text then '@' to trigger the picker
  await editor.type('She met @');

  const picker = page.locator('.entity-mention-picker');
  // Allow extra time for entity list IPC to return on CI
  await expect(picker).toBeVisible({ timeout: 8_000 });
});

// ─── EM-02: Query string filters entities ─────────────────────────────────────

test('EM-02: typing query after @ filters entities by name', async () => {
  const editor = page.locator('.ProseMirror');
  await editor.type('Lyra');

  const picker = page.locator('.entity-mention-picker');
  await expect(picker).toBeVisible({ timeout: 4_000 });

  // Should show our seeded entity
  await expect(picker).toContainText(ENTITY_NAME);

  // Should show the type badge
  await expect(picker.locator('.entity-mention-picker-type')).toContainText('Char');
});

// ─── EM-03: Click to select inserts a chip ────────────────────────────────────

test('EM-03: clicking an entity in the picker inserts a chip in the editor', async () => {
  const picker = page.locator('.entity-mention-picker');
  await expect(picker).toBeVisible({ timeout: 4_000 });

  // Click the first (and only) item
  const firstItem = picker.locator('.entity-mention-picker-item').first();
  await firstItem.dispatchEvent('mousedown');

  // Picker should close
  await expect(picker).toBeHidden({ timeout: 3_000 });

  // Chip should appear in the editor
  const chip = page.locator('.entity-mention-chip');
  await expect(chip).toBeVisible({ timeout: 4_000 });
  await expect(chip).toContainText(`@${ENTITY_NAME}`);
});

// ─── EM-04: Round-trip (save → reload → mention persists) ────────────────────

test('EM-04: mention chip survives save and app reload', async () => {
  // Wait for the save to flush (debounced 800ms + some buffer)
  const mentionMarker = `(entity://${ENTITY_ID})`;
  const savedInFile = await waitUntil(() => {
    const files = findMdFiles(vaultDir);
    return files.some((f) => {
      try { return fs.readFileSync(f, 'utf-8').includes(mentionMarker); } catch { return false; }
    });
  }, 15_000);
  expect(savedInFile, `Mention "${mentionMarker}" not found in any vault .md file`).toBe(true);

  // Reload the app
  await app.close().catch(() => {});
  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate back to the scene.
  // StoryNavigator initialises with all stories/chapters expanded, so the scene row
  // is already visible — clicking story/chapter rows would only toggle them closed.
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  // Chip must still be rendered after reload
  const chip = page.locator('.entity-mention-chip');
  await expect(chip).toBeVisible({ timeout: 8_000 });
  await expect(chip).toContainText(`@${ENTITY_NAME}`);
});

// ─── EM-05: Keyboard navigation (ArrowDown + Enter) ──────────────────────────

test('EM-05: keyboard ArrowDown + Enter inserts a mention chip', async () => {
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await editor.click();

  // Type on a new line to open a fresh picker
  await editor.press('End');
  await editor.press('Enter');
  await editor.type('@Lyra');

  const picker = page.locator('.entity-mention-picker');
  await expect(picker).toBeVisible({ timeout: 4_000 });

  // ArrowDown selects the first item (already selected at index 0, this cycles to 0 again on a 1-item list)
  await editor.press('ArrowDown');
  // Enter inserts
  await editor.press('Enter');

  await expect(picker).toBeHidden({ timeout: 3_000 });

  // A second chip should now be present
  const chips = page.locator('.entity-mention-chip');
  await expect(chips).toHaveCount(2, { timeout: 4_000 });
});

// ─── EM-06: Escape dismisses picker without inserting ────────────────────────

test('EM-06: Escape dismisses the picker without inserting a chip', async () => {
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });
  await editor.click();

  await editor.press('End');
  await editor.press('Enter');
  await editor.type('@Lyra');

  const picker = page.locator('.entity-mention-picker');
  await expect(picker).toBeVisible({ timeout: 4_000 });

  // Press Escape to dismiss
  await editor.press('Escape');
  await expect(picker).toBeHidden({ timeout: 3_000 });

  // The text '@Lyra' should remain (not replaced by a chip)
  await expect(editor).toContainText('@Lyra');

  // Chip count should still be 2 from EM-05
  const chips = page.locator('.entity-mention-chip');
  await expect(chips).toHaveCount(2, { timeout: 4_000 });
});
