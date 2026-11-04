/**
 * coaching-opt-in.spec.ts — PLAN-COACHING-OPT-IN (quiet Assistant default).
 *
 * Owns: the outbound-prompt proof for the Coaching opt-in, reached the way a
 * writer reaches it — by clicking Settings › Writing partner › Writing Coach.
 * Never touches: preload, ipc.ts or global.d.ts. The capture lives here.
 *
 * Proof is the REQUEST BODY, not DOM bubbles: a main-process
 * `agent:writing-assistant` mock pushes every `payload.prompt` into
 * `globalThis.__e2eCoachPrompts` (first `app.evaluate`), and the test reads
 * the array back with a second `app.evaluate`.
 *
 *   1. Fresh profile (no `coaching` key) + a stale Teacher register → the
 *      Coach send carries the quiet directive and no Teacher text; Full
 *      Analysis asks for no teaching clause.
 *   2. Click Coaching on → Teacher (dormant default) → Teacher marker,
 *      teaching style, and the teaching-clause analysis prompt.
 *   3. Click Assistant → Assistant marker, no Teacher text.
 *   4. Relaunch persistence: Assistant survives; off → relaunch → quiet;
 *      on again → Assistant restored.
 *
 * Coaching never flips the Writing Coach master pair (asserted on disk).
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run --auto-servernum npx playwright test e2e/coaching-opt-in.spec.ts --reporter=list --workers=1
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
import { closeElectronApp } from './helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'coaching-e2e-story-0001';
const CHAPTER_ID = 'coaching-e2e-chapter-0001';
const SCENE_ID = 'coaching-e2e-scene-0001';
const SCENE_TITLE = 'Lighthouse Scene';

const MOCK_COACH_REPLY = 'Mock coach reply for the coaching opt-in e2e.';
const MOCK_ANALYSIS_REPLY = JSON.stringify({
  purpose: 'Setup — plants the keeper and the storm',
  tension: 'Rising — the lamp gutters twice',
  pacing: 'Medium — steady until the stairwell',
  pov: 'Third limited — holds on the keeper',
  takeaway: 'Clear and atmospheric; the storm could arrive one beat sooner.',
});

// Fixed sentinels from frontend/src/partner/partnerPersonality.ts — constants,
// never built from user input. If those strings change, this spec must too.
const TEACHER_MARKER = '[Coaching mode: Teacher]';
const ASSISTANT_MARKER = '[Coaching mode: Assistant]';
const QUIET_DIRECTIVE_START = 'Answer what the writer asked, plainly and directly.';
const TEACHER_DIRECTIVE_START = 'Teach as you answer:';
const ANALYSIS_PROMPT_MARK = 'Respond with ONLY a JSON object';

/** One captured `agent:writing-assistant` request (typed here; no global.d.ts edit). */
interface CapturedCoachRequest {
  prompt: string;
  context?: string;
}

interface CoachCaptureGlobal {
  __e2eCoachPrompts?: CapturedCoachRequest[];
}

// ── Seed ─────────────────────────────────────────────────────────────────────

function buildAppSettings(): object {
  return {
    apiKey: 'sk-ant-e2e-coaching-opt-in',
    onboardingComplete: true,
    provider: {
      kind: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      apiKey: 'sk-ant-e2e-coaching-opt-in',
    },
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
      },
      brainstorm: { enabled: true, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    // Precondition, NOT the thing under test: a stale Teacher register +
    // teaching style saved before Coaching existed. No `coaching` key — the
    // opt-in is reached by clicking.
    writingPartner: { register: 'Teacher', teach: 'Socratic' },
    theme: 'dark',
    rightSidebarVisible: true,
    notesTabUpgradeToastShown: true,
  };
}

