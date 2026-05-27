/**
 * beta-read.spec.ts — MYT-381
 *
 * E2E smoke for Beta-Read Mode (MYT-237 — anchored inline comments):
 *
 *   TC-BR-01  On-demand review via selection + bubble click
 *             Select text in the BlockEditor → Beta-Read bubble appears →
 *             click fires mocked agent:writing-assistant → anchored comment
 *             appears in BetaReadMargin within .shell-beta-margin.
 *
 *   TC-BR-02  Comments persist across scene reload
 *             Navigate away from the scene (Brainstorm view) then back and
 *             re-select the scene; comment is reloaded from SQLite on the
 *             selectedScene useEffect and still displayed.
 *
 *   TC-BR-03  Dismiss removes comment from gutter
 *             Click the Dismiss button on the comment; the .br-comment node
 *             is removed from the DOM, the BetaReadMargin disappears, and
 *             betaReadList returns an empty array for the scene (dismissed_at
 *             is non-null — the DB serves as the dismissal audit trail).
 *
 * The Anthropic SDK is bypassed by replacing the agent:writing-assistant
 * ipcMain handler with a deterministic mock that returns a fixed string.
 * No real API key or network access is required.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium   # first time only
 *   npx playwright test e2e/beta-read.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'br-e2e-story-0001';
const CHAPTER_ID = 'br-e2e-chapter-0001';
const SCENE_ID = 'br-e2e-scene-0001';

/**
 * Body text pre-seeded in the scene — long enough to satisfy the
 * 10-char minimum checked in BlockEditor.onSelectionUpdate.
 */
const SCENE_BODY =
  'The dragon soared above the Foundry as grey dawn broke across the mountain peaks.';

/** Fixed response the mocked agent:writing-assistant handler returns. */
const MOCK_COMMENT =
  'Mock beta-read feedback: strong opening image; consider deepening the sensory detail.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Write app-settings, vault-settings, and a manifest pre-seeded with one
 * story → chapter → scene so the StoryNavigator shows the scene on boot.
 * Also writes the scene markdown file under <vaultDir>.
 */
function seedUserData(userData: string, vaultDir: string): void {
  const now = new Date().toISOString();

  const appSettings = {
    // A non-empty apiKey is required so the writing-assistant handler
    // doesn't bail out before the mock can intercept it.
    apiKey: 'sk-ant-e2e-test-key-beta-read',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true, // must be true so the handler is invoked
        model: 'claude-haiku-4-5-20251001',
        scanIntervalSeconds: 60,
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

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'Beta-Read E2E Story',
        path: `stories/${STORY_ID}`,
        chapters: [
          {
            id: CHAPTER_ID,
            title: 'Chapter One',
            path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
            order: 0,
            scenes: [
              {
                id: SCENE_ID,
                title: 'Opening Scene',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  {
                    id: 'br-e2e-block-0001',
                    type: 'prose',
                    content: SCENE_BODY,
                    order: 0,
                    updatedAt: now,
                  },
                ],
                draftState: 'in-progress',
                createdAt: now,
                updatedAt: now,
              },
            ],
            createdAt: now,
            updatedAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    entities: [],
    suggestions: [],
    scenes: [],
    chapters: [],
  };

  // Write the scene markdown file so vault reindexing doesn't strip the scene.
  const sceneMdPath = path.join(
    vaultDir,
    `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
  );
  fs.mkdirSync(path.dirname(sceneMdPath), { recursive: true });
  fs.writeFileSync(
    sceneMdPath,
    [
      '---',
      `id: ${SCENE_ID}`,
      `title: "Opening Scene"`,
      `draftState: in-progress`,
      `updatedAt: ${now}`,
      '---',
      '',
      SCENE_BODY,
      '',
    ].join('\n'),
  );

  const vaultSettings = { vaultRoot: vaultDir };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`],
    timeout: 30_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

// ─── Suite lifecycle ──────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-br-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-br-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  // Wait for the DesktopShell to fully paint before injecting the mock.
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  /**
   * Replace the real agent:writing-assistant ipcMain handler (registered by
   * registerWritingAssistantHandler() in main.ts) with a mock that returns a
   * fixed comment string immediately — no Anthropic SDK, no real API key.
   *
   * The mock returns { text: MOCK_COMMENT } which DesktopShell.handleBetaReadRequest
   * reads as `res.text` before calling betaReadCreate.
   */
  await app.evaluate(
    async ({ ipcMain }, mockComment: string) => {
      ipcMain.removeHandler('agent:writing-assistant');
      ipcMain.handle('agent:writing-assistant', async () => {
        return { text: mockComment };
      });
    },
    MOCK_COMMENT,
  );
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-BR-01: On-demand review fires → anchored comment in margin ─────────────
//
// 1. Navigate to the pre-seeded scene via StoryNavigator.
//    StoryNavigator auto-expands all stories and chapters on mount, so the
//    scene row is immediately visible without manual tree expansion.
// 2. Select all text with Ctrl+A — triggers BlockEditor.onSelectionUpdate
//    which sets selectionText and shows the Beta-Read bubble (>= 10 chars).
// 3. Dispatch mousedown on the bubble — handleBetaReadClick reads selectionText
//    and calls DesktopShell.handleBetaReadRequest(selectedText).
// 4. handleBetaReadRequest calls the mocked agent:writing-assistant, then
//    betaReadCreate, then loadBetaReadComments — BetaReadMargin re-renders.
// 5. Verify the anchored comment (MOCK_COMMENT) appears in BetaReadMargin.

test('TC-BR-01: select text → Beta-Read bubble → mocked review → comment in margin', async () => {
  // Ensure the Stories tab is active in the left rail.
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  // Pre-seeded scene must be visible (StoryNavigator auto-expands all nodes).
  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Opening Scene' });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();

  // BlockEditor (TipTap) must render.
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });

  // Click the editor to focus it, then select all text.
  await editor.click();
  await page.keyboard.press('Control+a');

  // The Beta-Read bubble must appear (selection length >= 10 chars).
  const betaBubble = page.locator('.beta-read-bubble');
  await expect(betaBubble).toBeVisible({ timeout: 5_000 });

  // Dispatch mousedown to trigger the onMouseDown handler.
  // Using dispatchEvent mirrors the browser interaction: the handler calls
  // e.preventDefault() to keep the text selection intact, then invokes
  // handleBetaReadClick which reads the current selectionText state.
  await betaBubble.dispatchEvent('mousedown');

  // Wait for BetaReadMargin to appear with at least one comment.
  // DesktopShell.handleBetaReadRequest is async; the comment appears after
  // betaReadCreate resolves and loadBetaReadComments re-fetches the list.
  const margin = page.locator('[data-testid="beta-read-margin"]');
  await expect(margin).toBeVisible({ timeout: 10_000 });

  const firstComment = margin.locator('.br-comment').first();
  await expect(firstComment).toBeVisible({ timeout: 8_000 });

  // Anchor text must reference the selected scene text.
  const anchorEl = firstComment.locator('.br-anchor-text');
  await expect(anchorEl).toContainText('The dragon', { timeout: 5_000 });

  // Comment body must contain the fixed mock feedback string.
  const bodyEl = firstComment.locator('.br-comment-body');
  await expect(bodyEl).toContainText(MOCK_COMMENT, { timeout: 5_000 });
});

