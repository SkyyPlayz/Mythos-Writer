/**
 * sky-11221-beta-reader-consolidation.spec.ts — SKY-11221 / SKY-11401
 *
 * Real cross-boundary E2E for the Beta Reader consolidation (PR #1398,
 * decision A): the Writing Assistant chat's duplicate inline "beta read"
 * intercept (old BetaReadPanel + `betaRead:scan`) was deleted. Beta Reader
 * is now the single canonical agent surface, reachable only from the Agent
 * Hub's "Beta Reader" row → BetaReaderPage overlay.
 *
 * Unlike e2e/capture-sky-11221-screenshot.spec.ts (a one-off, CI-orphaned
 * screenshot capture script that only checks the overlay renders), this
 * suite drives full UI -> preload -> ipcMain round trips on the two real
 * channels involved and runs in CI (wired into e2e-shard-4, next to the
 * writing-assistant suite it complements):
 *
 *   TC-SKY11221-01  Run a Beta Read: click through Agent Hub -> Beta Reader
 *                    row -> BetaReaderPage -> Run button -> real
 *                    `betaReport:run` IPC round trip -> report renders
 *                    (score chips + reactions) and the history rail updates.
 *                    Only the outbound LLM-facing handler is mocked (same
 *                    pattern as every other suite in this repo); everything
 *                    else — the click, the invoke, the response, the render
 *                    — is real.
 *
 *   TC-SKY11221-02  "beta read this scene" typed into the Writing Coach chat
 *                    now runs a normal `agent:writing-assistant` turn — the
 *                    deleted `.br-panel` intercept never appears, before or
 *                    after the reply streams in.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/sky-11221-beta-reader-consolidation.spec.ts --reporter=list
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
import { clickStoryNav } from './helpers/navGuard';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'sky11221-e2e-story-0001';
const CHAPTER_ID = 'sky11221-e2e-chapter-0001';
const SCENE_ID = 'sky11221-e2e-scene-0001';
const SCENE_TITLE = 'Lighthouse Scene';
const SCENE_BODY = [
  'The old lighthouse stood at the edge of the cliff, its white-painted walls reflecting',
  'the last light of a dying sun. For twenty years, the keeper had climbed its spiral',
  'staircase every evening, carrying the heavy oil canisters that kept the beacon burning.',
].join('\n');

const MOCK_CHAT_TOKENS = ['Sure — ', 'here is a read on pacing ', 'for this scene.'];
const MOCK_CHAT_RESPONSE = MOCK_CHAT_TOKENS.join('');

const MOCK_REACTION_QUOTE = 'the last light of a dying sun';
const MOCK_REACTION_NOTE = 'Strong opening image — keep it.';
const MOCK_FEEDBACK = 'Confident opening; pacing holds up through the first page.';

// ─── Seed helpers ──────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string): void {
  const now = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'SKY-11221 E2E Story',
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
                title: SCENE_TITLE,
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  { id: 'sky11221-e2e-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now },
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

  const sceneDir = path.join(vaultDir, `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes`);
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    ['---', `id: ${SCENE_ID}`, `title: "${SCENE_TITLE}"`, `updatedAt: ${now}`, '---', '', SCENE_BODY, ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: 'sk-ant-e2e-sky11221',
        onboardingComplete: true,
        theme: 'dark',
        rightSidebarVisible: true,
        notesTabUpgradeToastShown: true,
        agents: {
          writingAssistant: {
            enabled: true,
            model: 'claude-haiku-4-5-20251001',
            scanIntervalSeconds: 60,
            autoApply: false,
            confidenceThreshold: 0.85,
            maxTokensPerHour: 100_000,
            maxSuggestionsPerHour: 50,
            heartbeatIntervalMinutes: 5,
            maxTokensPerDay: 500_000,
            waScanInterval: 'manual',
          },
          brainstorm: { enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
          archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
          betaReader: { enabled: true, model: 'claude-sonnet-4-6', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openScene(page: Page, sceneTitle: string): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

/**
 * Replace the real `betaReport:run` ipcMain handler (electron-main's
 * registerBetaReportRunHandler, which normally streams from the configured
 * LLM provider) with a deterministic mock — the same "mock only the
 * outbound LLM call" pattern every other suite in this repo uses for
 * `agent:writing-assistant` / `writing:scan`. The full preload -> ipcMain ->
 * response -> BetaReaderPage render round trip is real; the mock replaces
 * the handler body entirely, so SQLite persistence (insertBetaReport) is
 * NOT exercised by this suite — the history-rail assertion is satisfied by
 * BetaReaderPage's local setReports state, not a betaReportList re-fetch.
 */