function seedUserData(userData: string, vaultDir: string): void {
  const now = new Date().toISOString();
  const prose = 'The lamp guttered twice before the keeper reached the stairs.';
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'Coaching E2E Story',
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
                  { id: 'coaching-e2e-block-0001', type: 'prose', content: prose, order: 0, updatedAt: now },
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

  const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(
    path.join(sceneDir, `${SCENE_ID}.md`),
    ['---', `id: ${SCENE_ID}`, `title: "${SCENE_TITLE}"`, `updatedAt: ${now}`, '---', '', prose, ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(buildAppSettings(), null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

function readDiskSettings(userData: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as Record<string, unknown>;
}

/** Wait for the Settings close auto-save to land the expected coaching value on disk. */
async function expectDiskCoaching(userData: string, coaching: { optIn: boolean; mode: string }): Promise<void> {
  await expect(async () => {
    const disk = readDiskSettings(userData);
    expect(disk.coaching).toEqual(coaching);
    // Coaching never flips the Writing Coach master pair.
    expect(disk.waEnabled).toBe(true);
    expect((disk.agents as { writingAssistant?: { enabled?: boolean } }).writingAssistant?.enabled).toBe(true);
  }).toPass({ timeout: 10_000 });
}

// ── App + capture ────────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

/**
 * First `app.evaluate`: remove the real handler, then install a mock that
 * pushes every request's prompt into a main-process array. Starts empty.
 * Reinstalled after every relaunch (fresh main process, fresh global).
 */
async function installCoachingOptInPromptCapture(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, replies) => {
    const g = globalThis as unknown as CoachCaptureGlobal;
    g.__e2eCoachPrompts = [];
    try { ipcMain.removeHandler('agent:writing-assistant'); } catch { /* not registered */ }
    ipcMain.handle('agent:writing-assistant', async (_evt: unknown, payload: unknown) => {
      const body = (payload && typeof payload === 'object' ? payload : {}) as { prompt?: unknown; context?: unknown };
      const prompt = typeof body.prompt === 'string' ? body.prompt : typeof payload === 'string' ? payload : '';
      const context = typeof body.context === 'string' ? body.context : undefined;
      (g.__e2eCoachPrompts ??= []).push({ prompt, ...(context !== undefined ? { context } : {}) });
      return { text: prompt.includes(replies.analysisMark) ? replies.analysis : replies.chat };
    });
  }, { chat: MOCK_COACH_REPLY, analysis: MOCK_ANALYSIS_REPLY, analysisMark: ANALYSIS_PROMPT_MARK });
}

async function resetCapture(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as unknown as CoachCaptureGlobal).__e2eCoachPrompts = [];
  });
}

/** Second `app.evaluate`: read the captured request bodies back. */
async function readCapture(app: ElectronApplication): Promise<CapturedCoachRequest[]> {
  return app.evaluate(() => (globalThis as unknown as CoachCaptureGlobal).__e2eCoachPrompts ?? []);
}

async function capturedChatPrompt(app: ElectronApplication, line: string): Promise<string> {
  let found: string | undefined;
  await expect(async () => {
    found = (await readCapture(app)).find((r) => r.prompt.includes(line))?.prompt;
    expect(found, `no captured agent:writing-assistant request for "${line}"`).toBeTruthy();
  }).toPass({ timeout: 10_000 });
  return found!;
}

async function capturedAnalysisPrompt(app: ElectronApplication): Promise<string> {
  let found: string | undefined;
  await expect(async () => {
    found = (await readCapture(app)).find((r) => r.prompt.includes(ANALYSIS_PROMPT_MARK))?.prompt;
    expect(found, 'no captured Full Analysis request').toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return found!;
}

// ── UI paths ─────────────────────────────────────────────────────────────────

/** Open the scene, then Notes & Analysis → View Full Analysis → Coach page. */
async function openCoachPageViaFullAnalysis(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click().catch(() => undefined);
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 20_000 });
  await sceneRow.click();
  await expect(page.locator('[data-testid="agent-hub-panel"]')).toBeVisible({ timeout: 6_000 });
  await page.locator('[data-testid="ahp-tab-notes-analysis"]').click();
  const viewBtn = page.locator('[data-testid="view-full-analysis"]');
  await expect(viewBtn).toBeVisible({ timeout: 8_000 });
  await viewBtn.click();
  await expect(page.locator('[data-testid="coach-page"]')).toBeVisible({ timeout: 8_000 });
}

