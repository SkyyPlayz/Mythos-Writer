/**
 * writing-assistant.spec.ts — SKY-2633
 *
 * E2E Playwright tests for the Writing Assistant panel.
 *
 * Coverage:
 *   Heartbeat:  AC-WA-01, AC-WA-03, AC-WA-04, AC-WA-05, AC-WA-07, AC-WA-08
 *   Chat:       AC-WA-09, AC-WA-10, AC-WA-11, AC-WA-13
 *   Voice TTS:  AC-WA-22, AC-WA-23, AC-WA-24
 *   Settings:   AC-WA-26, AC-WA-27
 *
 * All Anthropic / voice IPC handlers are replaced with deterministic mocks.
 * No real API key or network access is required.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/writing-assistant.spec.ts --reporter=list
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

const STORY_ID = 'wa-e2e-story-0001';
const CHAPTER_ID = 'wa-e2e-chapter-0001';
const SCENE_ID = 'wa-e2e-scene-0001';
const EMPTY_SCENE_ID = 'wa-e2e-scene-0002';

/**
 * 200+ words of literary prose so the scheduler's prose-length guard doesn't
 * short-circuit before the mock scan handler runs.
 */
const SCENE_BODY = [
  'The old lighthouse stood at the edge of the cliff, its white-painted walls reflecting',
  'the last light of a dying sun. For twenty years, the keeper had climbed its spiral',
  'staircase every evening, carrying the heavy oil canisters that kept the beacon burning',
  'through the darkest nights. He knew each step by touch now, each crack in the stone',
  'a familiar landmark in the dark.',
  '',
  'The sea below crashed against the rocks with relentless patience, carving away at the',
  'cliff inch by inch. The keeper had watched the edge creep closer over the decades,',
  'marking the recession each spring with a painted stone. Seven feet in twenty years.',
  'He wondered sometimes whether the lighthouse or the keeper would outlast the cliff.',
  '',
  'Tonight felt different. The barometer had been dropping since morning, and the smell',
  'of salt and rain was thick in the wind. Ships would need the light tonight. He lit',
  'the wick with steady hands and watched the flame catch, spreading golden warmth',
  'through the lens. The beam began its slow rotation, slicing through the gathering dark.',
].join('\n');

const MOCK_CHAT_TOKENS = ['Here is some ', 'writing advice ', 'for your scene.'];
const MOCK_CHAT_RESPONSE = MOCK_CHAT_TOKENS.join('');

// ─── Seed helpers ──────────────────────────────────────────────────────────────

