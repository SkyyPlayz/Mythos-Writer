/**
 * sceneCrafter.spec.ts — SKY-1766, retired lanes UI per SKY-7601
 *
 * Playwright E2E coverage for the Scene Crafter M18/M19 Canvas view.
 *
 * SKY-7601: the pre-M18 Kanban lanes board (5 fixed lanes, per-card
 * checkboxes, add/rename/delete lane, drag-and-drop) is retired from the UI.
 * `board.lanes` still exists on disk (B4-3, no destructive data migration),
 * so the on-disk format (AC-SC-07) and any lane card carrying a
 * `manuscript/<sceneId>` tag (surfaced read-only as "Go to scene", AC-SC-10)
 * still round-trip — only the lanes UI itself, and the ACs that exercised it
 * (former AC-SC-01 through 06, AC-SC-11), are gone with no UI replacement.
 *
 * Acceptance criteria (current):
 *   AC-SC-07  Obsidian round-trip — serialized board.md matches format spec
 *   AC-SC-08  Brainstorm accept writes a visible Scene Crafter suggested card
 *             (SKY-8080: routed through the notes vault as a scene_card note,
 *             not the retired lanes board — verified UI -> IPC -> disk -> UI)
 *   AC-SC-09  Brainstorm reject removes proposal from list
 *   AC-SC-10  Manuscript deep link — "Go to scene" shown for a tagged card
 *   AC-SC-12  External edit conflict alert surfaced
 *   AC-SC-13  Write error banner shown — SKIPPED (platform-specific lock simulation)
 *   AC-SC-14  Per-story isolation — boards are independent across stories
 *   AC-SC-15  Suggested-card click selects it as draft context (SKY-7601)
 *   AC-SC-16  A card tagged manuscript/<id> with no scene link is silent —
 *             the Linked scenes section only appears when one exists
 *   AC-SC-17  SKY-8265 (M19 §7.1, AC2/AC3): the editor's Scenes-tab mini canvas
 *             pans/zooms and its board survives a genuine Electron app restart
 *             (not just a component remount — SKY-8207/#1107 already covers
 *             that at the unit level with a mocked window.api)
 *
 * SKY-8080 fix: accepting a scene_crafter_card Brainstorm proposal used to
 * write into board.lanes[0] via sceneCrafterAddCard (BrainstormPage.tsx) —
 * an invisible surface since SKY-7601 retired the lanes UI and the only
 * remaining board.lanes reader (linkedSceneCards) requires a manuscript/ tag
 * these cards never carry. Fixed by routing through brainstormWriteNote as
 * a 'scene_card' note instead, which surfaces via suggestedFromVault.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test';
import { clickStoryNav } from '../helpers/navGuard';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
        enabled: true, model: 'claude-sonnet-4-6', autoApply: false,
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

/**
 * Create a story via the title bar's File → New story item — selection-state
 * independent. (M6/SKY-9022 removed the navigator's internal header "+"; the
 * rail's `.lr-nav-add` is contextual — it appends a chapter once a story is
 * selected, so it can't create the second story this suite needs.)
 * M3 (SKY-9021/9896): instant-create — no prompt, the story row appears
 * immediately as "Untitled Story". Returns the index of the new row so
 * callers can select it positionally.
 */
async function createStory(pg: Page): Promise<number> {
  const before = await pg.locator('.nav-story-row').count();
  await pg.locator('.wc-menu', { hasText: 'File' }).click();
  await pg.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await expect(pg.locator('.nav-story-row').nth(before)).toBeVisible({ timeout: 8_000 });
  return before; // index of the newly created row
}

/** Select a story by its positional index in the StoryNavigator sidebar. */
async function selectStory(pg: Page, index: number): Promise<void> {
  await pg.locator('.nav-story-title').nth(index).click();
}

/** Navigate to the Scene Crafter (Board) view via the nav rail.
 *  SKY-9019/M5: Scene Crafter left the sub-tab strip — it is rail-only now. */
