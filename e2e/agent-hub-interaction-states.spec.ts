/**
 * agent-hub-interaction-states.spec.ts — SKY-8436
 *
 * Real-Electron E2E for the M15 Agent Hub / Suggestion Inbox gap-spec
 * (docs/AGENT-HUB-SUGGESTION-INBOX-GAP-SPEC.md). Covers the DoD-required
 * empty/loading/error triad plus the keyboard/focus-return flow, crossing
 * the UI→IPC seam (real `suggestions:*` / `agent:writing-assistant` IPC
 * handlers, not mocked React state).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/agent-hub-interaction-states.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'ahp-e2e-story-0001';
const CHAPTER_ID = 'ahp-e2e-chapter-0001';
const SCENE_ID = 'ahp-e2e-scene-0001';

function buildAppSettings(): object {
  return {
    apiKey: 'sk-ant-e2e-agent-hub',
    onboardingComplete: true,
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
    },
    theme: 'dark',
    rightSidebarVisible: true,
    // Wide enough that WritingAssistantPanel's own AC-WA-20 280px collapse
    // never kicks in — this suite is about the hub's OWN interaction states,
    // not that (separately spec'd, separately shipped) collapse behavior.
    rightSidebarWidth: 420,
    notesTabUpgradeToastShown: true,
  };
}

function seedUserData(userData: string, vaultDir: string): void {
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'Agent Hub E2E Story',
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
    ['---', `id: ${SCENE_ID}`, 'title: "Lighthouse Scene"', `updatedAt: ${now}`, '---', '', 'The lighthouse beam swept the bay.', ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(buildAppSettings(), null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

/** Replace the coach chat IPC handler in the main process (real IPC seam). */
async function mockCoachChatIpc(
  app: ElectronApplication,
  impl: 'succeed' | 'fail' | 'delay',
): Promise<void> {
  await app.evaluate(({ ipcMain }, mode) => {
    try { ipcMain.removeHandler('agent:writing-assistant'); } catch { /* not registered */ }
    if (mode === 'fail') {
      ipcMain.handle('agent:writing-assistant', async () => {
        throw new Error('Network error — check your connection and try again.');
      });
    } else if (mode === 'delay') {
      ipcMain.handle('agent:writing-assistant', async () => {
        await new Promise((r) => setTimeout(r, 900));
        return { text: 'Delayed coach reply.' };
      });
    } else {
      ipcMain.handle('agent:writing-assistant', async () => ({ text: 'Coach reply.' }));
    }
  }, impl);
}

async function openScene(page: Page, sceneTitle: string): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

/** Opens the right-panel Agent Hub's AGENTS list (backs out of chat if needed). */
async function openAgentsHub(page: Page): Promise<void> {
  // A previous test may have left AC-WA-20's mini-chat overlay open — its
  // backdrop intercepts every subsequent click until dismissed (AC-WA-22).
  if (await page.locator('.wa-overlay-backdrop').isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
  }
  const backBtn = page.locator('.ahp-back-btn');
  if (await backBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await backBtn.click();
  }
  await expect(page.locator('[data-testid="ahp-agent-row-writing-assistant"]')).toBeVisible({ timeout: 8_000 });
}

/** Opens the Writing Coach mini-chat from the AGENTS list, expanding it out
 *  of AC-WA-20's collapsed (icon-only) state if the panel is under 280px. */
/** AC-WA-20's ResizeObserver can flip the mini-chat to its collapsed
 *  (icon-only) state at any point shortly after mount — race the two
 *  possible outcomes instead of a single point-in-time check, clicking the
 *  expand affordance whenever it shows up, until `target` becomes visible. */
async function settleIntoView(page: Page, target: ReturnType<Page['locator']>): Promise<void> {
  const collapsedBtn = page.locator('.wa-collapsed-btn');
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await target.isVisible({ timeout: 250 }).catch(() => false)) break;
    if (await collapsedBtn.isVisible({ timeout: 250 }).catch(() => false)) {
      await collapsedBtn.click().catch(() => undefined);
    }
  }
  await expect(target).toBeVisible({ timeout: 8_000 });
  // Let layout fully settle before interacting — right after the
  // collapsed→overlay transition, another resize tick can still land.
  await page.waitForTimeout(300);
}

