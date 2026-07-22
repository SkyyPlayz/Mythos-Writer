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
 *   AC-SC-08  Brainstorm accept writes a scene_crafter_card onto the board
 *             (verified via IPC read — the lanes surface that displayed
 *             these cards is retired; see "known gap" note below)
 *   AC-SC-09  Brainstorm reject removes proposal from list
 *   AC-SC-10  Manuscript deep link — "Go to scene" shown for a tagged card
 *   AC-SC-12  External edit conflict alert surfaced
 *   AC-SC-13  Write error banner shown — SKIPPED (platform-specific lock simulation)
 *   AC-SC-14  Per-story isolation — boards are independent across stories
 *   AC-SC-15  Suggested-card click selects it as draft context (SKY-7601)
 *   AC-SC-16  A card tagged manuscript/<id> with no scene link is silent —
 *             the Linked scenes section only appears when one exists
 *
 * Known gap (not fixed here, out of scope for SKY-7601 per its own ticket
 * text): accepting a scene_crafter_card Brainstorm proposal still writes
 * into board.lanes[0] via sceneCrafterAddCard (BrainstormPage.tsx), which is
 * now an invisible surface unless the card happens to carry a manuscript/
 * tag. Tracked for a follow-up — SKY-7601 scoped only the Scene Crafter
 * page's own UI, not the Brainstorm accept path.
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
import { clickStoryNav } from '../helpers/navGuard';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const STORY_TITLE = 'Scene Crafter Chronicle';
const STORY_TITLE_B = 'Second Chronicle';

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

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

/** Create a story in the vault. Uses the StoryNavigator add button which is always visible. */
async function createStory(pg: Page, title: string): Promise<void> {
  await pg.locator('.nav-add-btn').first().click();
  await fillPrompt(pg, title);
  await expect(pg.locator('.nav-story-row').filter({ hasText: title }))
    .toBeVisible({ timeout: 8_000 });
}

/** Select a story by clicking its title in the StoryNavigator sidebar. */
async function selectStory(pg: Page, title: string): Promise<void> {
  await pg.locator('.nav-story-title', { hasText: title }).click();
}

/** Navigate to the Scene Crafter (Board) view via the toolbar. */
async function openBoardView(pg: Page): Promise<void> {
  await clickStoryNav(pg);
  await pg.locator('[data-testid="story-subview-kanban"]').click();
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
  await createStory(page, STORY_TITLE);
  await selectStory(page, STORY_TITLE);

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

test('AC-SC-08: accepting a Brainstorm proposal writes a card onto the Scene Crafter board', async () => {
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

  // Scene Crafter's lanes UI is retired (SKY-7601) — verify the card landed
  // on the board via IPC instead of a DOM testid that no longer exists.
  await expect.poll(async () => {
    const board = await readBoard(page, storySlug);
    return board?.lanes[0]?.cards.some((c) => c.title === CARD_TITLE) ?? false;
  }, { timeout: 8_000 }).toBe(true);
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
  // Navigate to Editor first so the sidebar nav-add-btn is accessible.
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 6_000 });

  // Create the second story via the StoryNavigator add button (always visible).
  await createStory(page, STORY_TITLE_B);

  await selectStory(page, STORY_TITLE_B);
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