async function openBoardView(pg: Page): Promise<void> {
  await clickStoryNav(pg);
  await pg.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  // Wait for the M18/M19 Scene Setup column, which only renders once the
  // board has fully loaded (the loading state renders .scene-crafter-page
  // but not .sc-columns). The lanes board is retired — see SKY-7601.
  await expect(pg.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
}

/**
 * Force a board re-read from disk by navigating to Editor then back.
 * Unmounting SceneCrafterPage triggers a fresh IPC + disk read on remount.
 * Use this instead of page.reload() — reload clears React story-selection state.
 */
async function reloadBoardView(pg: Page): Promise<void> {
  await clickStoryNav(pg);
  await pg.locator('[data-testid="story-subview-editor"]').click();
  await openBoardView(pg);
}

/** Return the absolute path to a story's board.md in the notes vault. */
function boardPath(notesVaultDir: string, storySlug: string): string {
  return path.join(notesVaultDir, 'scenes', storySlug, 'board.md');
}

type SceneCrafterCard = { wikilink: string; title: string; done: boolean; tags: string[] };
type SceneCrafterBoardShape = { lanes: Array<{ name: string; cards: SceneCrafterCard[] }> };

/** Read the board straight from IPC — the source of truth now that lanes have no UI. */
async function readBoard(pg: Page, slug: string): Promise<SceneCrafterBoardShape | null> {
  return pg.evaluate(
    (s) => (window as Window & typeof globalThis & {
      api: { sceneCrafterGetBoard: (id: string, slug: string) => Promise<SceneCrafterBoardShape | null> };
    }).api.sceneCrafterGetBoard(s, s),
    slug,
  );
}

// ─── Suite state ──────────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;
/**
 * The actual filesystem slug for the primary story's board directory.
 * DesktopShell creates stories with path `stories/<uuid>`, so
 * storySlugFromStory() returns the UUID — NOT the human title.
 * Discovered after the board is first created in beforeAll.
 */
let storySlug: string;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-notes-'));

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);

  // Create the primary story used across most tests.
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  const storyAIndex = await createStory(page);
  await selectStory(page, storyAIndex);

  // Open the board to trigger board creation; wait for full load so the
  // scenes/<slug>/ directory exists on disk before tests read it.
  await openBoardView(page);

  // Discover the actual storySlug from the filesystem.
  const scenesDir = path.join(notesVaultDir, 'scenes');
  const slugEntry = fs.existsSync(scenesDir)
    ? fs.readdirSync(scenesDir, { withFileTypes: true }).find((e) => e.isDirectory())
    : undefined;
  storySlug = slugEntry?.name ?? '';
  // Fail fast if board creation did not produce a scenes directory.
  if (!storySlug) throw new Error('beforeAll: board not created — scenes/ directory missing');
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── AC-SC-07: Obsidian round-trip ───────────────────────────────────────────

test('AC-SC-07: board.md round-trips through the Obsidian Kanban format spec', async () => {
  await openBoardView(page);

  // storySlug is discovered in beforeAll — it is the UUID-based segment of story.path.
  const boardFilePath = boardPath(notesVaultDir, storySlug);
  expect(fs.existsSync(boardFilePath), `board.md must exist at ${boardFilePath}`).toBe(true);

  const content = fs.readFileSync(boardFilePath, 'utf-8');

  // Frontmatter must contain mandatory keys.
  expect(content).toContain('kanban-plugin: board');
  expect(content).toContain('mythos-board-version: 1');
  expect(content).toContain('story-id:');
  expect(content).toContain('last-modified:');

  // Must have the 5 canonical lane headings — the *data* format is unchanged
  // by SKY-7601 (B4-3: no destructive migration), only the lanes UI is gone.
  for (const lane of ['Idea', 'Outline', 'Draft', 'Revision', 'Done']) {
    expect(content).toContain(`## ${lane}`);
  }

  // Must include the Obsidian Kanban settings block.
  expect(content).toContain('%% kanban:settings');
  expect(content).toContain('{"kanban-plugin":"board"}');
  expect(content).toContain('\n%%');
});

// ─── AC-SC-16: Linked scenes section hidden when no card is manuscript-tagged ─

test('AC-SC-16: Linked scenes section is absent when no board card carries a manuscript/ tag', async () => {
  await openBoardView(page);

  // At this point in the suite the board has not yet had a manuscript/-tagged
  // card written to it (that happens in AC-SC-10, later in file order) — so
  // the read-only "Linked scenes" section should not render at all.
  await expect(page.locator('[data-testid="crafter-linked-scenes"]')).not.toBeAttached();
});

// ─── AC-SC-08 / AC-SC-09: Brainstorm integration ─────────────────────────────

/**
 * Inject a scene_crafter_card proposal into the renderer via the main process.
 * Uses the same IPC push the brainstorm agent uses in production.
 */
async function injectProposal(
  appInstance: ElectronApplication,
  proposal: {
    id: string;
    title: string;
    body: string;
  },
): Promise<void> {
  await appInstance.evaluate(
    ({ BrowserWindow }, p: { id: string; title: string; body: string }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.webContents.send('brainstorm:proposalQueued', {
        proposals: [
          {
            id: p.id,
            kind: 'scene_crafter_card',
            title: p.title,
            body: p.body,
            destinationPath: p.title,
            frontmatter: {},
            sourceConversationTurnId: 'e2e-test',
            extractionConfidence: 0.9,
            status: 'pending',
          },
        ],
      });
    },
    proposal,
  );
}