// ─── TC-BR-02: Comments persist across scene reload ───────────────────────────
//
// Navigate away from the scene (Brainstorm view deselects the scene in
// DesktopShell) then navigate back and re-click the scene.
// DesktopShell's useEffect on selectedScene?.id reloads betaReadList from
// SQLite — the dismissed_at=NULL row created in TC-BR-01 must still appear.

test('TC-BR-02: comments persist when navigating away and back to the scene', async () => {
  // Navigate away — switches view and clears selectedScene state.
  await page.locator('.app-menu-view-btn', { hasText: 'Brainstorm' }).click();
  await page.waitForTimeout(300); // allow React to unmount scene state

  // Navigate back to the editor.
  await page.locator('.app-menu-view-btn', { hasText: 'Editor' }).click();

  // Ensure Stories tab is active, then re-select the scene.
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  const sceneRow = page.locator('.nav-scene-row', { hasText: 'Opening Scene' });
  await expect(sceneRow).toBeVisible({ timeout: 5_000 });
  await sceneRow.click();

  // The margin must reload and still show the comment from TC-BR-01.
  const margin = page.locator('[data-testid="beta-read-margin"]');
  await expect(margin).toBeVisible({ timeout: 8_000 });

  const firstComment = margin.locator('.br-comment').first();
  await expect(firstComment).toBeVisible({ timeout: 5_000 });
  await expect(firstComment.locator('.br-comment-body')).toContainText(MOCK_COMMENT);
});

// ─── TC-BR-03: Dismiss removes comment from gutter ────────────────────────────
//
// Click the Dismiss button on the comment created in TC-BR-01.
// DesktopShell.handleBetaReadDismiss calls betaReadDismiss IPC which sets
// dismissed_at in SQLite, then removes the comment from betaReadComments state.
// BetaReadMargin returns null when the array is empty, hiding the gutter.
//
// Note: the current implementation does NOT write a row to the audit_log table
// (which is specific to vault suggestions). The dismissal audit trail is the
// dismissed_at timestamp on the beta_read_comments row; this is verified
// indirectly by confirming betaReadList returns an empty array.

test('TC-BR-03: dismiss removes comment from gutter and marks it dismissed in DB', async () => {
  // The scene from TC-BR-02 is still open and the margin should be visible.
  const margin = page.locator('[data-testid="beta-read-margin"]');
  await expect(margin).toBeVisible({ timeout: 5_000 });

  const firstComment = margin.locator('.br-comment').first();
  await expect(firstComment).toBeVisible({ timeout: 5_000 });

  // Click Dismiss — fires handleBetaReadDismiss → betaReadDismiss IPC → dismissed_at set.
  const dismissBtn = firstComment.locator('.br-dismiss-btn');
  await expect(dismissBtn).toBeVisible();
  await dismissBtn.click();

  // Comment node must be removed from the DOM (optimistic state update).
  await expect(firstComment).not.toBeVisible({ timeout: 5_000 });

  // BetaReadMargin returns null when comments is empty → gutter disappears.
  await expect(margin).not.toBeVisible({ timeout: 5_000 });

  // Verify via IPC that the DB no longer returns active (undismissed) comments.
  // dismissed_at IS NOT NULL → filtered out by listBetaReadComments.
  const listResult = await page.evaluate((sceneId: string) => {
    return (window as any).api.betaReadList(sceneId);
  }, SCENE_ID) as { comments: Array<unknown> };

  expect(
    listResult.comments.length,
    'betaReadList must return 0 undismissed comments after dismiss',
  ).toBe(0);
});
