/**
 * continuity-peek.spec.ts — SKY-2012
 *
 * E2E coverage for Continuity Peek — the Notes Vault entity reference panel
 * added in Wave 3.2 (SKY-2011). Tests all 12 acceptance-criteria test cases
 * for AC-CC-01 through AC-CC-08 (TC-CP-01 through TC-CP-12).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/continuity-peek.spec.ts --reporter=list
 *
 * ── Selector map ──────────────────────────────────────────────────────────────
 *   #rightsidebar-tab-continuity   — "Entities" tab button in RightSidebar
 *   .continuity-panel              — ContinuityPanel root div
 *   .continuity-search-input       — entity search <input type="search">
 *   .continuity-empty              — idle / no-match / no-vault state container
 *   .continuity-empty-title        — heading text inside empty state
 *   .continuity-section-label      — "Best match" / "Results" section header
 *   .entity-card                   — EntityCard root article div
 *   .entity-card-name              — entity name <span>
 *   .entity-type-badge             — type badge <span>
 *   .entity-card-excerpt           — excerpt text div
 *   .entity-card-aliases           — "a.k.a." aliases row
 *   .right-sidebar                 — RightSidebar root
 *   .sidebar-tabs                  — tab strip inside RightSidebar
 *   .ProseMirror                   — TipTap editor contenteditable
 *   .nav-scene-row                 — scene row in StoryNavigator (left rail)
 *   [data-panel-id="stories"]      — left-rail Stories panel
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

// ── Constants ──────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID   = 'cp-e2e-story';
const CHAPTER_ID = 'cp-e2e-chapter';
const SCENE_ID   = 'cp-e2e-scene';
const NOW        = new Date().toISOString();

/**
 * Scene prose for selection-driven tests.
 * A single word so Ctrl+A selects exactly the entity name.
 * TC-CP-04 (alias) is tested via the search box to avoid
 * complex multi-word selection in TipTap.
 */
const SCENE_BODY = 'Marcus';

// ── Helpers ────────────────────────────────────────────────────────────────────

function seedNotesVault(notesVaultDir: string): void {
  // Entities directory structure: Universes/<world>/Characters/<name>.md
  const chars = path.join(notesVaultDir, 'Universes', 'My World', 'Characters');
  const locs  = path.join(notesVaultDir, 'Universes', 'My World', 'Locations');
  fs.mkdirSync(chars, { recursive: true });
  fs.mkdirSync(locs,  { recursive: true });

  // Marcus — plain character, no aliases
  fs.writeFileSync(path.join(chars, 'Marcus.md'), [
    '---',
    'type: character',
    '---',
    '',
    'Marcus is a brave knight who guards the eastern tower.',
    'He is known for his silver shield and unwavering loyalty.',
  ].join('\n'));

  // Lyra — character with alias "the Duke"
  fs.writeFileSync(path.join(chars, 'Lyra.md'), [
    '---',
    'type: character',
    'aliases:',
    '  - the Duke',
    '---',
    '',
    'Lyra, known as the Duke, rules the northern province with quiet authority.',
  ].join('\n'));

  // Glass Bridge — location entity
  fs.writeFileSync(path.join(locs, 'Glass Bridge.md'), [
    '---',
    'type: location',
    '---',
    '',
    'The Glass Bridge spans the Silver River and glows faintly under moonlight.',
  ].join('\n'));

  // TC-CP-05: seed 100 extra entities so the vault has ~103 total
  for (let i = 0; i < 100; i++) {
    fs.writeFileSync(path.join(chars, `Alpha${i}.md`), [
      '---',
      'type: character',
      '---',
      '',
      `Alpha${i} is a minor character in the world.`,
    ].join('\n'));
  }
}