test('AC-SC-08 (SKY-8080): accepting a Brainstorm proposal writes a visible Scene Crafter suggested card', async () => {
  const PROPOSAL_ID = 'e2e-sc08-proposal';
  const CARD_TITLE = 'HeroArrivesAtVillage';

  // Navigate to Notes tab so BrainstormPage mounts with the selected story context.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({ timeout: 8_000 });

  // Inject the proposal from the main process.
  await injectProposal(app!, { id: PROPOSAL_ID, title: CARD_TITLE, body: 'The hero rides into the village at dawn.' });

  // Wait for the ProposalCard to appear.
  const proposalRegion = page.locator('[data-testid="proposal-card-region"]');
  await expect(proposalRegion).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(`[data-testid="proposal-card-${PROPOSAL_ID}"]`)).toBeVisible({ timeout: 4_000 });

  // Click Accept.
  await page.locator('[data-testid="pc-confirm-btn"]').click();

  // The ProposalCard should disappear (proposals list becomes empty).
  await expect(proposalRegion).not.toBeVisible({ timeout: 4_000 });

  // SKY-8080: the pre-fix path wrote the card into board.lanes[0] via
  // sceneCrafterAddCard — an invisible surface since SKY-7601 retired the
  // lanes UI. The fix routes it through brainstormWriteNote as a 'scene_card'
  // note instead. Verify the real on-disk write (IPC -> disk)...
  const notePath = path.join(
    notesVaultDir,
    'Universes',
    'My First Universe',
    'Scenes',
    `${CARD_TITLE}.md`,
  );
  await expect.poll(() => fs.existsSync(notePath), { timeout: 8_000 }).toBe(true);
  expect(fs.readFileSync(notePath, 'utf8')).toContain('The hero rides into the village at dawn.');

  // ...and that it round-trips back into the UI as a visible Suggested Card
  // (disk -> UI), which is the only live surface for planning content since
  // SKY-7601. The stale invisible-lanes write must not occur any more.
  await openBoardView(page);
  const suggested = page.locator('.sc-suggest');
  await expect(suggested).toContainText(CARD_TITLE, { timeout: 8_000 });

  const board = await readBoard(page, storySlug);
  expect(board?.lanes[0]?.cards.some((c) => c.title === CARD_TITLE) ?? false).toBe(false);
});

test('AC-SC-09: rejecting a Brainstorm proposal removes it from the proposal list', async () => {
  const PROPOSAL_ID = 'e2e-sc09-proposal';
  const CARD_TITLE = 'VillainRevealedAtBanquet';

  // Navigate to Notes tab so BrainstormPage mounts.
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({ timeout: 8_000 });

  // Inject the proposal.
  await injectProposal(app!, { id: PROPOSAL_ID, title: CARD_TITLE, body: 'The villain unmasks at the royal banquet.' });

  // Wait for the ProposalCard.
  const proposalRegion = page.locator('[data-testid="proposal-card-region"]');
  await expect(proposalRegion).toBeVisible({ timeout: 8_000 });
  await expect(page.locator(`[data-testid="proposal-card-${PROPOSAL_ID}"]`)).toBeVisible({ timeout: 4_000 });

  // Click Reject.
  await page.locator('[data-testid="pc-reject-btn"]').click();

  // ProposalCard unmounts when the queue is empty.
  await expect(proposalRegion).not.toBeVisible({ timeout: 4_000 });

  // No card with this title should have been written to the board.
  const board = await readBoard(page, storySlug);
  expect(board?.lanes[0]?.cards.some((c) => c.title === CARD_TITLE) ?? false).toBe(false);
});

// ─── AC-SC-10: Manuscript deep link ──────────────────────────────────────────

test('AC-SC-10: a board card with a manuscript/ tag shows "Go to scene" under Linked scenes', async () => {
  await openBoardView(page);

  const SCENE_ID = 'abc123';
  const WIKILINK = 'worldbuilding/deep-link-scene';

  await page.evaluate(
    ({ slug, wikilink, sceneId }) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterAddCard({
          storySlug: slug,
          laneIndex: 0,
          card: {
            wikilink,
            title: 'Deep Link Scene',
            done: false,
            tags: [`manuscript/${sceneId}`],
          },
        }),
    { slug: storySlug, wikilink: WIKILINK, sceneId: SCENE_ID },
  );
  await reloadBoardView(page);

  const linked = page.locator('[data-testid="crafter-linked-scenes"]');
  await expect(linked).toBeVisible({ timeout: 6_000 });
  await expect(linked).toContainText('Deep Link Scene');
  await expect(linked.locator('button', { hasText: 'Go to scene' }).first()).toBeVisible();
});

// ─── AC-SC-12: External edit conflict alert ───────────────────────────────────

test('AC-SC-12: writing board.md from outside the app surfaces the conflict alert', async () => {
  await openBoardView(page);

  // storySlug is discovered in beforeAll — it is guaranteed non-empty here.
  const boardFilePath = boardPath(notesVaultDir, storySlug);
  expect(fs.existsSync(boardFilePath), 'board.md must exist before external edit').toBe(true);

  // Simulate an external write by appending a comment to the file outside the app.
  const original = fs.readFileSync(boardFilePath, 'utf-8');
  fs.writeFileSync(boardFilePath, original + '\n<!-- external-edit -->');

  // The file-watcher (SKY-1759) should emit scene-crafter:external-edit which sets conflicted=true.
  const conflictAlert = page.locator('.scene-crafter-conflict[role="alert"]');
  await expect(conflictAlert).toBeVisible({ timeout: 10_000 });
  await expect(conflictAlert).toContainText('Board changed on disk');

  // Dismiss by choosing "Keep my version".
  await conflictAlert.locator('button', { hasText: 'Keep my version' }).click();
  await expect(conflictAlert).not.toBeVisible({ timeout: 4_000 });
});

// ─── AC-SC-14: Per-story isolation ───────────────────────────────────────────