async function installBetaReportMock(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    async (
      { ipcMain },
      args: { quote: string; note: string; feedback: string },
    ) => {
      try {
        ipcMain.removeHandler('betaReport:run');
      } catch {
        /* not yet registered */
      }
      ipcMain.handle('betaReport:run', async (_event, payload: {
        storyId: string;
        scope: { kind: string; id: string; label: string };
      }) => {
        const now = new Date().toISOString();
        return {
          report: {
            id: `mock-report-${Date.now()}`,
            storyId: payload.storyId,
            scope: payload.scope,
            focus: { pacing: true, clarity: true, character: true, plot: true },
            overall: { score: 82, verdict: 'strong' as const },
            categories: [
              { key: 'pacing', label: 'Pacing', score: 84, verdict: 'strong' as const },
              { key: 'clarity', label: 'Clarity', score: 80, verdict: 'mixed' as const },
            ],
            feedback: args.feedback,
            reactions: [
              {
                id: 'mock-reaction-0001',
                kind: 'loved' as const,
                sceneId: 'sky11221-e2e-scene-0001',
                quote: args.quote,
                where: 'Opening paragraph',
                note: args.note,
              },
            ],
            createdAt: now,
          },
        };
      });
    },
    { quote: MOCK_REACTION_QUOTE, note: MOCK_REACTION_NOTE, feedback: MOCK_FEEDBACK },
  );
}

/** Replace the real `agent:writing-assistant` handler — same pattern as writing-assistant.spec.ts. */
async function installChatMock(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    async ({ ipcMain }, args: { chatTokens: string[]; chatResponse: string }) => {
      try {
        ipcMain.removeHandler('agent:writing-assistant');
      } catch {
        /* not yet registered */
      }
      ipcMain.handle('agent:writing-assistant', async (event) => {
        for (const token of args.chatTokens) {
          await new Promise<void>((r) => setTimeout(r, 40));
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:writing-assistant:chunk', { chunk: token });
          }
        }
        return { text: args.chatResponse };
      });
    },
    { chatTokens: MOCK_CHAT_TOKENS, chatResponse: MOCK_CHAT_RESPONSE },
  );
}

// ─── Module-level state ───────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11221-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11221-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await installBetaReportMock(app);
  await installChatMock(app);
});

test.afterAll(async () => {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch {
    /* already exited */
  }
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-SKY11221-01: Run a Beta Read — real betaReport:run round trip ─────────

test('TC-SKY11221-01: Beta Reader row -> BetaReaderPage -> Run produces a real report round trip', async () => {
  await openScene(page, SCENE_TITLE);

  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 8_000 });

  const betaRow = page.locator('[data-testid="ahp-agent-row-beta-reader"]');
  await expect(betaRow).toBeVisible({ timeout: 8_000 });
  await betaRow.click();

  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByRole('tab', { name: 'Reports' })).toBeVisible();
  await expect(overlay.getByRole('tab', { name: 'Chat' })).toBeVisible();

  // Before Run: empty state, no reads in history.
  await expect(overlay.locator('.beta-reader-empty')).toBeVisible({ timeout: 5_000 });
  await expect(overlay.locator('.beta-reader-history-item')).toHaveCount(0);

  // Click Run — fires window.api.betaReportRun -> preload invokeEnvelope ->
  // the mocked betaReport:run ipcMain handler -> response -> setReports/
  // setSelectedReport in BetaReaderPage.
  const runBtn = overlay.locator('.beta-reader-run-btn');
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
  await runBtn.click();

  // Real round trip landed: the empty state is gone, a report renders with
  // the mocked score and reaction content, and the history rail gained an entry.
  await expect(overlay.locator('.beta-reader-empty')).toHaveCount(0, { timeout: 8_000 });
  await expect(overlay.locator('.beta-score-chip__score').first()).toHaveText('82', { timeout: 5_000 });
  await expect(overlay.locator('.beta-reaction-card__quote')).toContainText(MOCK_REACTION_QUOTE);
  await expect(overlay.locator('.beta-reaction-card__note')).toContainText(MOCK_REACTION_NOTE);
  await expect(overlay.locator('.beta-reader-overall-feedback')).toContainText(MOCK_FEEDBACK);
  await expect(overlay.locator('.beta-reader-history-item')).toHaveCount(1, { timeout: 5_000 });

  await overlay.locator('.beta-reader-close').click();
  await expect(overlay).toBeHidden({ timeout: 5_000 });
});

// ─── TC-SKY11221-02: "beta read this scene" is a normal Writing Coach turn ────

test('TC-SKY11221-02: "beta read this scene" in Writing Coach chat runs a normal turn, no .br-panel intercept', async () => {
  const waRow = page.locator('[aria-label^="Open Writing Coach chat"]');
  if (await waRow.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await waRow.click();
  }
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });

  // The deleted intercept UI must be absent before we even submit.
  await expect(page.locator('.br-panel')).toHaveCount(0);

  const input = page.getByRole('textbox', { name: 'Writing coach prompt' });
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await expect(async () => {
    await input.fill('beta read this scene');
    await expect(input).toHaveValue('beta read this scene', { timeout: 500 });
  }).toPass({ timeout: 5_000 });
  await input.press('Enter');

  // Still gone mid-flight and after the reply lands — proves the request
  // went over the normal agent:writing-assistant IPC seam, not a revived
  // betaRead:scan-shaped path.
  await expect(page.locator('.br-panel')).toHaveCount(0);

  const userBubble = page.locator('.wa-user-bubble', { hasText: 'beta read this scene' });
  await expect(userBubble).toBeVisible({ timeout: 3_000 });

  const assistantReply = page.locator('.wa-assistant-bubble', { hasText: MOCK_CHAT_RESPONSE });
  await expect(assistantReply).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.br-panel')).toHaveCount(0);
});