async function openWritingCoachChat(page: Page): Promise<void> {
  await page.locator('[aria-label^="Open Writing Coach chat"]').click();
  await settleIntoView(page, page.locator('[aria-label="Writing coach prompt"]'));
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ahp-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ahp-vault-'));
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

test.describe.configure({ mode: 'serial' });

// ── Empty state ──────────────────────────────────────────────────────────────

test('empty state: Suggestions card shows the gap-spec copy with zero pending suggestions', async () => {
  await openScene(page, 'Lighthouse Scene');
  await openAgentsHub(page);

  // Real IPC round-trip: window.api.suggestionsUnifiedList() against an
  // empty vault-backed DB — not a mocked React state.
  await expect(page.locator('.ahp-suggestion-empty')).toHaveText(
    "No suggestions right now — the team's watching.",
    { timeout: 8_000 },
  );
});

// ── Loading state ────────────────────────────────────────────────────────────

test('loading state: typing-dots appear while the coach reply is in flight, then resolve to the reply', async () => {
  await mockCoachChatIpc(app!, 'delay');
  await openAgentsHub(page);
  await openWritingCoachChat(page);

  const input = page.locator('[aria-label="Writing coach prompt"]');
  await input.fill('How can I raise the tension here?');
  await input.press('Enter');

  // Typing-dots show before the delayed IPC handler resolves.
  await expect(page.locator('[data-testid="wa-typing"]')).toBeVisible({ timeout: 3_000 });

  // ...then the real reply lands and the indicator is gone.
  await expect(page.locator('.wa-assistant-bubble', { hasText: 'Delayed coach reply.' }))
    .toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="wa-typing"]')).not.toBeAttached();
});

// ── Error state ──────────────────────────────────────────────────────────────

test('error state: a failed chat request keeps the user message, shows an inline error + Retry, and Retry recovers', async () => {
  await mockCoachChatIpc(app!, 'fail');
  await openAgentsHub(page);
  await openWritingCoachChat(page);

  const input = page.locator('[aria-label="Writing coach prompt"]');
  await input.fill('Give me feedback on the pacing');
  await input.press('Enter');

  // Real IPC rejection surfaces as the §3 inline error row (icon + text + Retry),
  // and the user's message is never rolled back.
  await expect(page.locator('.writing-assistant-error')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.wa-error-text')).toContainText(/network error/i);
  await expect(page.locator('.wa-user-bubble', { hasText: 'Give me feedback on the pacing' }))
    .toBeVisible();

  // Fix the handler, then Retry re-sends the SAME message without duplicating it.
  await mockCoachChatIpc(app!, 'succeed');
  await page.locator('.wa-error-retry-btn').click();

  await expect(page.locator('.wa-assistant-text').filter({ hasText: /^Coach reply\.$/ })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.writing-assistant-error')).not.toBeVisible();
  await expect(page.locator('.wa-user-bubble', { hasText: 'Give me feedback on the pacing' })).toHaveCount(1);
});

// ── Keyboard nav + focus-return ──────────────────────────────────────────────

test('keyboard: Enter opens the Writing Coach chat from a focused AGENTS row, and Back returns focus to that row', async () => {
  await mockCoachChatIpc(app!, 'succeed');
  await openAgentsHub(page);

  const agentRow = page.locator('[data-testid="ahp-agent-row-writing-assistant"]');
  await agentRow.focus();
  await page.keyboard.press('Enter');

  await settleIntoView(page, page.locator('.ahp-back-btn'));

  // Back button is the first focusable element inside the chat view (§4).
  const backBtn = page.locator('.ahp-back-btn');
  await expect(backBtn).toBeVisible();
  await backBtn.click();

  // Focus lands back on the AGENTS row just exited — not the top of the panel.
  await expect(page.locator('[data-testid="ahp-agent-row-writing-assistant"]')).toBeFocused({ timeout: 3_000 });
});

// ── Regression guard ─────────────────────────────────────────────────────────
//
// `.wa-panel-root` previously had `display: contents` (AC-WA-20), which
// strips an element's own box — the SAME element AC-WA-20's ResizeObserver
// measures for its 280px collapse check. That made the observer always read
// 0×0 and collapse the mini-chat permanently on every real (non-jsdom)
// render, undetected because no prior test exercised real Chromium layout
// here. Guards against a re-introduction of `display: contents` (or any
// other zero-box rule) on that element. Runs last: it just opens the chat
// and doesn't need any of the earlier tests' mock/session state.

test('regression guard: the Writing Coach mini-chat does not permanently collapse at a normal panel width', async () => {
  await mockCoachChatIpc(app!, 'succeed');
  await openAgentsHub(page);
  await openWritingCoachChat(page);

  await expect(page.locator('.wa-collapsed-btn')).not.toBeVisible();
  const width = await page.locator('.wa-panel-root').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(280);
});