test('AC-SC-14: each story has an independent board that does not share cards', async () => {
  // Navigate to Editor first so the title-bar File menu is accessible.
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 6_000 });

  // Create the second story via the StoryNavigator add button (always visible).
  const storyBIndex = await createStory(page);

  await selectStory(page, storyBIndex);
  await openBoardView(page);

  // Board for story B should have 5 empty lanes — none of story A's cards.
  // storySlug at this point still refers to story A; find story B's slug
  // as the scenes-dir entry that is not storySlug.
  const scenesDir = path.join(notesVaultDir, 'scenes');
  const slugDirs = fs.existsSync(scenesDir)
    ? fs.readdirSync(scenesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];
  expect(slugDirs.length, 'Two stories must produce two separate scene directories').toBeGreaterThanOrEqual(2);

  const storyBSlug = slugDirs.find((slug) => slug !== storySlug);
  expect(storyBSlug, 'Story B must have its own scenes/<slug> directory').toBeTruthy();

  const boardB = await readBoard(page, storyBSlug as string);
  const totalCardsB = boardB?.lanes.reduce((sum, lane) => sum + lane.cards.length, 0) ?? -1;
  expect(totalCardsB, 'Story B board must have no cards from Story A').toBe(0);
});

// ─── AC-SC-13: Write error banner ────────────────────────────────────────────

test.skip('AC-SC-13: I/O error during board save surfaces the write-error banner', async () => {
  // Simulating a file-lock or EPERM at the filesystem layer requires platform-specific
  // tooling (chattr +i on Linux, SetFileAttributes on Windows) which is unreliable in
  // headless CI across Ubuntu and macOS. This AC is instead covered by the IPC unit test
  // in electron-main/src/sceneCrafterIpc.test.ts which throws from writeFileAtomic and
  // asserts the handler propagates the error. Re-enable when a reliable cross-platform
  // mock approach is identified (tracked in SKY-1766 thread).
});

// ─── AC-SC-15: Suggested-card selection feeds draft context (SKY-7601) ───────

