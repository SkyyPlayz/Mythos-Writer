/**
 * sky-11816-beta-report-reasoning-parser.spec.ts — SKY-11816
 *
 * Real cross-boundary E2E for the Beta Reader Reports "Run" parser
 * regression: a reasoning model (LM Studio, DeepSeek-R1 distills, etc.) that
 * emits a `<think>...</think>` block and then pretty-prints its JSON answer
 * (instead of the requested compact "one object per line" — see
 * buildBetaReportUserContent) produced NO visible report and NO error;
 * betaReport.ts's line-based parser silently found nothing on any single
 * line and the run reverted to "No beta reads yet" with zero feedback.
 *
 * Unlike e2e/sky-11221-beta-reader-consolidation.spec.ts (which replaces the
 * `betaReport:run` ipcMain handler wholesale with a mock — never exercising
 * the real parser), this suite mocks ONLY the outbound LLM-facing HTTP call
 * (same pattern as sky-11412-production-roles-e2e.spec.ts): a plain
 * OpenAI-compatible SSE endpoint on loopback stands in for LM Studio. The
 * real ipcMain handler (registerBetaReportRunHandler), the real streaming
 * `<think>` stripper (provider.ts runOpenAICompatibleStream), and the real
 * parser (betaReport.ts parseBetaReportResponse) all run for real.
 *
 *   TC-SKY11816-01  A reasoning-model-shaped response — `<think>` block, then
 *                    a markdown-fenced, pretty-printed (multi-line) JSON
 *                    summary + reaction, exactly the shape a small local
 *                    model produces despite the "one line, no fences"
 *                    instruction — renders a full report: score chips and
 *                    the reaction card. This is the AC1 regression fix.
 *
 *   TC-SKY11816-02  A response with real (non-empty, `<think>`-stripped)
 *                    content that never resolves to a valid summary object
 *                    surfaces a visible error toast — never a silent revert
 *                    to "No beta reads yet" with the history count unchanged.
 *                    This is the AC2 guarantee.
 *
 *   TC-SKY11816-03  A normal, fully-compliant (non-reasoning) model response
 *                    — compact one-JSON-object-per-line, no `<think>`, no
 *                    fences — still renders correctly (AC3, no regression).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/sky-11816-beta-report-reasoning-parser.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
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

const STORY_ID = 'sky11816-e2e-story-0001';
const CHAPTER_ID = 'sky11816-e2e-chapter-0001';
const SCENE_ID = 'sky11816-e2e-scene-0001';
const SCENE_TITLE = 'Harbor Scene';
const SCENE_QUOTE = 'the last ship slipped its mooring';
const SCENE_BODY = [
  `At dusk, ${SCENE_QUOTE} and vanished into the fog, leaving the harbor`,
  'quiet for the first time in a decade of war.',
].join('\n');

/** A reasoning model's inline chain-of-thought, wrapped in literal `<think>` tags in `content` (SKY-11240). */
const THINK_BLOCK =
  '<think>\nLet me weigh hook, pacing, clarity, and emotion for this passage before I answer.\n' +
  'The image is strong; pacing is a touch rushed.\n</think>\n\n';

/**
 * A reasoning-model-shaped answer: markdown-fenced, pretty-printed
 * (multi-line, indented) JSON — NOT the compact "one object per line" the
 * prompt asks for. The pre-fix line-based parser found nothing here (every
 * line of the pretty-printed object fails the "starts with { AND is valid
 * JSON on its own" check); the fixed brace-scanning parser recovers it.
 */
const REASONING_REPORT_BODY = [
  '```json',
  '{',
  '  "type": "summary",',
  '  "overall": 78,',
  '  "categories": {',
  '    "hook": 82,',
  '    "pacing": 68,',
  '    "clarity": 75,',
  '    "emotion": 80',
  '  },',
  '  "feedback": "A confident, atmospheric close to the chapter."',
  '}',
  '```',
  '',
  '```json',
  '{',
  '  "type": "reaction",',
  `  "kind": "loved",`,
  `  "sceneId": "${SCENE_ID}",`,
  `  "quote": "${SCENE_QUOTE}",`,
  '  "where": "Harbor scene",',
  '  "note": "Evocative closing image."',
  '}',
  '```',
].join('\n');

/** Real, non-empty (post-<think>-strip) content that never resolves to a summary object. */
const UNPARSEABLE_BODY =
  'I really enjoyed reading this passage! The imagery of the departing ship landed well for me.';

/** A fully-compliant, non-reasoning model's response — compact JSON-per-line, no `<think>`, no fences. */
const COMPLIANT_REPORT_BODY = [
  `{"type":"summary","overall":85,"categories":{"hook":88,"pacing":80,"clarity":86,"emotion":85},"feedback":"Tight, evocative closer."}`,
  `{"type":"reaction","kind":"loved","sceneId":"${SCENE_ID}","quote":"${SCENE_QUOTE}","where":"Harbor scene","note":"Loved this line."}`,
].join('\n');

// ─── Mock LLM server ────────────────────────────────────────────────────────
//
// A plain OpenAI-compatible chat/completions SSE endpoint on loopback (same
// pattern as sky-11412-production-roles-e2e.spec.ts). The global provider
// config points at it (kind: 'custom'), so registerBetaReportRunHandler's
// real streamFromProvider call makes a genuine HTTP request here — the only
// stand-in for a third-party model. `nextBody` selects what "the model"
// answers with for the next request, letting each test drive a distinct
// response shape through the SAME real app instance.