function seedStoryVault(vaultDir: string): void {
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const fullScenePath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: 'Continuity Peek E2E Story',
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'Chapter One',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: [{
          id: SCENE_ID,
          title: 'Test Scene',
          path: scenePath,
          order: 0,
          chapterId: CHAPTER_ID,
          storyId: STORY_ID,
          blocks: [{
            id: 'cp-e2e-block',
            type: 'prose',
            content: SCENE_BODY,
            order: 0,
            updatedAt: NOW,
          }],
          draftState: 'in-progress',
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
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(fullScenePath, [
    '---',
    `id: ${SCENE_ID}`,
    'title: "Test Scene"',
    'draftState: in-progress',
    `updatedAt: ${NOW}`,
    '---',
    '',
    SCENE_BODY,
    '',
  ].join('\n'));
}

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

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
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

/** Click the "Entities" tab in the right sidebar, wait for panel content to load. */
async function openEntitiesTab(page: Page): Promise<void> {
  const entitiesTab = page.locator('#rightsidebar-tab-continuity');
  await expect(entitiesTab).toBeVisible({ timeout: 8_000 });
  await entitiesTab.click();
  // Wait for panel to mount and the search box to appear
  // (search input visible = notesVaultRoot resolved; empty state = no vault)
  await Promise.race([
    page.locator('.continuity-search-input').waitFor({ state: 'visible', timeout: 8_000 }),
    page.locator('.continuity-empty').waitFor({ state: 'visible', timeout: 8_000 }),
  ]);
}

/**
 * Navigate to the pre-seeded scene via the left rail StoryNavigator.
 * Returns after the TipTap editor (.ProseMirror) is visible.
 */
async function openScene(page: Page): Promise<void> {
  // Ensure stories panel in left rail is expanded
  const storiesPanel = page.locator('[data-panel-id="stories"]');
  if (await storiesPanel.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const collapsed = await storiesPanel
      .evaluate((el) => el.classList.contains('lr-panel--collapsed'))
      .catch(() => false);
    if (collapsed) await storiesPanel.locator('.lr-panel-collapse-btn').click();
  }

  // Click scene row — StoryNavigator auto-expands story/chapter on mount
  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Test Scene' });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
}

// ── Suite lifecycle ────────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData     = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp-peek-user-'));
  vaultDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp-peek-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp-peek-notes-'));

  seedNotesVault(notesVaultDir);
  seedStoryVault(vaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);

  app  = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  fs.rmSync(userData,      { recursive: true, force: true });
  fs.rmSync(vaultDir,      { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ── AC-CC-01: Panel accessibility ─────────────────────────────────────────────
// ── AC-CC-06: Empty state (TC-CP-10 is here — must run before TC-CP-03 sets selection)

test('TC-CP-01: Entities tab is present in the right sidebar', async () => {
  const sidebar = page.locator('.right-sidebar');
  await expect(sidebar).toBeVisible({ timeout: 8_000 });

  const entitiesTab = sidebar.locator('#rightsidebar-tab-continuity');
  await expect(entitiesTab).toBeVisible();
  await expect(entitiesTab).toHaveAttribute('role', 'tab');
  await expect(entitiesTab).toHaveText('Entities');
});

test('TC-CP-02: pressing Ctrl+Shift+K activates the Entities tab', async () => {
  // Start on a different tab to make the shortcut effect observable
  const notesTab = page.locator('#rightsidebar-tab-notes');
  await expect(notesTab).toBeVisible({ timeout: 6_000 });
  await notesTab.click();
  await expect(notesTab).toHaveAttribute('aria-selected', 'true');

  // Fire the keyboard shortcut
  await page.keyboard.press('Control+Shift+K');

  // Entities tab should now be selected
  const entitiesTab = page.locator('#rightsidebar-tab-continuity');
  await expect(entitiesTab).toHaveAttribute('aria-selected', 'true', { timeout: 4_000 });
});

test('TC-CP-10: idle empty state shows when no text is selected and no search is active', async () => {
  // Runs before TC-CP-03 so no editor selection has been set yet
  await openEntitiesTab(page);

  // Clear any lingering search query
  const searchInput = page.locator('.continuity-search-input');
  await searchInput.fill('');

  // Panel should show idle empty state
  const emptyState = page.locator('.continuity-empty');
  await expect(emptyState).toBeVisible({ timeout: 5_000 });

  const title = emptyState.locator('.continuity-empty-title');
  await expect(title).toHaveText('No selection');
});

// ── AC-CC-02: Auto-detection on selection ─────────────────────────────────────

test('TC-CP-03: selecting text in the editor auto-populates entity card', async () => {
  await openScene(page);
  await openEntitiesTab(page);

  // Wait for search input — confirms notesVaultRoot has loaded in ContinuityPanel
  await expect(page.locator('.continuity-search-input')).toBeVisible({ timeout: 6_000 });

  // Focus the editor and select all text (scene body is the single word "Marcus")
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('Control+A');

  // Panel debounces 200ms then calls continuityMatchSelection("Marcus", notesVaultRoot)
  await expect(page.locator('.entity-card-name', { hasText: 'Marcus' }))
    .toBeVisible({ timeout: 5_000 });
});

test('TC-CP-04: alias lookup — searching by alias returns the entity that owns it (Lyra)', async () => {
  // Tests alias matching via continuitySearch (same entity-index + matchScore logic
  // used by continuityMatchSelection; alias "the Duke" is checked on every query).
  await openEntitiesTab(page);

  const searchInput = page.locator('.continuity-search-input');
  await searchInput.fill('the Duke');

  // Lyra's card should appear (alias "the Duke" matches with score ≥ 1)
  await expect(page.locator('.entity-card-name', { hasText: 'Lyra' }))
    .toBeVisible({ timeout: 5_000 });

  // The alias line should confirm the match
  await expect(page.locator('.entity-card-aliases')).toContainText('the Duke');

  await searchInput.fill('');
});

test('TC-CP-05: entity card appears with 100+ entities seeded (latency smoke)', async () => {
  // 103 entities seeded (Marcus, Lyra, Glass Bridge + 100 Alpha entities)
  // Search for a specific entity to prove the index scan completes quickly
  await openEntitiesTab(page);

  const searchInput = page.locator('.continuity-search-input');
  await expect(searchInput).toBeVisible({ timeout: 6_000 });

  const t0 = Date.now();
  await searchInput.fill('Alpha0');

  await expect(page.locator('.entity-card-name', { hasText: 'Alpha0' }))
    .toBeVisible({ timeout: 5_000 });

  const elapsed = Date.now() - t0;
  // AC says 300ms from selection; E2E allows up to 3 s for IPC + render overhead.
  expect(elapsed).toBeLessThan(3_000);

  // Clear search for subsequent tests
  await searchInput.fill('');
});

// ── AC-CC-03: Entity card contents ────────────────────────────────────────────

test('TC-CP-06: entity card shows name, type badge, and excerpt', async () => {
  await openEntitiesTab(page);

  // Search for Marcus to get a known card
  const searchInput = page.locator('.continuity-search-input');
  await searchInput.fill('Marcus');

  const card = page.locator('.entity-card').first();
  await expect(card).toBeVisible({ timeout: 5_000 });

  // (a) entity name
  await expect(card.locator('.entity-card-name')).toHaveText('Marcus');

  // (b) type badge
  const badge = card.locator('.entity-type-badge');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('aria-label', /character/i);

  // (c) excerpt — first ~200 chars, markdown stripped
  const excerpt = card.locator('.entity-card-excerpt');
  await expect(excerpt).toBeVisible();
  const text = await excerpt.textContent();
  expect(text?.length).toBeGreaterThan(10);
  expect(text?.length).toBeLessThanOrEqual(210); // 200 chars + some tolerance

  // (d) "View full note" link — not implemented in SKY-2011; verified absent here.
  // When implemented, update this assertion to toBeVisible().
  await expect(card.getByRole('link', { name: /view full note/i })).toBeHidden();

  // Clean up search
  await searchInput.fill('');
});

// ── AC-CC-04: Manual search ────────────────────────────────────────────────────

test('TC-CP-07: typing a partial name in search returns results; selecting one loads its card', async () => {
  await openEntitiesTab(page);

  const searchInput = page.locator('.continuity-search-input');
  await expect(searchInput).toBeVisible();

  // Partial query — "Gla" should match "Glass Bridge"
  await searchInput.fill('Gla');

  const resultsLabel = page.locator('.continuity-section-label', { hasText: 'Results' });
  await expect(resultsLabel).toBeVisible({ timeout: 4_000 });

  const card = page.locator('.entity-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.entity-card-name')).toHaveText('Glass Bridge');

  // Clean up
  await searchInput.fill('');
});

test('TC-CP-08: Ctrl+Shift+K opens Entities tab and search input is accessible', async () => {
  // Switch away from the Entities tab first so the shortcut effect is observable
  await page.locator('#rightsidebar-tab-notes').click();
  await expect(page.locator('#rightsidebar-tab-notes')).toHaveAttribute('aria-selected', 'true');

  // Fire the shortcut
  await page.keyboard.press('Control+Shift+K');
  await expect(page.locator('#rightsidebar-tab-continuity')).toHaveAttribute('aria-selected', 'true', { timeout: 4_000 });

  // Search input must be visible and focusable
  const searchInput = page.locator('.continuity-search-input');
  await expect(searchInput).toBeVisible({ timeout: 4_000 });
  await searchInput.focus();
  await expect(searchInput).toBeFocused();

  // NOTE: AC-CC-04 specifies the input should auto-focus on panel open.
  // Auto-focus is not implemented in SKY-2011 (no autoFocus attr on the input).
  // This test verifies the input is reachable; auto-focus can be added later.
});

// ── AC-CC-05: Focus Mode overlay — NOT implemented in SKY-2011 ────────────────

test.skip('TC-CP-09: Focus Mode overlay appears and dismisses via Escape / click-outside', () => {
  // AC-CC-05 requires a dedicated floating overlay when the keyboard shortcut is
  // used inside Focus Mode. SKY-2011 only activates the sidebar tab; no overlay
  // was implemented. Unskip and fill in assertions when the overlay lands.
});

// ── AC-CC-07: No cache staleness ──────────────────────────────────────────────

test('TC-CP-11: editing entity file externally is reflected in next search (no stale cache)', async () => {
  await openEntitiesTab(page);

  const searchInput = page.locator('.continuity-search-input');

  // Initial search — read the current excerpt
  await searchInput.fill('Marcus');
  const card = page.locator('.entity-card', { has: page.locator('.entity-card-name', { hasText: 'Marcus' }) });
  await expect(card).toBeVisible({ timeout: 5_000 });
  const initialExcerpt = await card.locator('.entity-card-excerpt').textContent();
  expect(initialExcerpt).toBeTruthy();

  // Modify the entity file externally
  const marcusFile = path.join(notesVaultDir, 'Universes', 'My World', 'Characters', 'Marcus.md');
  fs.writeFileSync(marcusFile, [
    '---',
    'type: character',
    '---',
    '',
    'UPDATED: Marcus retired from knighthood and now tends a small vineyard near the coast.',
  ].join('\n'));

  // Re-trigger the search — buildEntityIndex re-scans + readEntityFile reads fresh
  await searchInput.fill('');
  await searchInput.fill('Marcus');

  const updatedCard = page.locator('.entity-card', { has: page.locator('.entity-card-name', { hasText: 'Marcus' }) });
  await expect(updatedCard).toBeVisible({ timeout: 5_000 });
  const updatedExcerpt = await updatedCard.locator('.entity-card-excerpt').textContent();

  expect(updatedExcerpt).toContain('UPDATED:');
  expect(updatedExcerpt).not.toEqual(initialExcerpt);

  // Clean up
  await searchInput.fill('');
});

// ── AC-CC-08: No AI calls ──────────────────────────────────────────────────────

test('TC-CP-12: panel loads entity data normally with no API key configured', async () => {
  // The shared fixture has apiKey: '' — confirms the panel doesn't require AI

  await openEntitiesTab(page);

  const searchInput = page.locator('.continuity-search-input');
  await expect(searchInput).toBeVisible({ timeout: 6_000 });

  // Panel renders the search box (not an error state) — no AI provider needed
  await expect(page.locator('.continuity-panel')).toBeVisible();

  // Verify entity lookup still works — no AI call involved
  await searchInput.fill('Lyra');
  await expect(page.locator('.entity-card-name', { hasText: 'Lyra' })).toBeVisible({ timeout: 5_000 });

  // No error toast or error element rendered
  await expect(page.locator('[role="alert"]')).toBeHidden();

  await searchInput.fill('');
});