test('AC-SC-15: clicking a suggested card selects it instead of writing to the retired lanes board', async () => {
  // Suggested cards come from the notes vault (crafterState.suggestedFromVault),
  // not from board.lanes — seed one note so the Suggested cards panel is non-empty.
  fs.mkdirSync(path.join(notesVaultDir, 'Locations'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Locations', 'Ward Violet.md'), 'A quiet ward at the city\'s edge.');

  await reloadBoardView(page);

  const suggested = page.locator('.sc-suggest');
  const before = await readBoard(page, storySlug);
  const cardsBefore = before?.lanes.reduce((sum, lane) => sum + lane.cards.length, 0) ?? -1;

  const firstCard = suggested.locator('.sc-sugg-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: 8_000 });
  await expect(firstCard).toHaveAttribute('aria-pressed', 'false');

  await firstCard.click();
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true');

  // No lane card is created by this click — it only toggles selection state.
  const after = await readBoard(page, storySlug);
  const cardsAfter = after?.lanes.reduce((sum, lane) => sum + lane.cards.length, 0) ?? -1;
  expect(cardsAfter).toBe(cardsBefore);

  // Toggling again deselects it.
  await firstCard.click();
  await expect(firstCard).toHaveAttribute('aria-pressed', 'false');
});

// ─── SKY-10511: hook-line excerpt + drag-to-select in the closed Setup rail ──

test('SKY-10511: Setup-rail card shows the note hook line, and dragging toggles selection like click', async () => {
  fs.mkdirSync(path.join(notesVaultDir, 'Locations'), { recursive: true });
  fs.writeFileSync(
    path.join(notesVaultDir, 'Locations', 'Ward Violet.md'),
    "# Ward Violet\n\nThe district that doesn't exist.\n",
  );

  await reloadBoardView(page);

  const suggested = page.locator('.sc-suggest');
  const card = suggested.getByRole('button', { name: /Ward Violet/i });
  await card.waitFor({ state: 'visible', timeout: 8_000 });

  // Defect 1 — the card body is the note's hook line (first body line after
  // the H1), not the vault folder breadcrumb. Crosses the full boundary:
  // fs write → main-process excerpt during NOTES_VAULT_LIST → rail render.
  await expect(card.locator('.sc-sugg-d')).toHaveText("The district that doesn't exist.");

  // The Setup-view hint advertises drag, matching the canvas rail verbatim.
  await expect(page.locator('.sc-suggest-hint')).toContainText('Click or drag a card onto the board');

  // Defect 2 — in the Setup view dragstart IS the activation gesture: it
  // toggles the card into planSel exactly like click (there is no drop
  // target; the drag itself selects). Same real-DragEvent pattern as
  // dragSuggestedCardOntoCanvas below.
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await card.evaluate((el) => {
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  });
  await expect(card).toHaveAttribute('aria-pressed', 'true');

  // Dragging again deselects — identical toggle semantics to click.
  await card.evaluate((el) => {
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
  });
  await expect(card).toHaveAttribute('aria-pressed', 'false');
});

// ─── AC-SC-17: Scenes-tab mini canvas pan/zoom + survives a real app restart ─
//
// SKY-8265 AC2 ("Add to scene board places the draft card on the board and it
// survives an app restart") and AC3 ("board mini canvas pans and zooms") name
// a genuine app restart, not a component remount — SKY-8207/#1107 already
// covers the remount case at the unit level with a mocked window.api, which
// per the E2E standard (SKY-7994) does not satisfy "crosses the process
// boundary". This test seeds a board file shaped exactly like the real
// addDraftToBoard() output (a hub card + a "— first pass" draft card,
// composeDraftPassCard/composeDraftBoard in crafterState.ts) directly on disk
// — AI generation itself needs a live API key unavailable in CI — then drives
// the mini canvas through the UI, closes the Electron app, relaunches it
// against the same userData/vault dirs, and re-verifies both the board and
// its pan/zoom behavior survive the real restart.

/**
 * Switch the right sidebar (GlobalRightSidebar → AgentHubPanel) to its
 * "Scenes" tab (M6: panel-add UI is gone — Scenes is one of the four fixed
 * tabs). Every locator here is scoped to `[data-testid="global-right-sidebar"]`
 * to avoid matching the left sidebar's unrelated controls.
 */
async function openScenesPanel(pg: Page): Promise<void> {
  const showBtn = pg.getByRole('button', { name: 'Show right sidebar' });
  if (await showBtn.isVisible().catch(() => false)) await showBtn.click();
  const grs = pg.locator('[data-testid="global-right-sidebar"]');
  await expect(grs).toBeVisible({ timeout: 8_000 });
  await grs.getByRole('tab', { name: 'Scenes' }).click();
  await expect(grs.locator('.scenes-panel-root')).toBeVisible({ timeout: 8_000 });
}

test('AC-SC-17: Scenes-tab mini canvas pans/zooms and its board survives a full app restart', async () => {
  const boardsDir = path.join(notesVaultDir, 'Boards', storySlug);
  fs.mkdirSync(boardsDir, { recursive: true });
  const boardJson = {
    nodes: [
      { id: 'b1-0', type: 'text', x: 440, y: 40, width: 280, height: 120, text: 'Cold Open — beats\n\nStep through the gate' },
      { id: 'b1-firstpass', type: 'text', x: 440, y: 220, width: 320, height: 220, text: 'Cold Open — first pass\n\nShe reached the sealed door and stopped.\n\n— 7 words' },
    ],
    edges: [{ id: 'edge-0', fromNode: 'b1-0', toNode: 'b1-firstpass' }],
  };
  fs.writeFileSync(path.join(boardsDir, 'Cold Open — board 1.canvas.json'), JSON.stringify(boardJson, null, 2));

  // AC-SC-14 (run immediately before this test) switches the active story to
  // story B and leaves it selected — re-select story A (always index 0, created
  // first in beforeAll), whose slug this test just seeded a board under.
  await clickStoryNav(page);
  await selectStory(page, 0);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 8_000 });

  await openScenesPanel(page);
  const scenesPanel = page.locator('[data-testid="global-right-sidebar"] .scenes-panel-root');
  const mini = scenesPanel.locator('[data-testid="scenes-panel-mini"]');
  await expect(mini).toBeVisible({ timeout: 8_000 });
  await expect(mini.getByText(/first pass/i)).toBeVisible();

  // Pan + zoom on the mini canvas (AC3).
  const stage = mini.locator('[data-testid="canvas-stage"]');
  const zoomPct = mini.locator('[data-testid="canvas-zoom-pct"]');
  await expect(zoomPct).toHaveText('100%');
  const panLayer = mini.locator('[data-testid="canvas-pan-layer"]');
  await panLayer.scrollIntoViewIfNeeded();
  const box = await panLayer.boundingBox();
  if (!box) throw new Error('canvas-pan-layer has no bounding box');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 35);
  await page.mouse.up();
  await expect(stage).toHaveAttribute('style', /translate\(20px,\s*15px\)/);
  await mini.getByTitle('Zoom in').click();
  await expect(zoomPct).toHaveText('115%');

  // "Open full" reaches the same board in the real Scene Crafter canvas.
  await scenesPanel.getByRole('button', { name: /open full/i }).click();
  await expect(page.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.sc-board-row', { hasText: 'Cold Open' })).toBeVisible({ timeout: 8_000 });

  // Full restart with the same userData/vault dirs — a genuine process-boundary crossing.
  await app?.close().catch(() => {});
  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // The app restores the last-open tab on restart, which may already be a
  // subview of this story (e.g. Scene Crafter's own left-nav section) rather
  // than the Story Writer navigator — route through Story Writer first, then
  // (re-)select story A (index 0, created in beforeAll) if the navigator shows.
  await clickStoryNav(page);
  const navigatorEntry = page.locator('.nav-story-title').first();
  if (await navigatorEntry.isVisible().catch(() => false)) {
    await navigatorEntry.click();
  }
  await page.locator('[data-testid="story-subview-editor"]').click();

  await openScenesPanel(page);
  const miniAfter = page.locator('[data-testid="global-right-sidebar"] .scenes-panel-root [data-testid="scenes-panel-mini"]');
  await expect(miniAfter).toBeVisible({ timeout: 8_000 });
  await expect(miniAfter.getByText(/first pass/i)).toBeVisible();

  // Still pans and zooms on the restored board.
  const zoomPctAfter = miniAfter.locator('[data-testid="canvas-zoom-pct"]');
  await expect(zoomPctAfter).toHaveText('100%');
  await miniAfter.getByTitle('Zoom in').click();
  await expect(zoomPctAfter).toHaveText('115%');
});

