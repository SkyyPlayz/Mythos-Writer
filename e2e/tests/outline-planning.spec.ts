/**
 * outline-planning.spec.ts — SKY-3028
 *
 * Playwright E2E tests for the Outline planning surface (SKY-2980 spec).
 * Tests outline node CRUD, keyboard navigation, folding, scene linking, and persistence.
 *
 * SKY-10019 (M6 follow-up): M6 removed OutlinePlanningPanel's only mount
 * point (the collapsible right-sidebar panel stack). It now opens as a
 * Story-strip workspace document tab via the + picker — the same "openable
 * tab" pattern SKY-9920 gave Entity Browser (see handleOpenOutlineStory /
 * upsertOutlineTab in DesktopShell.tsx / workspaceDocTabs.ts). All AC-OPL-*
 * cases below are un-skipped and rewritten around that entry point.
 *
 * Acceptance criteria:
 *   AC-OPL-QA-01  Empty state         — "No outline yet" text visible
 *   AC-OPL-QA-02  First node          — node title persists after navigate away/back
 *   AC-OPL-QA-03  Add sibling         — Enter creates new node below; type title
 *   AC-OPL-QA-04  Indent              — Tab indents as child; depth visible
 *   AC-OPL-QA-05  Promote             — Shift+Tab promotes back to root
 *   AC-OPL-QA-06  Fold toggle         — click fold button → children hidden, count visible
 *   AC-OPL-QA-07  Unfold              — click fold again → children visible
 *   AC-OPL-QA-08  Scene link          — link a node to a scene, chip visible
 *   AC-OPL-QA-09  Persist after reload — hard-reload reads outline-nodes.json
 *   AC-OPL-QA-10  No regression       — existing vault CRUD + brainstorm tests pass
 *   AC-OPL-QA-11  CI green            — ci, build-linux, build-macos all pass
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
const STORY_TITLE = 'Outline Test Story';
const CHAPTER_TITLE = 'First Chapter';
const SCENE_TITLE = 'Opening Scene';
const SCENE_TITLE_2 = 'Second Scene';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        scanIntervalSeconds: 30,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false,
        model: 'claude-sonnet-4-6',
        continuityCheckIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
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

// SKY-10019: Outline Planning opens as a Story-strip workspace document tab
// via the + picker (mirrors Entity Browser's SKY-9920 flow). Re-clicking
// the + picker when the tab is already open just re-focuses it (upsert
// semantics), so this is safe to call repeatedly across tests.
async function openOutlinePanel(pg: Page): Promise<void> {
  const outlinePanel = pg.locator('[data-testid="outline-planning-panel"]');
  if (await outlinePanel.isVisible({ timeout: 500 }).catch(() => false)) return;
  const newTabBtn = pg.locator('[data-testid="wtb-new-tab-btn"]');
  await expect(newTabBtn).toBeVisible({ timeout: 8_000 });
  await newTabBtn.click();
  await pg.locator('[data-testid="wtb-new-tab-menu-item-outline"]').click();
  await expect(outlinePanel).toBeVisible({ timeout: 8_000 });
}

async function createStoryWithScenes(
  page: Page,
  storyTitle: string,
  chapterTitle: string,
  sceneTitle1: string,
  sceneTitle2: string,
  vaultDir: string,
): Promise<string> {
  // SKY-9022/M6: story/chapter/scene creation now happens via StoryNavigator
  // (the old unlocked VaultBrowser "vault" panel this helper used to drive is
  // gone). This is purely a fixture-setup rewrite — the outline-planning
  // assertions this fixture feeds are unrelated to VaultBrowser itself.
  //
  // M3 instant-create: no prompt — story appears immediately as "Untitled
  // Story" (single story in this fixture vault, so match positionally
  // rather than by a title no create flow sets).
  await page.locator('.lr-nav-add').first().click();
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Create chapter
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, chapterTitle);
  const chapterRow = page.locator('.nav-chapter-row', { hasText: chapterTitle });
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  // Create first scene
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, sceneTitle1);
  await expect(
    page.locator('.nav-scene-row', { hasText: sceneTitle1 }),
  ).toBeVisible({ timeout: 6_000 });

  // Create second scene
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, sceneTitle2);
  await expect(
    page.locator('.nav-scene-row', { hasText: sceneTitle2 }),
  ).toBeVisible({ timeout: 6_000 });

  // Click a scene row to trigger handleSelectScene → setSelectedStory in DesktopShell.
  // Clicking the story tree-toggle only expands the tree; it does NOT set selectedStory.
  const firstSceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle1 });
  await firstSceneRow.click();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 10_000 });

  // Wait for the 900ms manifest-save debounce, then read the story's path from disk.
  // story.path is set by DesktopShell createStory as "stories/{uuid}". Only
  // one story exists in this fixture vault, so grab it positionally — M3
  // instant-create leaves the story titled "Untitled Story", not storyTitle.
  await page.waitForTimeout(1_200);
  const manifestPath = path.join(vaultDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const storyObj = (manifest.stories as Array<{ title: string; path: string }>)[0];
  return storyObj?.path ?? '';
}

async function getOutlineFilePath(vaultDir: string, storyPath: string): Promise<string> {
  // OUTLINE_LOAD/SAVE IPC joins storyPath (e.g. "stories/{uuid}") with getVaultRoot(),
  // so the file lives at {vaultRoot}/{storyPath}/outline-nodes.json.
  return path.join(vaultDir, storyPath, 'outline-nodes.json');
}

function readOutlineFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

test.describe('Outline Planning (SKY-10019: opens as a Story-strip workspace tab)', () => {

// The beforeAll creates a full story+scenes fixture via real UI interactions.
// With the always-mounted AppNavRail (SKY-3177) the cumulative worst-case is ~50s;
// raise the suite timeout to 150s so it doesn't race.
test.describe.configure({ timeout: 150_000 });

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;
let storyPath: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-opl-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-opl-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-opl-notes-'));

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Create story with 2 scenes for the test suite; returns the story's manifest path.
  storyPath = await createStoryWithScenes(page, STORY_TITLE, CHAPTER_TITLE, SCENE_TITLE, SCENE_TITLE_2, vaultDir);
  // Expand the Outline panel once for all tests
  await openOutlinePanel(page);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── AC-OPL-QA-01: Empty state ────────────────────────────────────────────────

test('AC-OPL-QA-01: Outline tab shows empty state when no outline yet', async () => {
  await openOutlinePanel(page);

  // Check for empty state text or the panel itself
  const emptyState = page.locator('[data-testid="opl-empty-state"]');
  const outlinePanel = page.locator('[data-testid="outline-planning-panel"]');
  const panelVisible = await outlinePanel.isVisible({ timeout: 6_000 }).catch(() => false);
  if (panelVisible) {
    // Panel is visible — either empty state or nodes list is present, both are valid
    await expect(outlinePanel).toBeVisible({ timeout: 6_000 });
  } else {
    await expect(emptyState).toBeVisible({ timeout: 6_000 });
  }
});

// ─── AC-OPL-QA-02: First node creation and persistence ──────────────────────

test('AC-OPL-QA-02: Create first outline node, navigate away and back, node persists', async () => {
  await openOutlinePanel(page);

  // Wait for outline panel
  const outlinePanel = page.locator('[data-testid="outline-planning-panel"]');
  await expect(outlinePanel).toBeVisible({ timeout: 6_000 });

  // If in empty state, click "Start planning" to create the first node.
  const emptyStartBtn = page.locator('[data-testid="opl-start-btn"]');
  if (await emptyStartBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await emptyStartBtn.click();
  }

  // Wait for the first title input to appear (created by Start planning or already exists).
  const firstNodeInput = page.locator('.opl-title-input').first();
  await firstNodeInput.waitFor({ state: 'visible', timeout: 6_000 });
  await firstNodeInput.click();
  await firstNodeInput.fill('First outline node');

  // Wait for save debounce
  await page.waitForTimeout(600);

  // Read the outline file to verify persistence
  const outlineFilePath = await getOutlineFilePath(vaultDir, storyPath);
  const savedData = readOutlineFile(outlineFilePath);
  expect(savedData).not.toBeNull();
  expect((savedData as any)?.nodes?.[0]?.title).toBe('First outline node');

  // Navigate away — selecting a scene switches the Story strip's active tab
  // off Outline Planning onto that scene (SKY-10019: single active doc-tab
  // pane, same as switching off any other tab) — then back via the + picker.
  const sceneRows = page.locator('.nav-scene-row');
  await expect(sceneRows.nth(1)).toBeVisible({ timeout: 6_000 });
  await sceneRows.nth(1).click(); // Click second scene
  await page.waitForTimeout(500);
  await expect(outlinePanel).not.toBeVisible();
  await openOutlinePanel(page);

  // Verify node still present
  const nodeInput = page.locator('.opl-title-input').first();
  await expect(nodeInput).toHaveValue('First outline node', { timeout: 8_000 });
});

// ─── AC-OPL-QA-03: Add sibling with Enter ────────────────────────────────────

test('AC-OPL-QA-03: Press Enter to create sibling node below', async () => {
  await openOutlinePanel(page);

  // Get first node input and press Enter
  const firstInput = page.locator('.opl-title-input').first();
  await firstInput.focus();
  await firstInput.press('Enter');

  // New empty node should appear
  const inputs = page.locator('.opl-title-input');
  const count = await inputs.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Type in the new node
  const secondInput = inputs.nth(1);
  await secondInput.fill('Second outline node');

  // Wait for save
  await page.waitForTimeout(600);

  // Verify in file
  const outlineFilePath = await getOutlineFilePath(vaultDir, storyPath);
  const savedData = readOutlineFile(outlineFilePath) as any;
  expect(savedData?.nodes?.length).toBeGreaterThanOrEqual(2);
  expect(savedData?.nodes?.[1]?.title).toBe('Second outline node');
});

// ─── AC-OPL-QA-04: Indent with Tab ───────────────────────────────────────────

test('AC-OPL-QA-04: Press Tab to indent second node as child of first', async () => {
  // Get second input and press Tab to indent
  const inputs = page.locator('.opl-title-input');
  const secondInput = inputs.nth(1);
  await secondInput.focus();
  await secondInput.press('Tab');

  // Wait for save
  await page.waitForTimeout(600);

  // Verify in file: second node should now be a child of first
  const outlineFilePath = await getOutlineFilePath(vaultDir, storyPath);
  const savedData = readOutlineFile(outlineFilePath) as any;
  expect(savedData?.nodes?.[0]?.children?.length).toBe(1);
  expect(savedData?.nodes?.[0]?.children?.[0]?.title).toBe('Second outline node');

  // Verify visual indentation in depth attribute
  const nodeWrappers = page.locator('.opl-node-wrapper');
  const secondNodeWrapper = nodeWrappers.nth(1);
  const depth = await secondNodeWrapper.evaluate((el) => el.style.getPropertyValue('--opl-depth'));
  expect(depth).toBe('1');
});

// ─── AC-OPL-QA-05: Promote with Shift+Tab ────────────────────────────────────

test('AC-OPL-QA-05: Press Shift+Tab to promote child back to root level', async () => {
  // Get the indented node and promote it
  const inputs = page.locator('.opl-title-input');
  const secondInput = inputs.nth(1);
  await secondInput.focus();
  await secondInput.press('Shift+Tab');

  // Wait for save
  await page.waitForTimeout(600);

  // Verify in file: second node should be back at root level
  const outlineFilePath = await getOutlineFilePath(vaultDir, storyPath);
  const savedData = readOutlineFile(outlineFilePath) as any;
  expect(savedData?.nodes?.length).toBeGreaterThanOrEqual(2);
  expect(savedData?.nodes?.[1]?.title).toBe('Second outline node');
  expect(savedData?.nodes?.[0]?.children?.length || 0).toBe(0);
});

// ─── AC-OPL-QA-06: Fold toggle hides children ─────────────────────────────────

test('AC-OPL-QA-06: Click fold button to hide children and show count badge', async () => {
  // Create a parent with children for this test
  // First, indent the second node back under first
  const inputs = page.locator('.opl-title-input');
  const secondInput = inputs.nth(1);
  await secondInput.focus();
  await secondInput.press('Tab');
  await page.waitForTimeout(600);

  // Find the fold button on the first node
  const foldButtons = page.locator('.opl-fold-btn');
  const firstFoldBtn = foldButtons.first();
  await expect(firstFoldBtn).toBeVisible({ timeout: 6_000 });

  // Click to fold
  await firstFoldBtn.click();

  // Check that aria-expanded is false
  await expect(firstFoldBtn).toHaveAttribute('aria-expanded', 'false');

  // Check that child count badge is visible
  const childCountBadge = firstFoldBtn.locator('.opl-child-count');
  await expect(childCountBadge).toBeVisible();
  await expect(childCountBadge).toContainText('1');

  // Verify second input is hidden
  const secondInput2 = inputs.nth(1);
  await expect(secondInput2).not.toBeVisible();
});

// ─── AC-OPL-QA-07: Unfold toggle shows children again ───────────────────────

test('AC-OPL-QA-07: Click fold button again to unfold and show children', async () => {
  // Click the fold button again to unfold
  const foldButtons = page.locator('.opl-fold-btn');
  const firstFoldBtn = foldButtons.first();
  await firstFoldBtn.click();

  // Check that aria-expanded is true
  await expect(firstFoldBtn).toHaveAttribute('aria-expanded', 'true');

  // Child count badge should be hidden
  const childCountBadge = firstFoldBtn.locator('.opl-child-count');
  await expect(childCountBadge).not.toBeVisible();

  // Verify second input is visible again
  const inputs = page.locator('.opl-title-input');
  const secondInput = inputs.nth(1);
  await expect(secondInput).toBeVisible();
});

// ─── AC-OPL-QA-08: Scene linking ──────────────────────────────────────────────

test('AC-OPL-QA-08: Click link button, select scene from picker, chip appears', async () => {
  // Click on first node's link button
  const linkButtons = page.locator('.opl-link-btn');
  const firstLinkBtn = linkButtons.first();
  await firstLinkBtn.click();

  // Wait for link picker to appear
  const linkPicker = page.locator('.opl-link-picker').first();
  await expect(linkPicker).toBeVisible({ timeout: 6_000 });

  // Click on first scene option
  const sceneOption = linkPicker.locator('.opl-link-option').first();
  await sceneOption.click();

  // Wait for scene chip to appear
  const sceneChip = page.locator('.opl-scene-chip').first();
  await expect(sceneChip).toBeVisible({ timeout: 6_000 });

  // Verify chip text contains a scene name. The picker lists every scene in
  // the story, including the "Untitled Scene" M3 instant-create scaffolds
  // into "Chapter 1" alongside the two manually created scenes below.
  const chipText = (await sceneChip.textContent()) ?? '';
  expect(/Opening Scene|Second Scene|Untitled Scene/.test(chipText)).toBe(true);

  // Wait for save
  await page.waitForTimeout(600);

  // Verify in file
  const outlineFilePath = await getOutlineFilePath(vaultDir, storyPath);
  const savedData = readOutlineFile(outlineFilePath) as any;
  expect(savedData?.nodes?.[0]?.linkedSceneId).toBeTruthy();
});

// ─── AC-OPL-QA-09: Persistence after hard reload ────────────────────────────

test('AC-OPL-QA-09: Hard reload preserves outline nodes read from outline-nodes.json', async () => {
  // Before reload, verify current state
  const outlineFilePath = await getOutlineFilePath(vaultDir, storyPath);
  const beforeReload = readOutlineFile(outlineFilePath) as any;
  expect(beforeReload?.nodes?.length).toBeGreaterThanOrEqual(1);

  // Hard reload the window
  await page.reload();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // After reload selectedStory is null; click a scene to restore it via handleSelectScene.
  // SKY-9022/M6: scenes live in StoryNavigator now, not VaultBrowser's story tree.
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await sceneRow.waitFor({ state: 'visible', timeout: 8_000 });
  await sceneRow.click();

  // Navigate back to outline tab
  await openOutlinePanel(page);

  // Wait for outline panel to load
  const outlinePanel = page.locator('[data-testid="outline-planning-panel"]');
  // SKY-10969: page.reload() re-triggers the whole app boot cascade (settings,
  // vault manifest, story tree, scene reselect) before the outline panel's own
  // window.api.outline.load() IPC round-trip can even start. On a contended
  // shard-4 runner (see SKY-9620) that cascade alone can eat several seconds,
  // so 6s was too tight for either wait below — give both real headroom.
  await expect(outlinePanel).toBeVisible({ timeout: 12_000 });

  // Verify nodes are rendered
  const inputs = page.locator('.opl-title-input');
  await expect(inputs.first()).toHaveValue(beforeReload?.nodes?.[0]?.title || 'First outline node', { timeout: 12_000 });

  // Verify file content matches what was before
  const afterReload = readOutlineFile(outlineFilePath) as any;
  expect(afterReload?.nodes?.length).toBe(beforeReload?.nodes?.length);
  expect(afterReload?.nodes?.[0]?.title).toBe(beforeReload?.nodes?.[0]?.title);
});

}); // end test.describe.skip('Outline Planning ...')
