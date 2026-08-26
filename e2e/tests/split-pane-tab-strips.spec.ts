/**
 * split-pane-tab-strips.spec.ts — SKY-8907
 *
 * Obsidian-style per-pane tab strips. Owner direction: split-screen behaviour
 * (creation/resize/close) is unchanged and out of scope here — this covers
 * only tab OWNERSHIP moving from the single global strip to each pane.
 *
 * Coverage (ticket §4a real-E2E requirement):
 *   - splitting the editor gives each pane its own, independent tab strip
 *   - opening a doc in a pane adds a tab to THAT pane's strip only
 *   - dragging a tab from one pane's strip onto the other's moves it
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/split-pane-tab-strips.spec.ts --reporter=list
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
const STORY_ID = 'sp-story-0001';
const CHAPTER_ID = 'sp-chapter-0001';
const SCENE_ALPHA_ID = 'sp-scene-alpha';
const SCENE_BETA_ID = 'sp-scene-beta';

function seedBaseSettings(userData: string, vaultDir: string, notesVaultDir: string): void {
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

/** Seed a vault with one story/chapter and two scenes, so each pane can hold a different one. */
function seedVault(vaultDir: string): void {
  const manifestDir = path.join(vaultDir, 'stories');
  fs.mkdirSync(manifestDir, { recursive: true });

  const now = new Date().toISOString();
  const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });

  const scene = (id: string, title: string, order: number) => ({
    id, title,
    path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${id}.md`,
    chapterId: CHAPTER_ID, storyId: STORY_ID, order,
    draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
  });

  const manifest = {
    version: 1,
    stories: [
      {
        id: STORY_ID, title: 'Split Tab Story', path: `stories/${STORY_ID}`, order: 0,
        createdAt: now, updatedAt: now,
        chapters: [
          {
            id: CHAPTER_ID, title: 'Chapter One', storyId: STORY_ID, order: 0,
            createdAt: now, updatedAt: now,
            scenes: [
              scene(SCENE_ALPHA_ID, 'Scene Alpha', 0),
              scene(SCENE_BETA_ID, 'Scene Beta', 1),
            ],
          },
        ],
      },
    ],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(sceneDir, `${SCENE_ALPHA_ID}.md`), '');
  fs.writeFileSync(path.join(sceneDir, `${SCENE_BETA_ID}.md`), '');
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

/** Open a scene via a pane's own PaneSceneSelector popover (spe-scene-btn/-option). */
async function selectSceneInPane(page: Page, paneNumber: 1 | 2, sceneId: string): Promise<void> {
  const pane = page.locator(`[data-testid="split-pane-${paneNumber}"]`);
  await pane.locator('[data-testid="spe-scene-btn"]').click();
  await pane.locator(`[data-testid="spe-scene-option-${sceneId}"]`).click();
}

/**
 * Simulate an HTML5 drag from a pane's tab (by title) onto the other pane's
 * tab strip, dispatching the exact DOM events WorkspaceTabBar/SplitEditorPane
 * listen for — mirrors folder-ops-sky7995.spec.ts's simulateRowDrag, since
 * mouse-based Playwright dragTo() is unreliable against the headless renderer.
 */
async function dragTabToOtherPane(page: Page, fromPane: 1 | 2, tabTitle: string, toPane: 1 | 2): Promise<void> {
  const fromTab = page.locator(`[data-testid="split-pane-${fromPane}-tab-strip"] [role="tab"]`, { hasText: tabTitle });
  const toStrip = page.locator(`[data-testid="split-pane-${toPane}-tab-strip"]`);

  await fromTab.evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  });
  await toStrip.evaluate((el) => {
    const dt = new DataTransfer();
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  // Best-effort cleanup dispatch: the drop above may already have moved this
  // tab into the other pane's strip, in which case fromTab no longer matches
  // any element and Playwright would otherwise poll for its default 30s
  // action timeout before the .catch() below swallows the error. A short
  // timeout here fails fast instead of stalling every drag by ~30s.
  await fromTab.evaluate(
    (el) => el.dispatchEvent(new DragEvent('dragend', { bubbles: true } as never)),
    undefined,
    { timeout: 1_000 },
  ).catch(() => {});
}

test.describe('SKY-8907 per-pane tab strips', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sp-tabs-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sp-tabs-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sp-tabs-notes-'));
    seedBaseSettings(userData, vaultDir, notesVaultDir);
    seedVault(vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });
    await page.locator('[data-testid="split-toggle-btn"]').click();
    await expect(page.locator('[data-testid="split-divider"]')).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('each split pane renders its own tab strip', async () => {
    await expect(page.locator('[data-testid="split-pane-1-tab-strip"]')).toBeVisible();
    await expect(page.locator('[data-testid="split-pane-2-tab-strip"]')).toBeVisible();
  });

  test('the global workspace tab strip is hidden while split is active', async () => {
    // Only the two per-pane WorkspaceTabBar instances (.wtb-root) should exist
    // — no third, global one. Scoped to .wtb-root rather than the bare
    // [role="tablist"] attribute selector: StorySubViewBar renders its own,
    // unrelated tablist (Editor/Coach/Scene Crafter/... sub-view toggles) any
    // time the Story tab is active, split or not — that's a pre-existing,
    // independent tab strip, not one of the two per-pane strips under test.
    await expect(page.locator('.wtb-root[role="tablist"]')).toHaveCount(2);
  });

  test('opening a scene in pane 1 adds a tab to pane 1 only', async () => {
    await selectSceneInPane(page, 1, SCENE_ALPHA_ID);
    await expect(
      page.locator('[data-testid="split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Scene Alpha' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Scene Alpha' }),
    ).toHaveCount(0);
  });

  test('opening a different scene in pane 2 adds a tab to pane 2 only — strips are independent', async () => {
    await selectSceneInPane(page, 2, SCENE_BETA_ID);
    await expect(
      page.locator('[data-testid="split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Scene Beta' }),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Scene Beta' }),
    ).toHaveCount(0);
    // Pane 1's earlier tab is still exactly as it was — proves the strips
    // don't share state.
    await expect(
      page.locator('[data-testid="split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Scene Alpha' }),
    ).toBeVisible();
  });

  test('dragging pane 1\'s tab onto pane 2\'s strip moves it across', async () => {
    await dragTabToOtherPane(page, 1, 'Scene Alpha', 2);

    // Moved: now lives in pane 2's strip alongside Scene Beta...
    await expect(
      page.locator('[data-testid="split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Scene Alpha' }),
    ).toBeVisible({ timeout: 8_000 });
    await expect(
      page.locator('[data-testid="split-pane-2-tab-strip"] [role="tab"]', { hasText: 'Scene Beta' }),
    ).toBeVisible();
    // ...and gone from pane 1's.
    await expect(
      page.locator('[data-testid="split-pane-1-tab-strip"] [role="tab"]', { hasText: 'Scene Alpha' }),
    ).toHaveCount(0);
  });

  test('pane 1, now empty, shows the Obsidian-style action card instead of a blank editor', async () => {
    const emptyCard = page.locator('[data-testid="split-pane-1"] [data-testid="scene-editor-empty-actions"]');
    await expect(emptyCard).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="split-pane-1"] [data-testid="se-empty-action-create"]')).toBeVisible();
    await expect(page.locator('[data-testid="split-pane-1"] [data-testid="se-empty-action-goto"]')).toBeVisible();
    await expect(page.locator('[data-testid="split-pane-1"] [data-testid="se-empty-action-close"]')).toBeVisible();
  });
});

// SKY-10998: SKY-10925 (PR #1313) fixed the primary single-pane scene view's
// duplicate-toolbar R9 violation (see editor-page-chrome.spec.ts PC-09) — it
// scoped SplitEditorPane out as "intentionally distinct" with no unified-shell
// equivalent. A follow-up audit found the same shape live in SplitEditorPane
// too: its BlockEditor mount passed no chromeless prop, so it rendered its
// own .block-editor-toolbar (scene-name + draft-state-group) and its own
// .fmt-toolbar stacked on top of SplitEditorPane's own .spe-header (pane
// label + PaneSceneSelector). This mirrors PC-09's toolbar-count assertions,
// scoped to the split-view surface.
test.describe('SKY-10998 split-pane chromeless — no duplicate toolbar/header', () => {
  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sp-chrome-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sp-chrome-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sp-chrome-notes-'));
    seedBaseSettings(userData, vaultDir, notesVaultDir);
    seedVault(vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await page.waitForSelector('.shell-loading', { state: 'detached', timeout: 30_000 });
    await page.locator('[data-testid="split-toggle-btn"]').click();
    await expect(page.locator('[data-testid="split-divider"]')).toBeVisible({ timeout: 8_000 });
    await selectSceneInPane(page, 1, SCENE_ALPHA_ID);
  });

  test.afterAll(async () => {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
    fs.rmSync(notesVaultDir, { recursive: true, force: true });
  });

  test('the pane shows exactly one toolbar/header — SplitEditorPane\'s own chrome, not BlockEditor\'s', async () => {
    const pane1 = page.locator('[data-testid="split-pane-1"]');

    // The pane's prose mounts — suppressing BlockEditor's chrome doesn't
    // suppress its content.
    await expect(pane1.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible({ timeout: 8_000 });

    // SplitEditorPane's own chrome (pane label + scene selector) is the ONE
    // header for this pane's scene.
    await expect(pane1.locator('.spe-header')).toBeVisible();
    await expect(pane1.locator('[data-testid="spe-scene-btn"]')).toBeVisible();

    // BlockEditor's own duplicate header/toolbar must NOT also render.
    await expect(pane1.locator('.block-editor-toolbar .scene-name')).toHaveCount(0);
    await expect(pane1.locator('.draft-state-group')).toHaveCount(0);
    await expect(pane1.locator('.fmt-toolbar')).toHaveCount(0);
  });
});