// ─── SKY-8435: M19 dyslexia-conformance floor on the setup-form GOAL/CONFLICT
//     textareas (M18-M19-M25-A11Y-DYSLEXIA-SPEC.md §2.3 — the one thing the
//     existing SCENE-CRAFTER-CANVAS-SPEC dyslexia section doesn't already
//     cover: the form that feeds the cards, not just the cards). ─────────────

test('SKY-8435: GOAL/CONFLICT setup fields render with the dyslexia-conformance spacing bundle', async () => {
  await openBoardView(page);

  const goal = page.getByLabel('GOAL');
  await expect(goal).toBeVisible();
  await expect.poll(() => goal.evaluate((el) => {
    const styles = getComputedStyle(el);
    const fontSize = parseFloat(styles.fontSize);
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      lineHeightRatio: round2(parseFloat(styles.lineHeight) / fontSize),
      letterSpacingRatio: round2((parseFloat(styles.letterSpacing) || 0) / fontSize),
      resize: styles.resize,
    };
  })).toEqual({ lineHeightRatio: 1.6, letterSpacingRatio: 0.01, resize: 'vertical' });

  // Regression guard for the old fixed 44px box (~2 cramped lines at this
  // line-height): the field must give a GOAL/CONFLICT paragraph real room,
  // and resize:vertical (asserted above) is the user's escape hatch beyond
  // that — the spec's "container grows or scrolls, never clips" floor (§0).
  const boxHeight = await goal.evaluate((el) => el.getBoundingClientRect().height);
  expect(boxHeight).toBeGreaterThanOrEqual(70);
});

// ─── SKY-9878 (M10-S3): SUGGESTED CARDS rail on the open canvas board ────────
//
// Canvas spec §2 ("click OR drag onto the canvas both place it") + M10-S3
// acceptance: the rail renders CHARACTERS/LOCATIONS/ITEMS & SYSTEMS against a
// seeded vault fixture, click-to-add and drag-to-add both place a real card
// on the open board, and a vault write restocks the rail with no reload.

/**
 * Drag a suggested-card rail entry onto a drop target using a real
 * `DataTransfer` + `DragEvent` (a genuine Chromium renderer, unlike jsdom,
 * implements both) — mirrors `notes-tree-drag-sky8891.spec.ts`'s pattern.
 * The same DataTransfer instance is reused dragstart → dragover → drop, same
 * as a real OS-level drag gesture.
 */
async function dragSuggestedCardOntoCanvas(view: Locator, cardTitle: string): Promise<void> {
  const card = view.locator('.sc-suggest').getByRole('button', { name: new RegExp(cardTitle, 'i') });
  const target = view.getByTestId('canvas-board');
  const box = await target.boundingBox();
  if (!box) throw new Error('canvas-board has no bounding box');
  const clientX = box.x + box.width / 2;
  const clientY = box.y + box.height / 2;

  await card.evaluate((el) => {
    const dt = new DataTransfer();
    (window as unknown as { __sc9878DT: DataTransfer }).__sc9878DT = dt;
    el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await target.evaluate((el, coords) => {
    const dt = (window as unknown as { __sc9878DT: DataTransfer }).__sc9878DT;
    el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, ...coords, dataTransfer: dt }));
    el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, ...coords, dataTransfer: dt }));
  }, { clientX, clientY });
}

/**
 * Opens the "Cold Open" board seeded by AC-SC-17 and returns locators scoped
 * to the canvas-board *view* — the editor's Scenes-tab mini canvas also
 * renders a `[data-testid="canvas-board"]` in read-only mode, so an unscoped
 * page-wide lookup is a strict-mode double match whenever that panel is open.
 */
async function openColdOpenBoard(pg: Page): Promise<{ view: Locator; stage: Locator }> {
  await pg.locator('.sc-board-row', { hasText: 'Cold Open' }).click();
  const view = pg.locator('.sc-canvas-view');
  await expect(view.getByTestId('canvas-board')).toBeVisible({ timeout: 8_000 });
  return { view, stage: view.getByTestId('canvas-stage') };
}

test('SKY-9878: rail renders CHARACTERS/LOCATIONS/ITEMS & SYSTEMS, click-to-add and drag-to-add both place a card', async () => {
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Mira Veynn.md'), 'POV. Dread first, wonder second.');
  fs.mkdirSync(path.join(notesVaultDir, 'Items & Systems'), { recursive: true });
  fs.writeFileSync(path.join(notesVaultDir, 'Items & Systems', 'Brass Token.md'), 'The Broker’s marker.');

  await reloadBoardView(page);
  const { view, stage } = await openColdOpenBoard(page);

  const suggested = view.locator('.sc-suggest');
  // exact: true — a card's own description text (e.g. "Characters", the
  // vault folder) is a lowercase substring of the group header otherwise.
  await expect(suggested.getByText('CHARACTERS', { exact: true })).toBeVisible();
  await expect(suggested.getByText('LOCATIONS', { exact: true })).toBeVisible();
  await expect(suggested.getByText('ITEMS & SYSTEMS', { exact: true })).toBeVisible();

  const beforeClick = await stage.locator('.cvb-card').count();
  await suggested.getByRole('button', { name: /Mira Veynn/i }).click();
  await expect(stage.locator('.cvb-card', { hasText: 'Mira Veynn' })).toBeVisible({ timeout: 5_000 });
  expect(await stage.locator('.cvb-card').count()).toBe(beforeClick + 1);

  // Drag-to-add produces the same board state as click-to-add: one more
  // real card, same title/body, now via native HTML5 drag/drop.
  const beforeDrag = await stage.locator('.cvb-card').count();
  await dragSuggestedCardOntoCanvas(view, 'Brass Token');
  await expect(stage.locator('.cvb-card', { hasText: 'Brass Token' })).toBeVisible({ timeout: 5_000 });
  expect(await stage.locator('.cvb-card').count()).toBe(beforeDrag + 1);

  // Both cards persisted to the real .canvas.json on disk (survives a reload).
  await reloadBoardView(page);
  const { stage: stageAfterReload } = await openColdOpenBoard(page);
  await expect(stageAfterReload.locator('.cvb-card', { hasText: 'Mira Veynn' })).toBeVisible();
  await expect(stageAfterReload.locator('.cvb-card', { hasText: 'Brass Token' })).toBeVisible();
});