function startMockLlmServer(): Promise<{
  port: number;
  close: () => Promise<void>;
  setNextBody: (body: string) => void;
  hits: () => number;
}> {
  let nextBody = '';
  let hits = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404);
        res.end();
        return;
      }
      req.on('data', () => {}); // drain the request body — content is not needed here
      req.on('end', () => {
        hits += 1;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: nextBody } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        setNextBody: (body: string) => { nextBody = body; },
        hits: () => hits,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// ─── Seed helpers ──────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, mockPort: number): void {
  const now = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'SKY-11816 E2E Story',
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
                  { id: 'sky11816-e2e-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now },
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
        onboardingComplete: true,
        theme: 'dark',
        rightSidebarVisible: true,
        notesTabUpgradeToastShown: true,
        // Global provider points at the local mock LLM — a real loopback HTTP
        // endpoint (LM Studio's actual transport), not an ipcMain mock.
        provider: { kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, model: 'e2e-mock-reasoning-model' },
        agents: {
          writingAssistant: { enabled: false, model: 'claude-haiku-4-5-20251001', scanIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
          brainstorm: { enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
          archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
          betaReader: { enabled: true, model: 'e2e-mock-reasoning-model', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
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

async function openScene(pg: Page, sceneTitle: string): Promise<void> {
  await clickStoryNav(pg);
  await pg.locator('[data-testid="story-subview-editor"]').click();
  await expect(pg.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = pg.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

async function openReportsPanel(pg: Page): Promise<import('@playwright/test').Locator> {
  const hubPanel = pg.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 8_000 });
  const betaRow = pg.locator('[data-testid="ahp-agent-row-beta-reader"]');
  await expect(betaRow).toBeVisible({ timeout: 8_000 });
  await betaRow.click();
  const overlay = pg.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await expect(overlay.getByRole('tab', { name: 'Reports' })).toBeVisible();
  return overlay;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;
let mockLlm: { port: number; close: () => Promise<void>; setNextBody: (body: string) => void; hits: () => number };

test.beforeAll(async () => {
  mockLlm = await startMockLlmServer();

  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11816-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11816-vault-'));
  seedUserData(userData, vaultDir, mockLlm.port);

  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
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
  await mockLlm.close().catch(() => undefined);
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});

// ─── TC-SKY11816-01: reasoning-model-shaped response renders a full report ───

test('TC-SKY11816-01: <think> + pretty-printed/fenced JSON from a reasoning model renders the report', async () => {
  mockLlm.setNextBody(THINK_BLOCK + REASONING_REPORT_BODY);

  await openScene(page, SCENE_TITLE);
  const overlay = await openReportsPanel(page);

  await expect(overlay.locator('.beta-reader-empty')).toBeVisible({ timeout: 5_000 });

  const runBtn = overlay.locator('.beta-reader-run-btn');
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
  await runBtn.click();

  // Real round trip: UI -> preload -> ipcMain (betaReport:run, unmocked) ->
  // main.ts registerBetaReportRunHandler -> streamFromProvider (real <think>
  // stripping) -> HTTP POST to the mock LLM -> parseBetaReportResponse (the
  // fixed brace-scanning parser) -> render.
  await expect(overlay.locator('.beta-reader-empty')).toHaveCount(0, { timeout: 10_000 });
  await expect(overlay.locator('.beta-score-chip__score').first()).toHaveText('78', { timeout: 5_000 });
  await expect(overlay.locator('.beta-reader-overall-feedback')).toContainText(
    'A confident, atmospheric close to the chapter.',
  );
  await expect(overlay.locator('.beta-reaction-card__quote')).toContainText(SCENE_QUOTE);
  await expect(overlay.locator('.beta-reaction-card__note')).toContainText('Evocative closing image.');
  await expect(overlay.locator('.beta-reader-history-item')).toHaveCount(1, { timeout: 5_000 });

  expect(mockLlm.hits()).toBe(1);
});

// ─── TC-SKY11816-02: unparseable-but-non-empty response surfaces a visible error ─

test('TC-SKY11816-02: a real but unparseable response shows a visible error, not a silent revert', async () => {
  mockLlm.setNextBody(THINK_BLOCK + UNPARSEABLE_BODY);

  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 5_000 });

  // History carries the one report from TC-SKY11816-01 — this run must not
  // add a second (degraded/placeholder) entry.
  await expect(overlay.locator('.beta-reader-history-item')).toHaveCount(1);

  const runBtn = overlay.locator('.beta-reader-run-btn');
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
  await runBtn.click();

  // AC2: a visible, specific error toast — never a silent revert.
  const toast = page.locator('[data-testid="app-toast"]');
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toContainText(/couldn't be parsed into a report/i);
  await expect(toast).toHaveClass(/app-toast--error/);

  // No phantom report was saved — history count is unchanged from before Run.
  await expect(overlay.locator('.beta-reader-history-item')).toHaveCount(1);
  // Run re-enabled — the user isn't stuck on a dead "Reading…" state either.
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
});

// ─── TC-SKY11816-03: a fully-compliant (non-reasoning) response still works ───

test('TC-SKY11816-03: a compliant one-JSON-per-line response (no <think>, no fences) still renders — no regression', async () => {
  mockLlm.setNextBody(COMPLIANT_REPORT_BODY);

  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 5_000 });

  const runBtn = overlay.locator('.beta-reader-run-btn');
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
  await runBtn.click();

  await expect(overlay.locator('.beta-score-chip__score').first()).toHaveText('85', { timeout: 10_000 });
  await expect(overlay.locator('.beta-reader-overall-feedback')).toContainText('Tight, evocative closer.');
  await expect(overlay.locator('.beta-reaction-card__note')).toContainText('Loved this line.');
  // The two successful runs (TC-01 and this one) both saved; TC-02 did not.
  await expect(overlay.locator('.beta-reader-history-item')).toHaveCount(2, { timeout: 5_000 });

  await overlay.locator('.beta-reader-close').click();
  await expect(overlay).toBeHidden({ timeout: 5_000 });
});
