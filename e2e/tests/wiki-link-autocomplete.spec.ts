/**
 * wiki-link-autocomplete.spec.ts — SKY-5702 (GH#650 WL-1)
 *
 * Playwright E2E tests for the [[ wiki-link autocomplete popup in the scene editor.
 *
 * Acceptance criteria covered:
 *   WL-01  Typing '[[' opens the autocomplete picker, listing cross-vault candidates
 *   WL-02  Selecting a candidate inserts a resolved, clickable [[link]]
 *   WL-03  A target with no match offers a "create" option, which inserts an
 *          unresolved link (visually distinct via .wiki-link-unresolved)
 *   WL-04  Keyboard ArrowDown + Enter selects a candidate
 *   WL-05  Escape dismisses the picker without inserting
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
const STORY_TITLE = 'Wiki Link Chronicle';
const CHAPTER_TITLE = 'Prologue';
const SCENE_TITLE = 'The Gate';
const ENTITY_NAME = 'Corven Ashgate';
const UNKNOWN_TARGET = 'Nobody Ever Wrote This';

// ─── Helpers (mirrors entity-mention.spec.ts / entity-system.spec.ts) ─────────

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


// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wikilink-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wikilink-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wikilink-notes-'));

  seedUserData(userData, vaultDir, notesVaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── Setup: create an entity (ENTITY_CREATE indexes it synchronously) and a scene ──

test('WL-00: boot app, create an entity, and create a story/chapter/scene', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Create entity via Entity Browser CreateDialog — ENTITY_CREATE calls
  // syncEntityToIndex() synchronously, so it's searchable immediately (no
  // watcher-debounce race, unlike scene prose which only reindexes on the
  // next file-watcher tick).
  const entitiesPanel = page.locator('[data-panel-id="entities"]');
  const epCollapsed = await entitiesPanel.evaluate(el => el.classList.contains('lr-panel--collapsed')).catch(() => false);
  if (epCollapsed) await entitiesPanel.locator('.lr-panel-collapse-btn').click();
  await expect(page.locator('.entity-browser')).toBeVisible({ timeout: 6_000 });

  await page.locator('.entity-btn.entity-btn-primary.entity-btn-sm').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await dialog.locator('.entity-dialog-input').first().fill(ENTITY_NAME);
  await dialog.locator('.entity-btn.entity-btn-primary').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });
  await expect(page.locator('.entity-item-name', { hasText: ENTITY_NAME })).toBeVisible({ timeout: 8_000 });

  // Create story / chapter / scene
  const storiesPanel = page.locator('[data-panel-id="stories"]');
  const spCollapsed = await storiesPanel.evaluate(el => el.classList.contains('lr-panel--collapsed')).catch(() => false);
  if (spCollapsed) await storiesPanel.locator('.lr-panel-collapse-btn').click();

  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });

  await sceneRow.click();
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 10_000 });
});

// ─── WL-01 / WL-02: typing [[ opens the picker; selecting inserts a resolved link ──

test('WL-01/02: typing [[ opens the picker, filters to the entity, and selecting inserts a resolved link', async () => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await editor.type('He stood before [[Corven');

  const picker = page.locator('.wiki-link-picker');
  await expect(picker).toBeVisible({ timeout: 8_000 });
  await expect(picker).toContainText(ENTITY_NAME, { timeout: 8_000 });

  const item = picker.locator('.wiki-link-picker-item', { hasText: ENTITY_NAME }).first();
  await item.dispatchEvent('mousedown');
  await expect(picker).toBeHidden({ timeout: 3_000 });

  const link = page.locator(`[data-wiki-link="${ENTITY_NAME}"]`);
  await expect(link).toBeVisible({ timeout: 4_000 });
  await expect(link).toContainText(`[[${ENTITY_NAME}]]`);
  await expect(link).not.toHaveClass(/wiki-link-unresolved/);
});

// ─── WL-03: an unmatched target offers "create" and renders as unresolved ─────

test('WL-03: an unmatched target offers a "create" option and renders unresolved', async () => {
  const editor = page.locator('.ProseMirror');
  // No mouse click here: the scene already contains the [[Corven Ashgate]]
  // link from WL-01/02, and SKY-2099's plainTextWikiLinkFallback matches
  // against the whole paragraph's textContent — a real click anywhere in
  // that paragraph (not just on the link node) re-activates navigation
  // instead of just focusing the editor. `.press()` focuses via the DOM
  // focus() API without dispatching a click, which sidesteps that fallback.
  await editor.press('End');
  await editor.press('Enter');
  await editor.type(`[[${UNKNOWN_TARGET}`);

  const picker = page.locator('.wiki-link-picker');
  await expect(picker).toBeVisible({ timeout: 8_000 });
  const createItem = picker.locator('.wiki-link-picker-item--create');
  await expect(createItem).toBeVisible({ timeout: 8_000 });
  await expect(createItem).toContainText(UNKNOWN_TARGET);

  await createItem.dispatchEvent('mousedown');
  await expect(picker).toBeHidden({ timeout: 3_000 });

  const link = page.locator(`[data-wiki-link="${UNKNOWN_TARGET}"]`);
  await expect(link).toBeVisible({ timeout: 4_000 });
  await expect(link).toHaveClass(/wiki-link-unresolved/);
});

// ─── WL-04: keyboard ArrowDown + Enter selects a candidate ────────────────────

test('WL-04: keyboard ArrowDown + Enter inserts a resolved link', async () => {
  const editor = page.locator('.ProseMirror');
  await editor.press('End'); // focuses via DOM focus(), no click — see WL-03 comment
  await editor.press('Enter');
  // Type the exact full title so the picker has exactly one item (the
  // candidate) — a partial query would also produce a trailing "create"
  // item, and ArrowDown would land on that instead of the real match.
  await editor.type(`[[${ENTITY_NAME}`);

  const picker = page.locator('.wiki-link-picker');
  await expect(picker).toBeVisible({ timeout: 8_000 });
  await expect(picker).toContainText(ENTITY_NAME, { timeout: 8_000 });
  await expect(picker.locator('.wiki-link-picker-item')).toHaveCount(1);

  // Single-item list: ArrowDown clamps back to the same (only) index.
  await editor.press('ArrowDown');
  await editor.press('Enter');
  await expect(picker).toBeHidden({ timeout: 3_000 });

  const links = page.locator(`[data-wiki-link="${ENTITY_NAME}"]`);
  await expect(links).toHaveCount(2, { timeout: 4_000 });
});

// ─── WL-05: Escape dismisses the picker without inserting ────────────────────

test('WL-05: Escape dismisses the picker without inserting a link', async () => {
  const editor = page.locator('.ProseMirror');
  await editor.press('End'); // focuses via DOM focus(), no click — see WL-03 comment
  await editor.press('Enter');
  await editor.type('[[Corven');

  const picker = page.locator('.wiki-link-picker');
  await expect(picker).toBeVisible({ timeout: 8_000 });

  await editor.press('Escape');
  await expect(picker).toBeHidden({ timeout: 3_000 });

  // The typed text remains as plain text, not converted to a link node.
  await expect(editor).toContainText('[[Corven');
  const links = page.locator(`[data-wiki-link="${ENTITY_NAME}"]`);
  await expect(links).toHaveCount(2, { timeout: 4_000 }); // unchanged from WL-04
});