test('SKY-9878: a vault write while the canvas rail is open restocks it with no manual refresh', async () => {
  await reloadBoardView(page);
  const { view } = await openColdOpenBoard(page);
  const suggested = view.locator('.sc-suggest');
  await expect(suggested.getByText('The Sunken Gate')).toHaveCount(0);

  // Real cross-boundary write: chokidar picks it up, main pushes
  // vault:notes-updated, the rail refetches — no reload/re-navigation here.
  fs.writeFileSync(path.join(notesVaultDir, 'Locations', 'The Sunken Gate.md'), 'An ancient floodgate.');

  await expect(suggested.getByText('The Sunken Gate')).toBeVisible({ timeout: 8_000 });
});

// ─── SKY-11049: full reachability loop — click a suggested card, watch it ────
// land in the generated draft board, watch it survive a reload. Nothing is
// pre-seeded: a fresh story (AC-SC-14's pattern) starts with zero boards.

/** Replace the streaming IPC with a deterministic, no-network mock (mirrors
 *  m19-scene-crafter-prose-invariant.spec.ts's installDraftStreamMock). */
async function installDraftStreamMock(electronApp: ElectronApplication, text: string): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, args) => {
    try { ipcMain.removeHandler('stream:start'); } catch { /* not registered */ }
    ipcMain.handle('stream:start', (event) => {
      const streamId = 'mock-sky11049-stream';
      setTimeout(() => {
        event.sender.send('stream:token', { streamId, token: args.text });
        event.sender.send('stream:end', { streamId });
      }, 30);
      return { streamId };
    });
  }, { text });
}

test('SKY-11049: a suggested card clicked in Setup visibly selects, lands on the generated board, and survives reload', async () => {
  if (!app) throw new Error('shared Electron app not launched');
  await installDraftStreamMock(app, 'A gust of cold air rolled through the doorway.');

  // A fresh story so this test starts with zero boards — the owner report
  // constraint (§4c: never pre-seed the thing under test).
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  const storyIndex = await createStory(page);
  await selectStory(page, storyIndex);
  await openBoardView(page);
  await expect(page.locator('.sc-board-row')).toHaveCount(0);

  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(
    path.join(notesVaultDir, 'Characters', 'Mira Veynn.md'),
    'Reluctant heir — resourceful, haunted.',
  );
  await reloadBoardView(page);

  const suggestedCard = page.locator('.sc-suggest').getByRole('button', { name: /Mira Veynn/i });
  await expect(suggestedCard).toBeVisible({ timeout: 8_000 });
  await expect(suggestedCard).toHaveAttribute('aria-pressed', 'false');
  await expect(suggestedCard).not.toHaveClass(/sc-sugg-card--on/);

  // Click does something visible (SKY-11049 owner report): aria-pressed
  // flips AND the selected-state style is actually applied — SceneCrafterPage
  // .css previously had no rule for .sc-sugg-card--on at all.
  await suggestedCard.click();
  await expect(suggestedCard).toHaveAttribute('aria-pressed', 'true');
  await expect(suggestedCard).toHaveClass(/sc-sugg-card--on/);
  await expect(suggestedCard).toHaveCSS('border-color', /0, *240, *255/);

  // Generate a draft with the suggested card selected as context, then add
  // it to the scene board.
  await page.locator('.sc-draft-btn', { hasText: 'Generate' }).click();
  await expect(page.locator('[data-testid="sc-draft-card"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="sc-draft-card"]').getByRole('button', { name: 'Add to scene board' }).click();

  // A brand-new canvas board opens, carrying the chosen suggested card — the
  // "click places it on the board" half of the owner report.
  await expect(page.locator('.sc-canvas-body')).toBeVisible({ timeout: 8_000 });
  const stage = page.getByTestId('canvas-stage');
  await expect(stage.locator('.cvb-card', { hasText: 'Mira Veynn' })).toBeVisible({ timeout: 5_000 });
  await expect(stage.locator('.cvb-card', { hasText: '— first pass' })).toBeVisible();

  // Survives a real reload (unmount + IPC re-read from disk, not just React state).
  await reloadBoardView(page);
  await page.locator('.sc-board-row').first().click();
  await expect(page.locator('.sc-canvas-body')).toBeVisible({ timeout: 8_000 });
  const stageAfterReload = page.getByTestId('canvas-stage');
  await expect(stageAfterReload.locator('.cvb-card', { hasText: 'Mira Veynn' })).toBeVisible();
  await expect(stageAfterReload.locator('.cvb-card', { hasText: '— first pass' })).toBeVisible();
});

// ─── SKY-11049 item 7: POV picker resolves a real, non-"Characters"-folder ───
// vault shape. Owner report: his vault has no top-level Characters folder —
// notes live wherever he keeps them and carry a #Character tag instead, so
// the old group==='CHARACTERS' filter left the POV control with nothing to
// pick. Nothing is pre-seeded: the character note is created through the
// Notes vault UI itself, exactly like the owner would.
//
// Own describe block with its own fresh Electron app/vault (not the file's
// shared instance): castCardsFromSuggested deliberately prefers a Characters
// folder over the tag fallback vault-wide (see crafterState.ts), and the
// shared suite's notes vault already has a Characters/Mira Veynn.md note
// from the item-2 reachability test above — reusing it would mask the exact
// fallback path this test exists to prove.

/**
 * The seed vault's twin-root layout (separate vaultRoot/notesVaultRoot dirs)
 * reads as a "v0.4" vault to MythosMigrationCenter, whose prompt can pop up
 * (SKY-8882, unrelated to Scene Crafter) and intercept clicks. Dismiss it if
 * present.
 */
async function dismissMigrationPromptIfPresent(pg: Page): Promise<void> {
  const dismissBtn = pg.locator('[data-testid="mythos-migration-prompt-dismiss"]');
  if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) await dismissBtn.click();
}

