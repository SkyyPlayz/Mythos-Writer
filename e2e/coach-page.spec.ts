/**
 * coach-page.spec.ts — Beta 4 M12 (§5.2, §14.6) + M13 (§5.4, §14.7)
 *
 * E2E tests for the Writing Coach page (Story → Coach sub-tab):
 *   - header (Writing Coach, never-ghost-writes sub, skill chips)
 *   - chat send → coach bubble in the 760px feed
 *   - suggestions right rail (SUGGESTIONS eyebrow, collapsible General group)
 *   - ONE conversation store: a message sent on the Coach page shows up in the
 *     right-panel Writing Coach chat (and vice versa) — §14.6 clause 6.
 *   - M13 Scene Analysis: `View Full Analysis` (right-panel card) opens the
 *     Coach page with COMPUTED vs COACH'S READ sections (§14.7), and the
 *     computed section still renders when AI is unavailable.
 *
 * The Anthropic chat IPC is mocked in the main process; no network access.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/coach-page.spec.ts --reporter=list
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

const STORY_ID = 'coach-e2e-story-0001';
const CHAPTER_ID = 'coach-e2e-chapter-0001';
const SCENE_ID = 'coach-e2e-scene-0001';

const MOCK_COACH_RESPONSE = 'Lesson: your opening anchors place well — move the danger up one paragraph.';

function buildAppSettings(): object {
  return {
    apiKey: 'sk-ant-e2e-coach-page',
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
        title: 'Coach E2E Story',
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
                title: 'Harbor Scene',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  { id: 'coach-e2e-block-0001', type: 'prose', content: 'The harbor slept under a skin of fog.', order: 0, updatedAt: now },
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
    ['---', `id: ${SCENE_ID}`, 'title: "Harbor Scene"', `updatedAt: ${now}`, '---', '', 'The harbor slept under a skin of fog.', ''].join('\n'),
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

/** Replace the coach chat IPC with a deterministic mock (no network). */
async function installCoachChatMock(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, args) => {
    try { ipcMain.removeHandler('agent:writing-assistant'); } catch { /* not registered */ }
    ipcMain.handle('agent:writing-assistant', async () => ({ text: args.response }));
  }, { response: MOCK_COACH_RESPONSE });
}

async function openCoachPage(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-coach"]').click();
  await expect(page.locator('[data-testid="coach-page"]')).toBeVisible({ timeout: 8_000 });
}

/** M13: open the seeded scene in the editor (mirrors writing-assistant.spec.ts). */
async function openScene(page: Page, sceneTitle: string): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

/** M13: surface the agent hub's Scene Analysis card in the right panel. */
async function openSceneAnalysisCard(page: Page): Promise<void> {
  const waHeader = page.getByRole('button', { name: 'Writing Coach panel' });
  if ((await waHeader.getAttribute('aria-expanded')) !== 'true') {
    await waHeader.click();
  }
  // A previous test may have left the hub inside an agent chat view.
  const backBtn = page.locator('.ahp-back-btn');
  if (await backBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await backBtn.click();
  }
  await expect(page.locator('[data-testid="view-full-analysis"]')).toBeVisible({ timeout: 8_000 });
}

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-coach-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-coach-vault-'));
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await installCoachChatMock(app);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

test.describe.configure({ mode: 'serial' });

test('M12: Coach sub-tab renders the Writing Coach page per §5.2', async () => {
  await openCoachPage(page);

  // Header: title + agent-contract sub-line
  await expect(page.locator('.coach-title')).toHaveText('Writing Coach');
  await expect(page.locator('.coach-sub')).toContainText('never ghost-writes');

  // 3 skill chips
  await expect(page.locator('.coach-skill-chip')).toHaveCount(3);

  // Chips row (4 prompts), input, gradient send, footer contract line
  await expect(page.locator('.coach-chip')).toHaveCount(4);
  await expect(page.locator('[data-testid="coach-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="coach-send"]')).toBeVisible();
  await expect(page.locator('.coach-footer')).toContainText('your coach never writes prose for you');

  // Right rail: SUGGESTIONS eyebrow + collapsible General + per-chapter group,
  // current chapter marked.
  const rail = page.locator('[data-testid="coach-suggestions-rail"]');
  await expect(rail).toBeVisible();
  await expect(rail.locator('.coach-rail-eyebrow')).toHaveText('SUGGESTIONS');
  await expect(rail.locator('.coach-rail-group-label').first()).toHaveText('General');
});

test('M12: sending a prompt renders user bubble then coach reply in the feed', async () => {
  await openCoachPage(page);

  const input = page.locator('[data-testid="coach-input"]');
  await input.fill('Teach me pacing with my own text please');
  await input.press('Enter');

  // Optimistic user bubble
  await expect(page.locator('.coach-bubble--user', { hasText: 'Teach me pacing with my own text please' }).last())
    .toBeVisible({ timeout: 5_000 });

  // Coach reply lands in the feed once persisted to the session store
  await expect(page.locator('.coach-bubble--coach', { hasText: MOCK_COACH_RESPONSE }).last())
    .toBeVisible({ timeout: 10_000 });
});

