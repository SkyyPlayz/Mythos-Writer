/**
 * sceneCrafter.spec.ts — SKY-1766
 *
 * Playwright E2E coverage for Scene Crafter Kanban v0.
 *
 * Acceptance criteria:
 *   AC-SC-01  Board file created with 5 canonical lanes
 *   AC-SC-02  Vault note drag creates a card in the target lane
 *   AC-SC-03  Card drag moves card between lanes
 *   AC-SC-04  Checkbox toggle marks a card done / undone
 *   AC-SC-05  Lane management — add / rename / delete (empty + force)
 *   AC-SC-06  Card delete removes the card from the board
 *   AC-SC-07  Obsidian round-trip — serialized board.md matches format spec
 *   AC-SC-08  Brainstorm accept adds card to Scene Crafter
 *   AC-SC-09  Brainstorm reject removes proposal from list
 *   AC-SC-10  Manuscript deep link — "Go to scene" button visible for tagged card
 *   AC-SC-11  Empty board CTA shown when no cards
 *   AC-SC-12  External edit conflict alert surfaced
 *   AC-SC-13  Write error banner shown — SKIPPED (platform-specific lock simulation)
 *   AC-SC-14  Per-story isolation — boards are independent across stories
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
  // Wait for the lanes container, which is only rendered once the board has fully loaded.
  // (The loading state renders .scene-crafter-page but not .scene-crafter-lanes.)
  await expect(pg.locator('.scene-crafter-lanes')).toBeVisible({ timeout: 8_000 });
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

// ─── AC-SC-01: Board created with 5 canonical lanes ──────────────────────────

test('AC-SC-01: board file created with 5 canonical lanes', async () => {
  await openBoardView(page);

  const lanes = ['Idea', 'Outline', 'Draft', 'Revision', 'Done'];
  for (const lane of lanes) {
    await expect(page.locator(`[data-testid="scene-crafter-lane-${lane}"]`))
      .toBeVisible({ timeout: 6_000 });
  }

  // Verify lane count label in header
  await expect(page.locator('.scene-crafter-actions')).toContainText('5 lanes');
});

// ─── AC-SC-02: Vault note drag creates a card ────────────────────────────────

test('AC-SC-02: dragging a vault note path into a lane creates a card', async () => {
  await openBoardView(page);

  const NOTE_PATH = 'worldbuilding/act-one-notes';
  const ideaLane = page.locator('[data-testid="scene-crafter-lane-Idea"]');

  // Simulate drag-drop by firing DragEvent on the lane with the note MIME type set.
  await ideaLane.dispatchEvent('dragover', {});
  await ideaLane.evaluate((el, notePath) => {
    const dt = new DataTransfer();
    dt.setData('application/x-mythos-note-path', notePath);
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    el.dispatchEvent(event);
  }, NOTE_PATH);

  await expect(
    page.locator(`[data-testid="scene-crafter-card-${NOTE_PATH}"]`),
  ).toBeVisible({ timeout: 8_000 });
});

// ─── AC-SC-03: Card drag moves card between lanes ────────────────────────────

test('AC-SC-03: moving a card to another lane updates the board', async () => {
  await openBoardView(page);

  // Ensure a card exists in the Idea lane via IPC to avoid relying on AC-SC-02 ordering.
  const WIKILINK = 'worldbuilding/scene-to-move';
  await page.evaluate(
    ({ slug, wikilink }) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterAddCard({
          storySlug: slug,
          laneIndex: 0,
          card: { wikilink, title: 'Scene To Move', done: false, tags: [] },
        }),
    { slug: storySlug, wikilink: WIKILINK },
  );
  await reloadBoardView(page);

  const card = page.locator(`[data-testid="scene-crafter-card-${WIKILINK}"]`);
  await expect(card).toBeVisible({ timeout: 6_000 });

  // Find the actual index of the card in lane 0; earlier tests may have left
  // cards there (e.g. AC-SC-02 adds act-one-notes at index 0).
  const fromIndex = await page.evaluate(
    async ({ slug, wikilink }) => {
      type Api = { sceneCrafterGetBoard: (id: string, slug: string) => Promise<{ lanes: Array<{ cards: Array<{ wikilink: string }> }> } | null> };
      const board = await (window as Window & typeof globalThis & { api: Api }).api.sceneCrafterGetBoard(slug, slug);
      return board?.lanes[0].cards.findIndex((c) => c.wikilink === wikilink) ?? -1;
    },
    { slug: storySlug, wikilink: WIKILINK },
  );
  expect(fromIndex, `Card ${WIKILINK} not found in lane 0`).toBeGreaterThanOrEqual(0);

  // Move via IPC (lane 0 → lane 1).
  await page.evaluate(
    ({ slug, fromIdx }) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterMoveCard({ storySlug: slug, fromLane: 0, fromIndex: fromIdx, toLane: 1, toIndex: 0 }),
    { slug: storySlug, fromIdx: fromIndex },
  );
  await reloadBoardView(page);

  // Card now lives inside the Outline lane.
  const outlineLane = page.locator('[data-testid="scene-crafter-lane-Outline"]');
  await expect(outlineLane.locator(`[data-testid="scene-crafter-card-${WIKILINK}"]`))
    .toBeVisible({ timeout: 6_000 });
});

// ─── AC-SC-04: Checkbox toggle marks a card done ─────────────────────────────

test('AC-SC-04: checking the checkbox marks a card done', async () => {
  await openBoardView(page);

  const WIKILINK = 'worldbuilding/toggle-test';

  // Seed a card in lane 0.
  await page.evaluate(
    ({ slug, wikilink }) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterAddCard({
          storySlug: slug,
          laneIndex: 0,
          card: { wikilink, title: 'Toggle Test', done: false, tags: [] },
        }),
    { slug: storySlug, wikilink: WIKILINK },
  );
  await reloadBoardView(page);

  const card = page.locator(`[data-testid="scene-crafter-card-${WIKILINK}"]`);
  const checkbox = card.locator('input[type="checkbox"]');

  await expect(checkbox).not.toBeChecked({ timeout: 6_000 });
  await checkbox.check();
  await expect(checkbox).toBeChecked({ timeout: 4_000 });

  // Verify persistence: navigate away and back to force a fresh board read from disk.
  await reloadBoardView(page);
  await expect(
    page.locator(`[data-testid="scene-crafter-card-${WIKILINK}"]`).locator('input[type="checkbox"]'),
  ).toBeChecked({ timeout: 6_000 });
});

// ─── AC-SC-05: Lane management — add / rename / delete ───────────────────────

test('AC-SC-05: add lane, rename it, delete empty lane', async () => {
  await openBoardView(page);

  // Add a new lane.
  await page.locator('.scene-crafter-actions button', { hasText: 'Add lane' }).click();
  const newLane = page.locator('[data-testid="scene-crafter-lane-New Lane"]');
  await expect(newLane).toBeVisible({ timeout: 6_000 });

  // Rename by double-clicking the lane header h3.
  await newLane.locator('h3').dblclick();
  const renameInput = newLane.locator('input[aria-label^="Rename lane"]');
  await expect(renameInput).toBeVisible({ timeout: 4_000 });
  await renameInput.fill('Planning');
  await renameInput.press('Enter');

  const planningLane = page.locator('[data-testid="scene-crafter-lane-Planning"]');
  await expect(planningLane).toBeVisible({ timeout: 6_000 });

  // Delete the empty lane (no confirm dialog for empty lanes).
  await planningLane.locator('button[aria-label^="Delete lane"]').click();
  await expect(planningLane).not.toBeVisible({ timeout: 6_000 });

  // Board should be back to 5 canonical lanes.
  await expect(page.locator('.scene-crafter-actions')).toContainText('5 lanes');
});

test('AC-SC-05b: delete non-empty lane shows confirmation, force-delete removes it', async () => {
  await openBoardView(page);

  // Add a lane with a card.
  await page.evaluate(
    (slug) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterAddLane(slug, 'ToDelete'),
    storySlug,
  );
  await reloadBoardView(page);

  const laneCount = await page.locator('.scene-crafter-lane').count();

  await page.evaluate(
    ({ slug, laneIndex }) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterAddCard({
          storySlug: slug,
          laneIndex,
          card: { wikilink: 'wl/card-in-lane-to-delete', title: 'Card', done: false, tags: [] },
        }),
    { slug: storySlug, laneIndex: laneCount - 1 },
  );
  await reloadBoardView(page);

  const toLaneLoc = page.locator('[data-testid="scene-crafter-lane-ToDelete"]');
  await toLaneLoc.locator('button[aria-label^="Delete lane"]').click();

  // Confirmation dialog should appear.
  const confirm = page.locator('.scene-crafter-confirm');
  await expect(confirm).toBeVisible({ timeout: 4_000 });
  await expect(confirm).toContainText('1 card');

  // Force delete.
  await confirm.locator('button', { hasText: 'Delete anyway' }).click();
  await expect(toLaneLoc).not.toBeVisible({ timeout: 6_000 });
});

// ─── AC-SC-06: Card delete ────────────────────────────────────────────────────

test('AC-SC-06: deleting a card removes it from the board', async () => {
  await openBoardView(page);

  const WIKILINK = 'worldbuilding/card-to-delete';

  await page.evaluate(
    ({ slug, wikilink }) =>
      (window as Window & typeof globalThis & { api: Record<string, (...a: unknown[]) => Promise<unknown>> })
        .api.sceneCrafterAddCard({
          storySlug: slug,
          laneIndex: 0,
          card: { wikilink, title: 'Card To Delete', done: false, tags: [] },
        }),
    { slug: storySlug, wikilink: WIKILINK },
  );
  await reloadBoardView(page);

  const card = page.locator(`[data-testid="scene-crafter-card-${WIKILINK}"]`);
  await expect(card).toBeVisible({ timeout: 6_000 });
  await card.locator('button[aria-label^="Delete card"]').click();
  await expect(card).not.toBeVisible({ timeout: 6_000 });
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

  // Must have the 5 canonical lane headings.
  for (const lane of ['Idea', 'Outline', 'Draft', 'Revision', 'Done']) {
    expect(content).toContain(`## ${lane}`);
  }

  // Must include the Obsidian Kanban settings block.
  expect(content).toContain('%% kanban:settings');
  expect(content).toContain('{"kanban-plugin":"board"}');
  expect(content).toContain('\n%%');
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

test('AC-SC-08: accepting a Brainstorm proposal adds a card to Scene Crafter', async () => {
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

  // Navigate to Scene Crafter and reload the board from disk.
  await reloadBoardView(page);

  // Verify the new card appears on the board (Idea lane, index 0).
  await expect(
    page.locator(`[data-testid="scene-crafter-card-${CARD_TITLE}"]`),
  ).toBeVisible({ timeout: 8_000 });
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

  // Navigate to Scene Crafter and verify no card was added.
  await reloadBoardView(page);
  await expect(
    page.locator(`[data-testid="scene-crafter-card-${CARD_TITLE}"]`),
  ).not.toBeVisible({ timeout: 4_000 });
});

// ─── AC-SC-10: Manuscript deep link ──────────────────────────────────────────

test('AC-SC-10: card with manuscript/ tag shows "Go to scene" deep-link button', async () => {
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

  const card = page.locator(`[data-testid="scene-crafter-card-${WIKILINK}"]`);
  await expect(card.locator('button', { hasText: 'Go to scene' })).toBeVisible({ timeout: 6_000 });
});

// ─── AC-SC-11: Empty board CTA ───────────────────────────────────────────────

test('AC-SC-11: empty board shows "Plan your next scene" CTA', async () => {
  // Create a fresh story with no cards so we reliably see the empty state.
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-empty-'));
  const tempVault = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-empty-story-'));
  const tempNotes = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sc-empty-notes-'));
  seedUserData(tempUserData, tempVault, tempNotes);

  const emptyApp = await launchApp(tempUserData);
  const emptyPage = await firstWindow(emptyApp);

  try {
    await expect(emptyPage.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await createStory(emptyPage, 'Empty Story');
    await selectStory(emptyPage, 'Empty Story');
    await openBoardView(emptyPage);

    const empty = emptyPage.locator('.scene-crafter-empty');
    await expect(empty).toBeVisible({ timeout: 6_000 });
    await expect(empty).toContainText('Plan your next scene');
  } finally {
    await emptyApp.close().catch(() => {});
    fs.rmSync(tempUserData, { recursive: true, force: true });
    fs.rmSync(tempVault, { recursive: true, force: true });
    fs.rmSync(tempNotes, { recursive: true, force: true });
  }
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

// ─── AC-SC-13: Write error banner ────────────────────────────────────────────

test.skip('AC-SC-13: I/O error during board save surfaces the write-error banner', async () => {
  // Simulating a file-lock or EPERM at the filesystem layer requires platform-specific
  // tooling (chattr +i on Linux, SetFileAttributes on Windows) which is unreliable in
  // headless CI across Ubuntu and macOS. This AC is instead covered by the IPC unit test
  // in electron-main/src/sceneCrafterIpc.test.ts which throws from writeFileAtomic and
  // asserts the handler propagates the error. Re-enable when a reliable cross-platform
  // mock approach is identified (tracked in SKY-1766 thread).
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
  const cardCount = await page.locator('.scene-crafter-card').count();
  expect(cardCount, 'Story B board must have no cards from Story A').toBe(0);

  // board.md files are in separate slug directories.
  const scenesDir = path.join(notesVaultDir, 'scenes');
  const slugDirs = fs.existsSync(scenesDir)
    ? fs.readdirSync(scenesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

  expect(slugDirs.length, 'Two stories must produce two separate scene directories').toBeGreaterThanOrEqual(2);
});