async function sendCoachLine(page: Page, line: string): Promise<void> {
  const input = page.locator('[data-testid="coach-input"]');
  await expect(input).toBeVisible({ timeout: 8_000 });
  await input.fill(line);
  await page.getByTestId('coach-send').click();
  await expect(page.locator('.coach-bubble--user', { hasText: line }).last()).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.coach-bubble--coach', { hasText: MOCK_COACH_REPLY }).last())
    .toBeVisible({ timeout: 10_000 });
}

async function openWritingCoachSettings(page: Page): Promise<void> {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 6_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();
  await page.getByRole('tab', { name: 'Writing partner' }).click();
  await expect(page.getByTestId('writing-coach-settings')).toBeVisible({ timeout: 6_000 });
}

async function closeSettings(page: Page): Promise<void> {
  await page.locator('.settings-close').click();
  await expect(page.locator('.settings-title')).not.toBeVisible({ timeout: 6_000 });
}

const optInToggle = (page: Page) => page.getByTestId('writing-coach-coaching-optin');
const clickOptInTrack = (page: Page) =>
  page.locator('[data-testid="writing-coach-settings"] .wc-coaching-optin .settings-toggle-track').click();
const modeRadio = (page: Page, mode: 'teacher' | 'assistant') => page.getByTestId(`writing-coach-mode-${mode}-radio`);

// ── Suite ────────────────────────────────────────────────────────────────────

let root: string;
let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

async function boot(): Promise<void> {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await installCoachingOptInPromptCapture(app);
}

async function relaunch(): Promise<void> {
  await closeElectronApp(app);
  app = undefined;
  await boot();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-coaching-'));
  userData = path.join(root, 'ud');
  vaultDir = path.join(root, 'vault');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  seedUserData(userData, vaultDir);
  await boot();
});

test.afterAll(async () => {
  await closeElectronApp(app);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fresh profile: Coach send carries the quiet directive — no Teacher text despite a stale Teacher register', async () => {
  await resetCapture(app!);
  await openCoachPageViaFullAnalysis(page);

  const analysis = await capturedAnalysisPrompt(app!);
  expect(analysis).not.toContain('teaching clause');
  expect(analysis).not.toContain('"drill"');
  expect(analysis).toContain('never rewrite the scene or generate manuscript prose');

  const line = 'Coaching e2e — default question';
  await sendCoachLine(page, line);
  const prompt = await capturedChatPrompt(app!, line);
  expect(prompt.startsWith(QUIET_DIRECTIVE_START)).toBe(true);
  expect(prompt).not.toContain(TEACHER_MARKER);
  expect(prompt).not.toContain(ASSISTANT_MARKER);
  expect(prompt).not.toContain(TEACHER_DIRECTIVE_START);
  expect(prompt).not.toContain('Teaching style');
  expect(prompt).not.toContain('Socratic');

  // Exactly one WA request per Coach send (no extra invoke from the toggle).
  const sends = (await readCapture(app!)).filter((r) => r.prompt.includes(line));
  expect(sends).toHaveLength(1);
  // Nothing opted in on disk (key absent, or a boot write of the normalized default).
  const diskCoaching = readDiskSettings(userData).coaching as { optIn?: unknown } | undefined;
  expect(diskCoaching?.optIn ?? false).toBe(false);
});