test.describe('SKY-11049 item 7 — POV vault-wide character fallback (fresh profile)', () => {
  let localApp: ElectronApplication | undefined;
  let localPage: Page;
  let localUserData: string;
  let localVaultDir: string;
  let localNotesVaultDir: string;

  test.beforeAll(async () => {
    localUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-pov-'));
    localVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-pov-story-'));
    localNotesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-pov-notes-'));
    seedUserData(localUserData, localVaultDir, localNotesVaultDir);
    localApp = await launchApp(localUserData);
    localPage = await firstWindow(localApp);
    await expect(localPage.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  });

  test.afterAll(async () => {
    await localApp?.close().catch(() => {});
    fs.rmSync(localUserData, { recursive: true, force: true });
    fs.rmSync(localVaultDir, { recursive: true, force: true });
    fs.rmSync(localNotesVaultDir, { recursive: true, force: true });
  });

  test('a #Character-tagged note created via the UI appears in the POV picker and fills the field', async () => {
    const storyIndex = await createStory(localPage);
    await selectStory(localPage, storyIndex);

    // Create ONE note via the Notes Editor UI — no top-level "Characters"
    // folder, matching the owner's real vault shape (§4c: never pre-seed the
    // thing under test).
    await localPage.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(localPage.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });
    await dismissMigrationPromptIfPresent(localPage);

    const addNoteBtn = localPage.locator('[data-testid="vb-btn-new-note"]').first();
    await expect(addNoteBtn).toBeVisible({ timeout: 6_000 });
    await addNoteBtn.click();
    const dialog = localPage.locator('.ntd-dialog');
    await expect(dialog).toBeVisible({ timeout: 6_000 });
    await dialog.locator('[data-testid="ntd-blank-title"]').fill('Kael Thorne');
    await dialog.locator('[data-testid="ntd-submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 6_000 });

    // Open it and type a body with an inline #Character hashtag — the
    // owner's own tagging convention, not a frontmatter field a UI never
    // exposes. A fresh profile's NoteViewer defaults to Source mode (raw
    // textarea), not the rendered rich-text editor — both write the same
    // underlying markdown.
    await dismissMigrationPromptIfPresent(localPage);
    await localPage.locator('[data-testid^="vb-row-"]', { hasText: 'Kael Thorne' }).first().click();
    const editor = localPage.getByRole('textbox', { name: 'Edit note: Kael Thorne.md' });
    await expect(editor).toBeVisible({ timeout: 8_000 });
    await editor.click();
    await editor.fill('A wandering blade, haunted by his last war. #Character');
    await expect(editor).toHaveValue(/#Character/);

    // Wait for the debounced autosave to actually land on disk — Scene
    // Crafter's character signal is computed from the file, not React state.
    const notePath = path.join(localNotesVaultDir, 'Kael Thorne.md');
    await expect.poll(
      () => (fs.existsSync(notePath) ? fs.readFileSync(notePath, 'utf-8') : ''),
      { timeout: 8_000 },
    ).toContain('#Character');

    await dismissMigrationPromptIfPresent(localPage);
    await openBoardView(localPage);

    const povField = localPage.getByRole('combobox', { name: 'POV' });
    await expect(povField).toBeVisible({ timeout: 8_000 });
    await expect(povField).toHaveJSProperty('tagName', 'INPUT'); // typeable, not a <select> (item 7 point 1)

    await povField.click();
    const option = localPage.getByRole('option', { name: /kael thorne/i });
    await expect(option).toBeVisible({ timeout: 8_000 });
    await option.click();

    await expect(povField).toHaveValue('Kael Thorne');
    await expect(localPage.getByRole('listbox', { name: /vault characters/i })).not.toBeVisible();
  });
});