test('M12 §14.6: Coach page and right-panel Coach chat share ONE conversation', async () => {
  await openCoachPage(page);

  // Open the right-panel agent hub → Writing Coach chat
  const waHeader = page.getByRole('button', { name: 'Writing Coach panel' });
  if ((await waHeader.getAttribute('aria-expanded')) !== 'true') {
    await waHeader.click();
  }
  const agentRow = page.locator('[aria-label="Open Writing Coach chat"]');
  if (await agentRow.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await agentRow.click();
  }
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });

  // The exchange sent from the COACH PAGE is visible in the PANEL chat.
  await expect(page.locator('.wa-user-bubble', { hasText: 'Teach me pacing with my own text please' }).last())
    .toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.wa-assistant-bubble', { hasText: MOCK_COACH_RESPONSE }).last())
    .toBeVisible({ timeout: 8_000 });
});

// ── M13 — Scene Analysis (§5.4, §14.7) ──────────────────────────────────────

test('M13 acceptance: with AI failing, View Full Analysis still lands a computed-only card', async () => {
  // Simulate AI unavailable: the coach agent IPC rejects every call.
  await app!.evaluate(({ ipcMain }) => {
    try { ipcMain.removeHandler('agent:writing-assistant'); } catch { /* not registered */ }
    ipcMain.handle('agent:writing-assistant', async () => {
      throw new Error('Writing Coach is disabled in settings.');
    });
  });

  await openScene(page, 'Harbor Scene');
  await openSceneAnalysisCard(page);

  // The right-panel card computes its values locally — no AI involved.
  const rows = page.locator('[data-testid="scene-analysis-rows"]');
  await expect(rows).toContainText('Word Count');
  await expect(rows).toContainText('Read Time');
  await expect(rows).toContainText('Pacing');
  await expect(rows).toContainText('POV');

  await page.locator('[data-testid="view-full-analysis"]').click();

  // Navigates to the Coach page…
  await expect(page.locator('[data-testid="coach-page"]')).toBeVisible({ timeout: 8_000 });
  // …where the card lands with the COMPUTED section fully rendered and an
  // honest unavailable note for the AI section.
  const card = page.locator('[data-testid="coach-analysis-card"]').last();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('COMPUTED · LOCAL · FREE');
  await expect(card).toContainText('Words');
  await expect(card).toContainText('Read time');
  await expect(card).toContainText("COACH'S READ · AI");
  await expect(card.locator('[data-testid="coach-read-unavailable"]'))
    .toContainText("Coach's read unavailable");
});

test('M13 §14.7: Full Analysis opens in Coach with COMPUTED vs COACH\'S READ sections', async () => {
  // The coach agent now answers the dedicated analysis prompt with valid JSON.
  await app!.evaluate(({ ipcMain }, args) => {
    try { ipcMain.removeHandler('agent:writing-assistant'); } catch { /* not registered */ }
    ipcMain.handle('agent:writing-assistant', async () => ({ text: args.response }));
  }, {
    response: JSON.stringify({
      purpose: 'Story progression — commits the crew to the fog',
      tension: 'Rising — builds from the first bell',
      pacing: 'Medium — slows at the quay',
      pov: 'Third limited — holds steady throughout',
      takeaway: 'Strong atmosphere; pull the risk forward and this scene sings.',
      drill: 'Drill: mark each paragraph D, A or T and break any DDD run. 5 minutes.',
    }),
  });

  // Advance the conversation so the previous (computed-only) analysis card is
  // no longer the newest turn — the flow skips duplicate stacking, mirroring
  // the prototype's viewFullAnalysis.
  await openCoachPage(page);
  const input = page.locator('[data-testid="coach-input"]');
  await input.fill('One more question about pacing');
  await input.press('Enter');
  await expect(page.locator('.coach-bubble--user', { hasText: 'One more question about pacing' }).last())
    .toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.coach-bubble--coach', { hasText: 'builds from the first bell' }).last())
    .toBeVisible({ timeout: 10_000 });

  await openSceneAnalysisCard(page);
  await page.locator('[data-testid="view-full-analysis"]').click();

  await expect(page.locator('[data-testid="coach-page"]')).toBeVisible({ timeout: 8_000 });
  const card = page.locator('[data-testid="coach-analysis-card"]').last();
  await expect(card).toBeVisible({ timeout: 15_000 });

  // Title (Sc. N is 1-based) + BOTH §5.4 sections.
  await expect(card).toContainText('Full Scene Analysis — Sc. 1 · Harbor Scene');
  await expect(card).toContainText('COMPUTED · LOCAL · FREE');
  await expect(card).toContainText('no AI needed');
  await expect(card).toContainText('Avg sentence length');
  await expect(card).toContainText('Filter words (felt, saw, heard)');
  await expect(card).toContainText('Adverb dialogue tags');
  await expect(card).toContainText("COACH'S READ · AI");
  await expect(card).toContainText('judgment calls — needs a model');
  await expect(card).toContainText('Rising — builds from the first bell');
  await expect(card).toContainText('Third limited — holds steady throughout');
  await expect(card).toContainText('pull the risk forward');
  await expect(card).toContainText('Drill:');
});