test('clicking Coaching on lands on Teacher — the Teacher marker reaches the request', async () => {
  await openWritingCoachSettings(page);
  await expect(optInToggle(page)).not.toBeChecked();
  await expect(modeRadio(page, 'teacher')).toBeChecked();
  await expect(modeRadio(page, 'teacher')).toBeDisabled();
  // Teaching chips wait for Coaching (stale Teacher register kept, disabled).
  await expect(page.getByTestId('wp-trait-register-teacher')).toBeDisabled();
  await expect(page.getByTestId('wp-trait-register-teacher')).toHaveAttribute('aria-pressed', 'true');

  await clickOptInTrack(page);
  await expect(optInToggle(page)).toBeChecked();
  await expect(modeRadio(page, 'teacher')).toBeChecked();
  await expect(modeRadio(page, 'teacher')).toBeEnabled();
  await expect(page.getByTestId('wp-trait-register-teacher')).toBeEnabled();
  await closeSettings(page);
  await expectDiskCoaching(userData, { optIn: true, mode: 'teacher' });

  await resetCapture(app!);
  const line = 'Coaching e2e — teacher question';
  await sendCoachLine(page, line);
  const prompt = await capturedChatPrompt(app!, line);
  expect(prompt.startsWith(`${TEACHER_MARKER}\n${TEACHER_DIRECTIVE_START}`)).toBe(true);
  expect(prompt).toContain('Teaching style (Socratic)');
  expect(prompt).toContain('Register (Teacher)');
  expect(prompt).not.toContain(ASSISTANT_MARKER);

  // Full Analysis in Teacher mode asks for teaching clauses + a drill.
  await resetCapture(app!);
  await openCoachPageViaFullAnalysis(page);
  const analysis = await capturedAnalysisPrompt(app!);
  expect(analysis).toContain('teaching clause');
  expect(analysis).toContain('"drill"');
});

test('picking Assistant sends the Assistant marker and no Teacher text', async () => {
  await openWritingCoachSettings(page);
  await page.getByTestId('writing-coach-mode-assistant').click();
  await expect(modeRadio(page, 'assistant')).toBeChecked();
  await closeSettings(page);
  await expectDiskCoaching(userData, { optIn: true, mode: 'assistant' });

  await resetCapture(app!);
  const line = 'Coaching e2e — assistant question';
  await sendCoachLine(page, line);
  const prompt = await capturedChatPrompt(app!, line);
  expect(prompt.startsWith(`${ASSISTANT_MARKER}\n${QUIET_DIRECTIVE_START}`)).toBe(true);
  expect(prompt).toContain('Register (Companion)');
  expect(prompt).not.toContain(TEACHER_MARKER);
  expect(prompt).not.toContain(TEACHER_DIRECTIVE_START);
  expect(prompt).not.toContain('Teaching style');
  expect(prompt).not.toContain('Register (Teacher)');
});

test('relaunch: Assistant persists; off → relaunch is quiet; on again restores Assistant', async () => {
  test.setTimeout(240_000);

  // 1. Assistant survives a relaunch.
  await relaunch();
  await openWritingCoachSettings(page);
  await expect(optInToggle(page)).toBeChecked();
  await expect(modeRadio(page, 'assistant')).toBeChecked();

  // 2. Turn Coaching off; the Assistant pick stays stored.
  await clickOptInTrack(page);
  await expect(optInToggle(page)).not.toBeChecked();
  await expect(modeRadio(page, 'assistant')).toBeDisabled();
  await closeSettings(page);
  await expectDiskCoaching(userData, { optIn: false, mode: 'assistant' });

  // 3. Relaunch while off → quiet default, stored Assistant does not apply.
  await relaunch();
  await openCoachPageViaFullAnalysis(page);
  const quietLine = 'Coaching e2e — off after relaunch';
  await sendCoachLine(page, quietLine);
  const quiet = await capturedChatPrompt(app!, quietLine);
  expect(quiet.startsWith(QUIET_DIRECTIVE_START)).toBe(true);
  expect(quiet).not.toContain(ASSISTANT_MARKER);
  expect(quiet).not.toContain(TEACHER_MARKER);

  // 4. Turn Coaching back on → Assistant restored (not reset to Teacher).
  await openWritingCoachSettings(page);
  await expect(optInToggle(page)).not.toBeChecked();
  await expect(modeRadio(page, 'assistant')).toBeChecked();
  await clickOptInTrack(page);
  await expect(optInToggle(page)).toBeChecked();
  await expect(modeRadio(page, 'assistant')).toBeChecked();
  await closeSettings(page);
  await expectDiskCoaching(userData, { optIn: true, mode: 'assistant' });

  await resetCapture(app!);
  const line = 'Coaching e2e — assistant restored';
  await sendCoachLine(page, line);
  const prompt = await capturedChatPrompt(app!, line);
  expect(prompt.startsWith(`${ASSISTANT_MARKER}\n${QUIET_DIRECTIVE_START}`)).toBe(true);
  expect(prompt).not.toContain(TEACHER_MARKER);
});