function buildAppSettings(waEnabled = true): object {
  return {
    apiKey: 'sk-ant-e2e-writing-assistant',
    onboardingComplete: true,
    provider: {
      kind: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      apiKey: 'sk-ant-e2e-writing-assistant',
    },
    agents: {
      writingAssistant: {
        enabled: waEnabled,
        model: 'claude-haiku-4-5-20251001',
        scanIntervalSeconds: 60,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 5,
        maxTokensPerDay: 500_000,
        waScanInterval: 60,
      },
      brainstorm: {
        enabled: false,
        model: 'claude-haiku-4-5-20251001',
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
    voice: { enabled: true, cloudFallback: false },
    // Force IPC path in useTtsPlayer so E2E tests don't depend on OS speechSynthesis,
    // which fires onerror immediately in headless Electron (no audio device).
    // The voice:speak IPC handler is mocked in installIpcMocks.
    tts: { enabled: true, provider: 'local', localBinaryPath: '/dev/null' },
    // GRS (GlobalRightSidebar) only renders when rightSidebarVisible is an explicit boolean.
    // notesTabUpgradeToastShown prevents an extra fire-and-forget settingsSet during loadVault.
    // Do NOT set layoutMigrationDone: the migration sets activeLayout.leftSidebar, which
    // prevents the default WRITING_FOCUS layout (leftSidebar.visible=false) from collapsing
    // the left sidebar and hiding .nav-scene-row / .nav-story-row in E2E tests.
    rightSidebarVisible: true,
    notesTabUpgradeToastShown: true,
  };
}

function seedUserData(userData: string, vaultDir: string, waEnabled = true): void {
  const now = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'WA E2E Story',
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
                title: 'Lighthouse Scene',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  {
                    id: 'wa-e2e-block-0001',
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
              {
                id: EMPTY_SCENE_ID,
                title: 'Empty Scene',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${EMPTY_SCENE_ID}.md`,
                order: 1,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [],
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

  const sceneDir = path.join(
    vaultDir,
    `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes`,
  );
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    ['---', `id: ${SCENE_ID}`, 'title: "Lighthouse Scene"', `updatedAt: ${now}`, '---', '', SCENE_BODY, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(sceneDir, `${EMPTY_SCENE_ID}.md`),
    ['---', `id: ${EMPTY_SCENE_ID}`, 'title: "Empty Scene"', `updatedAt: ${now}`, '---', ''].join('\n'),
  );

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(buildAppSettings(waEnabled), null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir }, null, 2),
  );
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs =
    process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
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

// ─── IPC mock installer ────────────────────────────────────────────────────────


type MockTip = { id: string; text: string; category: string; sceneUpdatedAt?: string };

type MockOpts = {
  tips?: MockTip[];
  chatTokens?: string[];
  chatResponse?: string;
  scanDelayMs?: number;
  chatDelayMs?: number;
};

/**
 * Install all Writing Assistant IPC mocks in the main process.
 *
 * Tips include a fresh `sceneUpdatedAt` timestamp so that the component's
 * in-memory tip-suppression cache (keyed on `tipId:sceneUpdatedAt`) busts
 * between test calls to this function.
 */
async function installIpcMocks(app: ElectronApplication, opts: MockOpts = {}): Promise<void> {
  const freshTs = new Date().toISOString();

  const {
    tips = [
      {
        id: 'tip-e2e-01',
        text: 'Consider varying sentence length in paragraph two for better pacing.',
        category: 'pacing',
        sceneUpdatedAt: freshTs,
      },
      {
        id: 'tip-e2e-02',
        text: 'The phrase "relentless patience" works well — expand on this metaphor.',
        category: 'style',
        sceneUpdatedAt: freshTs,
      },
      {
        id: 'tip-e2e-03',
        text: 'Clarify the timeline: "twenty years" appears twice in close proximity.',
        category: 'clarity',
        sceneUpdatedAt: freshTs,
      },
    ],
    chatTokens = MOCK_CHAT_TOKENS,
    chatResponse = MOCK_CHAT_RESPONSE,
    scanDelayMs = 0,
    chatDelayMs = 40,
  } = opts;

  await app.evaluate(
    async (
      { ipcMain },
      args: {
        tips: MockTip[];
        chatTokens: string[];
        chatResponse: string;
        scannedAt: string;
        scanDelayMs: number;
        chatDelayMs: number;
      },
    ) => {
      const safeRemove = (ch: string) => {
        try {
          ipcMain.removeHandler(ch);
        } catch {
          /* not yet registered */
        }
      };

      // ── Scan channels ─────────────────────────────────────────────────────
      safeRemove('writing:scan');
      safeRemove('writing-assistant:scan-now');
      safeRemove('writing-assistant:cadence-change');
      safeRemove('writing-assistant:tip-decision');
      safeRemove('writing-assistant:set-active-scene');

      ipcMain.handle('writing:scan', async () => {
        if (args.scanDelayMs > 0)
          await new Promise<void>((r) => setTimeout(r, args.scanDelayMs));
        return { tips: args.tips, scannedAt: args.scannedAt };
      });
      ipcMain.handle('writing-assistant:scan-now', async () => {
        if (args.scanDelayMs > 0)
          await new Promise<void>((r) => setTimeout(r, args.scanDelayMs));
        return { tips: args.tips, scannedAt: args.scannedAt };
      });
      ipcMain.handle('writing-assistant:cadence-change', async () => ({ ok: true }));
      ipcMain.handle('writing-assistant:tip-decision', async () => ({ ok: true }));
      ipcMain.handle('writing-assistant:set-active-scene', async () => ({ ok: true }));

      // ── Chat channel ──────────────────────────────────────────────────────
      // F3#1 / N4-A: hub chat is MiniAgentChat → agentBrainstorm. WA composer deleted;
      // tips strip remains (Scan now / Hear on tip cards).
      safeRemove('agent:writing-assistant');
      safeRemove('agent:brainstorm');
      ipcMain.handle(
        'agent:writing-assistant',
        async (event) => {
          for (const token of args.chatTokens) {
            await new Promise<void>((r) => setTimeout(r, args.chatDelayMs));
            if (!event.sender.isDestroyed()) {
              event.sender.send('agent:writing-assistant:chunk', { chunk: token });
            }
          }
          return { text: args.chatResponse };
        },
      );
      ipcMain.handle('agent:brainstorm', async () => {
        if (args.chatDelayMs > 0)
          await new Promise<void>((r) => setTimeout(r, args.chatDelayMs * Math.max(1, args.chatTokens.length)));
        return { text: args.chatResponse };
      });

      // ── Voice / TTS channel ───────────────────────────────────────────────
      // Returns the speakId without emitting voice:speak:done so that
      // playingCardId state persists until the user explicitly clicks Stop.
      safeRemove('voice:speak');
      ipcMain.handle('voice:speak', async (_event, _payload: unknown) => ({
        speakId: `mock-speak-${Date.now()}`,
      }));
    },
    {
      tips,
      chatTokens,
      chatResponse,
      scannedAt: freshTs,
      scanDelayMs,
      chatDelayMs,
    },
  );
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

async function navigateToEditorView(page: Page): Promise<void> {
  // SKY-3097/3098: AppNavRail replaced the old TabBar; use aria-label navigation.
  // Mirrors the pattern in writing-assistant-tips.spec.ts.
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
}

/** Click a scene row in the StoryNavigator by its title. */
async function openScene(page: Page, sceneTitle: string): Promise<void> {
  await navigateToEditorView(page);

  // Wait for the story navigator to fully render before looking for the scene row.
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });

  const sceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

/**
 * Navigate to Editor → select the Lighthouse Scene → open the Writing Assistant panel.
 */
/**
 * F3 N4-A: partner hub mounts tips strip + MiniAgentChat by default.
 * Do NOT click Writer Scan — the action chip sits under/near the tips panel
 * and stays "not stable" under Playwright actionability checks.
 */
async function openWritingAssistantAgentRow(page: Page): Promise<void> {
  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 4_000 });
  await page.locator('[data-testid="ahp-tab-partner"]').click().catch(() => undefined);
  await expect(page.getByTestId('ahp-partner-view')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('ahp-writer-tips')).toBeVisible({ timeout: 8_000 });
}

async function openWritingAssistantWithScene(page: Page): Promise<void> {
  await openScene(page, 'Lighthouse Scene');
  await openWritingAssistantAgentRow(page);
  // Tips strip (always open) + shared partner MiniAgentChat.
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });
  await expect(page.getByTestId('ahp-partner-chat-input')).toBeVisible({ timeout: 8_000 });
}

async function openAssistantTab(page: Page): Promise<void> {
  await navigateToEditorView(page);
  await openWritingAssistantAgentRow(page);
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });
}

function assistantPrompt(page: Page) {
  // F3#1 — hub chat is the shared partner MiniAgentChat (not WA composer).
  return page.getByTestId('ahp-partner-chat-input');
}

async function fillAssistantPrompt(page: Page, text: string) {
  const input = assistantPrompt(page);
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeEnabled({ timeout: 5_000 });
  // The panel is never unmounted between tests (SKY-9022/M6), so a prior
  // test's in-flight streaming/TTS cleanup can still land a render right as
  // this fill lands, clobbering the value once. Re-running fill+assert as a
  // unit (instead of a single-shot fill -> toHaveValue) self-heals from that
  // one-off clobber instead of racing it. SKY-10069.
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 500 });
  }).toPass({ timeout: 5_000 });
  return input;
}

async function submitAssistantPrompt(page: Page, text: string) {
  const input = await fillAssistantPrompt(page, text);
  await input.press('Enter');
  // Same race as fillAssistantPrompt, one step later: a stray re-render from a
  // prior test's streaming/TTS cleanup can swallow the Enter keypress before
  // the submit handler consumes it. If the input still holds the text the
  // submit never happened — press Enter again; if it was consumed, just keep
  // waiting for the bubble (re-pressing on an empty input is a no-op, so this
  // never double-submits). SKY-10152.
  const userBubble = page.locator('.trp-bubble--user', { hasText: text }).last();
  await expect(async () => {
    if (!(await userBubble.isVisible()) && (await input.inputValue()) === text) {
      await input.press('Enter');
    }
    await expect(userBubble).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

// ─── Module-level state ───────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

// ─── Lifecycle ────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa-vault-'));
  seedUserData(userData, vaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);

  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await installIpcMocks(app);
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

// ════════════════════════════════════════════════════════════════════════════
// HEARTBEAT SCAN SUITE
// ════════════════════════════════════════════════════════════════════════════

// ─── TC-WA-07: Spinner visible during scan ───────────────────────────────────
//
// AC-WA-07: "Spinner (.wa-spinner) is visible while a scan is in-flight."
// Confirmed with a 600 ms scan delay so the assertion runs before the mock returns.

test('TC-WA-07: spinner visible during scan', async () => {
  await installIpcMocks(app!, { scanDelayMs: 600 });
  await openWritingAssistantWithScene(page);

  await page.getByTestId('wa-scan-now').click({ force: true });

  // Spinner must appear while the scan is in-flight (check DOM presence, not visibility).
  await expect(page.locator('.wa-spinner')).toHaveCount(1, { timeout: 3_000 });

  // After the scan completes, spinner is removed from DOM and tips are rendered.
  await expect(page.locator('.wa-spinner')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('.wa-heartbeat-tip')).toHaveCount(3, { timeout: 5_000 });

  // Reset to no-delay mock for subsequent tests.
  await installIpcMocks(app!);
});

// ─── TC-WA-04: Empty scene shows empty-state message ─────────────────────────
//
// AC-WA-04: "When a scene has no prose, the heartbeat panel shows the
// 'No heartbeat tips yet.' empty-state message and the spinner is never shown."

test('TC-WA-04: empty scene shows empty-state message', async () => {
  await installIpcMocks(app!, { tips: [] });

  // Navigate to the empty scene.
  await openScene(page, 'Empty Scene');
  await openAssistantTab(page);

  // Scan Now — the scheduler guard returns early on empty prose.
  await page.getByTestId('wa-scan-now').click({ force: true });

  // Spinner should not appear (or disappear immediately) — empty prose short-circuits (check DOM count).
  await expect(page.locator('.wa-spinner')).toHaveCount(0, { timeout: 3_000 });

  // Empty state must be visible.
  const emptyMsg = page.locator('.wa-heartbeat-empty');
  await expect(emptyMsg).toBeVisible({ timeout: 3_000 });
  await expect(emptyMsg).toContainText(/no heartbeat tips/i);

  await installIpcMocks(app!);
});

// ─── TC-WA-03: Manual cadence — Scan Now is the only trigger ─────────────────
//
// AC-WA-03: "With cadence = 'manual', no automatic scans fire; the Scan Now
// button remains the only way to trigger a scan."

test('TC-WA-03: manual cadence — Scan Now is the only trigger', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  // Switch cadence to Manual only.
  const cadenceSelect = page.locator('.wa-cadence-select');
  await expect(cadenceSelect).toBeVisible({ timeout: 5_000 });
  await cadenceSelect.selectOption('manual');
  await expect(cadenceSelect).toHaveValue('manual');

  // Scan Now is still visible and enabled.
  const scanBtn = page.getByTestId('wa-scan-now');
  await expect(scanBtn).toBeVisible();
  await expect(scanBtn).toBeEnabled();

  // Clicking Scan Now manually loads tips.
  await scanBtn.click({ force: true });
  await expect(page.locator('.wa-heartbeat-tip')).toHaveCount(3, { timeout: 8_000 });

  // Reset cadence.
  await cadenceSelect.selectOption('60');
});

// ─── TC-WA-01: On-save scan fires on scene:saved event ───────────────────────
//
// AC-WA-01: "With cadence = 'on-save', a scan fires within 2 s of a scene:saved
// event and the spinner is visible during the scan."

test('TC-WA-01: on-save scan fires when scene:saved event is dispatched', async () => {
  await installIpcMocks(app!, { scanDelayMs: 400 });
  await openWritingAssistantWithScene(page);

  // Switch cadence to On save.
  const cadenceSelect = page.locator('.wa-cadence-select');
  await cadenceSelect.selectOption('on-save');

  // Dispatch the synthetic scene:saved DOM event to simulate a file save.
  await page.evaluate(() => window.dispatchEvent(new Event('scene:saved')));

  // Spinner must appear within 2 s of the save event (check DOM presence, not visibility).
  await expect(page.locator('.wa-spinner')).toHaveCount(1, { timeout: 2_000 });

  // Scan completes — spinner is removed from DOM and tips appear.
  await expect(page.locator('.wa-spinner')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('.wa-heartbeat-tip')).toHaveCount(3, { timeout: 5_000 });

  // Reset.
  await cadenceSelect.selectOption('60');
  await installIpcMocks(app!);
});

// ─── TC-WA-05: Tip actions (Note / Ignore) dismiss tips from UI ───────────────
//
// AC-WA-05: "Note, Ignore, and Report tip actions dismiss the tip from the
// visible list and call the writing-assistant:tip-decision IPC."

test('TC-WA-05: Note and Ignore tip actions dismiss tips from UI', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  // Load tips.
  await page.getByTestId('wa-scan-now').click({ force: true });
  const tips = page.locator('.wa-heartbeat-tip');
  await expect(tips).toHaveCount(3, { timeout: 8_000 });

  // Click "Note" on the first tip — it must disappear.
  await page.locator('.tc-btn-note').first().click();
  await expect(tips).toHaveCount(2, { timeout: 3_000 });

  // Click "Ignore" on the now-first tip — it must disappear.
  await page.locator('.tc-btn-ignore').first().click();
  await expect(tips).toHaveCount(1, { timeout: 3_000 });
});

// ─── TC-WA-08: Dismiss-all button appears with >= 2 tips ─────────────────────
//
// AC-WA-08: "A 'Dismiss all' button appears when there are 2 or more visible
// tips and dismisses all of them when clicked."

test('TC-WA-08: dismiss-all button appears with >= 2 tips and clears all', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  // Load 3 fresh tips.
  await page.getByTestId('wa-scan-now').click({ force: true });
  await expect(page.locator('.wa-heartbeat-tip')).toHaveCount(3, { timeout: 8_000 });

  // Dismiss-all must be visible.
  const dismissAll = page.locator('.tc-dismiss-all');
  await expect(dismissAll).toBeVisible({ timeout: 3_000 });
  await expect(dismissAll).toContainText(/dismiss all/i);

  // Dismiss all — list clears and button disappears.
  await dismissAll.click();
  await expect(page.locator('.wa-heartbeat-tip')).toHaveCount(0, { timeout: 3_000 });
  await expect(dismissAll).not.toBeVisible({ timeout: 3_000 });
});

// ════════════════════════════════════════════════════════════════════════════
// CHAT SUITE
// ════════════════════════════════════════════════════════════════════════════

// ─── TC-WA-09: Enter submits; empty prompt is no-op ──────────────────────────
//
// AC-WA-09: "Enter submits the prompt. An empty prompt is a no-op — the Ask
// button is disabled and no messages are added."

test('TC-WA-09: Enter submits; empty prompt is no-op', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  // F3#1 — partner MiniAgentChat is the hub composer.
  const input = assistantPrompt(page);
  const sendBtn = page.getByTestId('ahp-partner-chat-send');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeEnabled({ timeout: 5_000 });

  await input.fill('');
  await expect(sendBtn).toBeDisabled();

  const before = await page.locator('.trp-bubble').count();
  await input.press('Enter');
  await page.waitForTimeout(1_000);
  await expect(page.locator('.trp-bubble')).toHaveCount(before);

  await input.fill('Help me improve this scene.');
  await expect(sendBtn).toBeEnabled();
  await input.press('Enter');

  await expect(page.locator('.trp-bubble--user', {
    hasText: 'Help me improve this scene.',
  })).toBeVisible({ timeout: 3_000 });

  await expect(page.locator('.trp-bubble--agent').last()).toContainText(
    MOCK_CHAT_RESPONSE,
    { timeout: 10_000 },
  );
});

// ─── TC-WA-10: Streaming cursor glyph is visible ─────────────────────────────
//
// AC-WA-10: "The streaming cursor (▌, .wa-cursor) is visible while the assistant
// is generating a response and disappears when the stream ends."

// F3 N4-A: shared partner MiniAgentChat — typing dots stand in for the old WA cursor.
test('TC-WA-10: streaming cursor appears during response streaming', async () => {
  await installIpcMocks(app!, { chatDelayMs: 200 });
  await openWritingAssistantWithScene(page);

  await submitAssistantPrompt(page, 'Give me pacing advice.');

  await expect(page.getByTestId('ahp-partner-typing')).toBeVisible({ timeout: 6_000 });
  await expect(page.getByTestId('ahp-partner-typing')).not.toBeVisible({ timeout: 12_000 });
  await expect(page.locator('.trp-bubble--agent').last()).toContainText(
    MOCK_CHAT_RESPONSE,
    { timeout: 5_000 },
  );

  await installIpcMocks(app!);
});

// ─── TC-WA-13: Cancel replaces Send during streaming ─────────────────────────

test('TC-WA-13: Cancel button visible during streaming; Ask returns after cancel', async () => {
  await installIpcMocks(app!, { chatDelayMs: 500 });
  await openWritingAssistantWithScene(page);

  await submitAssistantPrompt(page, 'Describe the mood of this scene.');

  const cancelBtn = page.getByTestId('ahp-partner-chat-cancel');
  await expect(cancelBtn).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('ahp-partner-chat-send')).not.toBeVisible();

  await cancelBtn.click();
  await expect(page.getByTestId('ahp-partner-chat-send')).toBeVisible({ timeout: 5_000 });
  await expect(cancelBtn).not.toBeVisible({ timeout: 3_000 });

  await installIpcMocks(app!);
});

// ─── TC-WA-11: Stall panel on shared partner chat ────────────────────────────

test('TC-WA-11: stall panel appears after stall (E2E-fast timer override)', async () => {
  await page.evaluate(() => {
    (window as unknown as { __MYTHOS_E2E_TIMERS__?: Record<string, number> }).__MYTHOS_E2E_TIMERS__ = {
      stallWarningMs: 300,
      hardTimeoutMs: 5_000,
    };
  });

  await app!.evaluate(async ({ ipcMain }) => {
    try { ipcMain.removeHandler('agent:brainstorm'); } catch { /* skip */ }
    ipcMain.handle('agent:brainstorm', () => new Promise<never>(() => undefined));
  });

  await openWritingAssistantWithScene(page);
  await fillAssistantPrompt(page, 'Stall test.');
  await page.getByTestId('ahp-partner-chat-input').press('Enter');

  await expect(page.getByTestId('ahp-partner-stall-panel')).toBeVisible({ timeout: 3_000 });
  await expect(page.getByTestId('ahp-partner-stall-cancel')).toBeVisible();

  await page.getByTestId('ahp-partner-stall-cancel').click();

  await page.evaluate(() => {
    delete (window as unknown as { __MYTHOS_E2E_TIMERS__?: Record<string, number> }).__MYTHOS_E2E_TIMERS__;
  });
  await installIpcMocks(app!);
});

// ════════════════════════════════════════════════════════════════════════════
// VOICE TTS SUITE
// ════════════════════════════════════════════════════════════════════════════

// ─── TC-WA-22: Mute toggle flips aria-pressed ────────────────────────────────
//
// AC-WA-22: "The session mute button (.wa-mute-btn) flips aria-pressed and
// its label on each click."

test('TC-WA-22: Mute toggle flips aria-pressed and label', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  const muteBtn = page.locator('.wa-mute-btn');
  await expect(muteBtn).toBeVisible({ timeout: 5_000 });

  const initialPressed = await muteBtn.getAttribute('aria-pressed');
  const initialLabel = await muteBtn.getAttribute('aria-label');
  expect(initialLabel).toMatch(/mute|unmute/i);

  // Toggle on.
  await muteBtn.click();
  const afterFirst = await muteBtn.getAttribute('aria-pressed');
  expect(afterFirst).not.toBe(initialPressed);
  expect(await muteBtn.getAttribute('aria-label')).not.toBe(initialLabel);

  // Toggle off (reset).
  await muteBtn.click();
  expect(await muteBtn.getAttribute('aria-pressed')).toBe(initialPressed);
  expect(await muteBtn.getAttribute('aria-label')).toBe(initialLabel);
});

// ─── TC-WA-23: Hear button plays; Stop cancels ───────────────────────────────
//
// AC-WA-23: "Clicking Hear sets aria-pressed=true and changes the label to
// 'Stop voice playback'. Clicking Stop resets the button to its idle state."

// F3 N4-A: Hear lives on tip cards in the tips strip (composer deleted).
test('TC-WA-23: Hear button plays and Stop cancels TTS', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  await expect(page.locator('[aria-label="Heartbeat panel"]')).toBeVisible({ timeout: 8_000 });
  await page.getByTestId('wa-scan-now').click({ force: true });
  await expect(page.locator('.wa-heartbeat-tip').first()).toBeVisible({ timeout: 8_000 });

  const hearBtn = page.locator('.wa-hear-btn').first();
  await expect(hearBtn).toBeVisible({ timeout: 8_000 });
  await expect(hearBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(hearBtn).toHaveAttribute('aria-label', 'Hear suggestion aloud');

  await hearBtn.click();
  await expect(hearBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });
  await expect(hearBtn).toHaveAttribute('aria-label', 'Stop voice playback');

  await hearBtn.click();
  await expect(hearBtn).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
  await expect(hearBtn).toHaveAttribute('aria-label', 'Hear suggestion aloud');
});

// ─── TC-WA-24: Starting a second tip Hear cancels the first ──────────────────

test('TC-WA-24: starting second Hear cancels first card playback', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  await expect(page.locator('[aria-label="Heartbeat panel"]')).toBeVisible({ timeout: 8_000 });
  await page.getByTestId('wa-scan-now').click({ force: true });
  await expect(page.locator('.wa-heartbeat-tip')).toHaveCount(3, { timeout: 8_000 });

  const hearBtns = page.locator('.wa-hear-btn');
  await expect(hearBtns).toHaveCount(3, { timeout: 5_000 });

  const firstHear = hearBtns.nth(0);
  await firstHear.click();
  await expect(firstHear).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

  const secondHear = hearBtns.nth(1);
  await secondHear.click();
  await expect(firstHear).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
  await expect(secondHear).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

  await secondHear.click();
  await expect(secondHear).toHaveAttribute('aria-pressed', 'false', { timeout: 3_000 });
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS SUITE
// ════════════════════════════════════════════════════════════════════════════

// ─── TC-WA-27: Cadence select fires IPC and UI updates immediately ────────────
//
// AC-WA-27: "Selecting a different cadence option updates the select UI and
// fires the writing-assistant:cadence-change IPC with the new value."

test('TC-WA-27: Cadence select fires IPC and reflects new value', async () => {
  await installIpcMocks(app!);
  await openWritingAssistantWithScene(page);

  const cadenceSelect = page.locator('.wa-cadence-select');
  await expect(cadenceSelect).toBeVisible({ timeout: 5_000 });

  // Change to 5 min.
  await cadenceSelect.selectOption('300');
  await expect(cadenceSelect).toHaveValue('300');

  // Change to On save.
  await cadenceSelect.selectOption('on-save');
  await expect(cadenceSelect).toHaveValue('on-save');

  // Reset to 1 min default.
  await cadenceSelect.selectOption('60');
  await expect(cadenceSelect).toHaveValue('60');
});

// ════════════════════════════════════════════════════════════════════════════
// DISABLED STATE SUITE (AC-WA-26) — separate app instance with waEnabled=false
// ════════════════════════════════════════════════════════════════════════════

test.describe('AC-WA-26: Writing Assistant disabled state', () => {
  let disabledApp: ElectronApplication | undefined;
  let disabledPage: Page;
  let disabledUserData: string;
  let disabledVaultDir: string;

  test.beforeAll(async () => {
    disabledUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa-dis-'));
    disabledVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa-dis-vault-'));
    seedUserData(disabledUserData, disabledVaultDir, /* waEnabled */ false);

    disabledApp = await launchApp(disabledUserData);
    disabledPage = await firstWindow(disabledApp);
    await expect(disabledPage.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  });

  test.afterAll(async () => {
    const proc = disabledApp?.process();
    await Promise.race([
      disabledApp?.close().catch(() => undefined) ?? Promise.resolve(),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch {
      /* already exited */
    }
    fs.rmSync(disabledUserData, { recursive: true, force: true });
    fs.rmSync(disabledVaultDir, { recursive: true, force: true });
  });

  // ─── TC-WA-26: disabled → shows disabled message, no scan UI ─────────────
  //
  // AC-WA-26: "When Writing Assistant is disabled in app-settings, the panel
  // renders a 'Writing Assistant is disabled' message; scan and chat UI are
  // absent; no scans fire automatically."

  test('TC-WA-26: disabled WA shows disabled message and hides scan/chat UI', async () => {
    // Navigate to Editor and expand the Writing Assistant panel in the GRS.
    const editorMenu = disabledPage.locator('.app-menu-view-btn', { hasText: 'Editor' });
    if (await editorMenu.count()) {
      await editorMenu.click();
    } else {
      // M4: module-mirror workspace tabs are gone — navigate via the nav rail,
      // and only when Story isn't already the active section (re-clicking the
      // active item opens the stories switcher popover once M3 lands).
      const railStory = disabledPage
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: /^Story( Writer)?$/ });
      if ((await railStory.getAttribute('aria-current').catch(() => null)) !== 'page') {
        await railStory.click();
      }
    }
    // GlobalRightSidebar uses role="button" panel headers instead of role="tab".
    const showSidebarBtn = disabledPage.getByRole('button', { name: 'Show right sidebar' });
    if (await showSidebarBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await showSidebarBtn.click();
    }
    await openWritingAssistantAgentRow(disabledPage);

    // Panel renders in disabled state.
    const disabledPanel = disabledPage.locator('.writing-assistant-disabled');
    await expect(disabledPanel).toBeVisible({ timeout: 8_000 });

    const disabledMsg = disabledPage.locator('.writing-assistant-disabled-msg');
    await expect(disabledMsg).toBeVisible();
    await expect(disabledMsg).toContainText(/disabled/i);

    // No scan or chat UI must be visible.
    await expect(disabledPage.locator('.wa-scan-now')).not.toBeVisible();
    await expect(disabledPage.locator('.writing-assistant-input')).not.toBeVisible();
    await expect(disabledPage.locator('.wa-heartbeat-tips')).not.toBeVisible();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS PERSISTENCE SUITE (AC-WA-27, real IPC — no mocks) — SKY-8446
// ════════════════════════════════════════════════════════════════════════════
//
// The main suite above mocks `writing-assistant:cadence-change` in
// installIpcMocks() (returns `{ ok: true }` unconditionally) so the cadence
// tests there only assert UI state, never that the write actually reaches
// disk. This suite runs its own app instance with NO IPC mocks installed, so
// the cadence select hits the real main-process handler
// (handleCadenceChange → window.api.writingAssistantCadenceChange →
// WRITING_ASSISTANT_CADENCE_CHANGE → saveAppSettings → fs.writeFileSync), and
// asserts the persisted value on disk.

test.describe('AC-WA-27: Writing Coach cadence persists to disk (real IPC)', () => {
  let persistApp: ElectronApplication | undefined;
  let persistPage: Page;
  let persistUserData: string;
  let persistVaultDir: string;

  test.beforeAll(async () => {
    persistUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa-persist-'));
    persistVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wa-persist-vault-'));
    seedUserData(persistUserData, persistVaultDir);

    persistApp = await launchApp(persistUserData);
    persistPage = await firstWindow(persistApp);
    await expect(persistPage.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    // Intentionally no installIpcMocks() call — writing-assistant:cadence-change
    // must stay wired to the real handler for this suite.
  });

  test.afterAll(async () => {
    const proc = persistApp?.process();
    await Promise.race([
      persistApp?.close().catch(() => undefined) ?? Promise.resolve(),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch {
      /* already exited */
    }
    fs.rmSync(persistUserData, { recursive: true, force: true });
    fs.rmSync(persistVaultDir, { recursive: true, force: true });
  });

  test('TC-WA-27-disk: numeric cadence writes agents.writingAssistant.scanIntervalSeconds to app-settings.json', async () => {
    await openWritingAssistantWithScene(persistPage);

    const cadenceSelect = persistPage.locator('.wa-cadence-select');
    await expect(cadenceSelect).toBeVisible({ timeout: 5_000 });

    await cadenceSelect.selectOption('300');
    await expect(cadenceSelect).toHaveValue('300');

    const stored = JSON.parse(
      fs.readFileSync(path.join(persistUserData, 'app-settings.json'), 'utf-8'),
    ) as { agents?: { writingAssistant?: { scanIntervalSeconds?: number } } };
    expect(stored.agents?.writingAssistant?.scanIntervalSeconds).toBe(300);
  });

  test('TC-WA-27-disk-2: on-save cadence writes top-level waScanInterval to app-settings.json', async () => {
    const cadenceSelect = persistPage.locator('.wa-cadence-select');
    await cadenceSelect.selectOption('on-save');
    await expect(cadenceSelect).toHaveValue('on-save');

    const stored = JSON.parse(
      fs.readFileSync(path.join(persistUserData, 'app-settings.json'), 'utf-8'),
    ) as { waScanInterval?: string };
    expect(stored.waScanInterval).toBe('on-save');
  });
});
