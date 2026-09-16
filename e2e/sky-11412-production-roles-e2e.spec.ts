/**
 * sky-11412-production-roles-e2e.spec.ts — SKY-11412 (SKY-11411 follow-up)
 *
 * Real cross-boundary E2E for the three production-team roles (Alpha Reader,
 * Storyline Consultant, Line Editor) registered live in SKY-11411. Unlike
 * productionRoleSafety.test.ts (a same-process unit test of the composition
 * function), this suite drives the actual UI -> preload -> ipcMain ->
 * electron-main handler -> outbound provider HTTP call -> renderer round trip.
 *
 * Nothing on the electron-main side is mocked — not even ipcMain.handle. The
 * ONLY stand-in for a real third party is the configured LLM provider itself:
 * the global provider is pointed at a plain Node http server on loopback
 * (kind: 'custom'), the same OpenAI-compatible transport a real self-hosted
 * endpoint (Ollama / LM Studio / llama.cpp) would use. That means
 * registerProductionRoleRunHandler's entity-index load, reveal-point
 * filtering (readerPerspective.ts), and persona composition (agentPersona.ts)
 * all run for real; only the actual model inference is stood in for by an
 * echo server so the test can inspect exactly what reached "the model".
 *
 *   TC-SKY11412-01  Settings > AI Agents: Alpha Reader and Storyline
 *                    Consultant toggle on and persist to app-settings.json
 *                    (real settings:set round trip). Line Editor stays OFF —
 *                    owner ruling, SKY-10528.
 *
 *   TC-SKY11412-02  Beta Reader -> Production Team tab -> Alpha Reader ->
 *                    Run: a planted-reveal fixture (Lord Vhaeraun, hidden
 *                    until Chapter 10) proves the reader-perspective role
 *                    never receives the not-yet-revealed identity through the
 *                    live process boundary, while an always-visible entity
 *                    (Mira) and the Alpha Reader's own persona framing do
 *                    reach the model.
 *
 *   TC-SKY11412-03  Same panel, Storyline Consultant (author-perspective,
 *                    craft role): legitimately sees the whole map, including
 *                    the reveal — proving role-specific framing is real, not
 *                    one output relabeled (AC3).
 *
 *   TC-SKY11412-04  Same panel, switching to the OFF Line Editor: the previous
 *                    role's review leaves the screen instead of being
 *                    relabelled under the new role's heading, and Run is
 *                    blocked with a visible reason — no provider hit
 *                    (SKY-11456, found by SKY-11440).
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/sky-11412-production-roles-e2e.spec.ts --reporter=list
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

const STORY_ID = 'sky11412-e2e-story-0001';
const CHAPTER_ID = 'sky11412-e2e-chapter-0001';
// The chapter TITLE, not just its id, matters: BetaReaderPage's scope label is
// `Chapter: ${chapter.title}`, and the entity index's reveal-point comparator
// (parseScenePosition) reads the chapter number out of that label. Title must
// read as "Chapter 2" for the mid-story reveal-point comparison to land.
const CHAPTER_TITLE = 'Chapter 2';
const SCENE_ID = 'sky11412-e2e-scene-0001';
const SCENE_TITLE = 'Town Square';
const SCENE_BODY = [
  'The square was quiet at dusk. A lantern flickered outside the inn as the',
  'travelers gathered their things, unaware of how much the night still had',
  'in store for them.',
].join('\n');

// Planted-reveal fixture (mirrors productionRoleSafety.test.ts / readerPerspective
// unit fixtures): Lord Vhaeraun is not revealed until Chapter 10, so a reader at
// Chapter 2 must never see the canonical name or its alias. Mira has no
// reveal_point, so she is always visible.
const VISIBLE_ENTITY_NAME = 'Mira';
const HIDDEN_ENTITY_NAME = 'Lord Vhaeraun';
const HIDDEN_ENTITY_ALIAS = 'the true villain';

// ─── Mock LLM server ────────────────────────────────────────────────────────
//
// A plain OpenAI-compatible chat/completions endpoint on loopback. The global
// provider config points at it (kind: 'custom'), so streamFromProvider's real
// runOpenAICompatibleStream path makes a genuine HTTP request here — the only
// stand-in for a third-party model in this suite. The response echoes back
// the exact system + user content the live handler composed, so the test can
// assert on precisely what reached "the model".

interface CapturedRequest {
  system: string;
  user: string;
}

function startMockLlmServer(): Promise<{
  port: number;
  close: () => Promise<void>;
  lastRequest: () => CapturedRequest | null;
  hits: () => number;
}> {
  let last: CapturedRequest | null = null;
  let hits = 0;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let systemMsg = '';
        let userMsg = '';
        try {
          const parsed = JSON.parse(body) as { messages?: Array<{ role: string; content: string }> };
          systemMsg = parsed.messages?.find((m) => m.role === 'system')?.content ?? '';
          userMsg = parsed.messages?.find((m) => m.role === 'user')?.content ?? '';
        } catch {
          /* malformed body — echo empty */
        }
        last = { system: systemMsg, user: userMsg };
        hits += 1;

        // Echo the composed prompt back as the "model's" answer, delimited so
        // the test can assert on each half independently.
        const echo = `SYSTEM_FRAMING:::${systemMsg}\n\nUSER_CONTENT:::${userMsg}`;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: echo } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        lastRequest: () => last,
        hits: () => hits,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

// ─── Seed helpers ──────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string, mockPort: number): void {
  const now = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'SKY-11412 E2E Story',
        path: `stories/${STORY_ID}`,
        chapters: [
          {
            id: CHAPTER_ID,
            title: CHAPTER_TITLE,
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
                  { id: 'sky11412-e2e-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now },
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

  // Planted-reveal entity fixture — loadEntityIndex scans <notesVaultRoot>/Universes.
  const universesDir = path.join(notesVaultDir, 'Universes');
  fs.mkdirSync(universesDir, { recursive: true });
  fs.writeFileSync(
    path.join(universesDir, `${VISIBLE_ENTITY_NAME}.md`),
    ['---', 'type: Character', '---', '', `${VISIBLE_ENTITY_NAME} runs the inn at the edge of the square.`, ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(universesDir, `${HIDDEN_ENTITY_NAME}.md`),
    [
      '---',
      `aliases: [${HIDDEN_ENTITY_ALIAS}]`,
      'type: Character',
      'reveal_point: Chapter 10',
      '---',
      '',
      'Not revealed until the story catches up.',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        onboardingComplete: true,
        theme: 'dark',
        rightSidebarVisible: true,
        notesTabUpgradeToastShown: true,
        // Global provider points at the local mock LLM — a real loopback HTTP
        // endpoint, not an ipcMain mock. Every role falls back to this config
        // (no per-agent provider override seeded below).
        provider: { kind: 'custom', baseUrl: `http://127.0.0.1:${mockPort}/v1`, model: 'e2e-mock-model' },
        agents: {
          writingAssistant: {
            enabled: false, model: 'claude-haiku-4-5-20251001', scanIntervalSeconds: 60,
            autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
            maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
            waScanInterval: 'manual',
          },
          brainstorm: {
            enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false,
            confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50,
            heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
          },
          archive: {
            enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
            autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
            maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
          },
          betaReader: { enabled: true, model: 'e2e-mock-model', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
          // SKY-11412: all three default OFF (AC1) — turned on live via the
          // Settings UI in TC-SKY11412-01, not pre-seeded enabled.
          alphaReader: { enabled: false, model: 'e2e-mock-model', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
          storylineConsultant: { enabled: false, model: 'e2e-mock-model', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
          lineEditor: { enabled: false, model: 'e2e-mock-model', maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500_000 },
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
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

async function openProductionTeamTab(page: Page): Promise<import('@playwright/test').Locator> {
  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 8_000 });

  const betaRow = page.locator('[data-testid="ahp-agent-row-beta-reader"]');
  await expect(betaRow).toBeVisible({ timeout: 8_000 });
  await betaRow.click();

  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 8_000 });
  await overlay.getByRole('tab', { name: 'Production Team' }).click();
  await expect(page.locator('[data-testid="production-review-panel"]')).toBeVisible({ timeout: 5_000 });
  return overlay;
}

// ─── Module-level state ───────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;
let mockLlm: { port: number; close: () => Promise<void>; lastRequest: () => CapturedRequest | null };

test.beforeAll(async () => {
  mockLlm = await startMockLlmServer();

  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11412-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11412-vault-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11412-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir, mockLlm.port);

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
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── TC-SKY11412-01: toggle roles on via Settings, persisted to disk ──────────

test('TC-SKY11412-01: Settings > AI Agents — Alpha Reader and Storyline Consultant toggle on and persist; Line Editor stays off', async () => {
  await page.locator('.app-menu-gear-btn').click();
  await expect(page.locator('.settings-title')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="settings-cat-agents"]').click();

  const alphaToggle = page.getByLabel('Enable Alpha Reader');
  const storylineToggle = page.getByLabel('Enable Storyline Consultant');
  const lineEditorToggle = page.getByLabel('Enable Line Editor');

  // AC1 default-off, owner ruling SKY-10528: Line Editor is unchecked before
  // this test touches anything.
  await expect(lineEditorToggle).not.toBeChecked();

  // The checkbox itself is visually hidden (zero-size, styled via the sibling
  // track span) — click the track, same pattern as every other settings
  // toggle test in this repo (e.g. sky10574-comments-gutter-ai-off.spec.ts).
  await expect(alphaToggle).not.toBeChecked();
  await page.locator('[data-testid="alpha-reader-agent-card"] .settings-toggle-track').click();
  await expect(alphaToggle).toBeChecked();

  await expect(storylineToggle).not.toBeChecked();
  await page.locator('[data-testid="storyline-consultant-agent-card"] .settings-toggle-track').click();
  await expect(storylineToggle).toBeChecked();

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible({ timeout: 5_000 });
  await page.click('.settings-close');

  // Real settings:set -> saveAppSettings -> fs.writeFileSync round trip —
  // assert the change landed on disk, not just in the DOM.
  const stored = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as {
    agents: { alphaReader?: { enabled: boolean }; storylineConsultant?: { enabled: boolean }; lineEditor?: { enabled: boolean } };
  };
  expect(stored.agents.alphaReader?.enabled).toBe(true);
  expect(stored.agents.storylineConsultant?.enabled).toBe(true);
  expect(stored.agents.lineEditor?.enabled).toBe(false);
});

// ─── TC-SKY11412-02: Alpha Reader — reveal-point no-leak through the live boundary ─

test('TC-SKY11412-02: Alpha Reader run never leaks the pre-reveal identity through the live process boundary', async () => {
  await openScene(page, SCENE_TITLE);
  const overlay = await openProductionTeamTab(page);

  await overlay.getByLabel('Production role').selectOption('alphaReader');
  await overlay.getByLabel('Review scope').selectOption('chapter');

  const runBtn = overlay.locator('[data-testid="production-review-run"]');
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
  await runBtn.click();

  const result = overlay.locator('[data-testid="production-review-result"]');
  await expect(result).toBeVisible({ timeout: 8_000 });

  // Real round trip landed: this is the mock LLM server's echo of the ACTUAL
  // system + user content the live handler composed — not a canned string.
  await expect(result).toContainText('Alpha Reader'); // persona framing (SOUL/AGENTS.md)
  await expect(result).toContainText(VISIBLE_ENTITY_NAME); // always-visible entity
  const resultText = (await result.innerText());
  expect(resultText).not.toContain(HIDDEN_ENTITY_NAME);
  expect(resultText).not.toContain(HIDDEN_ENTITY_ALIAS);

  // Cross-check against what the mock server actually received — the strongest
  // proof this exercised the real electron-main composition, not a stale render.
  const captured = mockLlm.lastRequest();
  expect(captured?.system).toContain('Alpha Reader');
  expect(captured?.user).not.toContain(HIDDEN_ENTITY_NAME);
  expect(captured?.user).toContain(VISIBLE_ENTITY_NAME);
});

// ─── TC-SKY11412-03: Storyline Consultant — legitimately sees the whole map ───

test('TC-SKY11412-03: Storyline Consultant run gets the full entity map — role-specific framing is real (AC3)', async () => {
  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 5_000 });

  await overlay.getByLabel('Production role').selectOption('storylineConsultant');
  // Scope select may have reset; re-select chapter to keep both runs comparable.
  await overlay.getByLabel('Review scope').selectOption('chapter');

  const runBtn = overlay.locator('[data-testid="production-review-run"]');
  await expect(runBtn).toBeEnabled({ timeout: 5_000 });
  await runBtn.click();

  const result = overlay.locator('[data-testid="production-review-result"]');
  await expect(result).toBeVisible({ timeout: 8_000 });

  // Author-perspective craft role: legitimately sees the whole map, including
  // the not-yet-revealed identity — the exact opposite of TC-SKY11412-02,
  // proving the two roles get distinguishable, role-specific compositions.
  await expect(result).toContainText('Storyline Consultant');
  await expect(result).toContainText(HIDDEN_ENTITY_NAME);

  const captured = mockLlm.lastRequest();
  expect(captured?.system).toContain('Storyline Consultant');
  expect(captured?.system).not.toContain('Alpha Reader');
  expect(captured?.user).toContain(HIDDEN_ENTITY_NAME);
});

// ─── TC-SKY11412-04: switching to an OFF role never relabels the last review ──

test('TC-SKY11412-04: selecting an off role clears the previous review and blocks Run (SKY-11456)', async () => {
  const overlay = page.locator('.beta-reader-overlay');
  await expect(overlay).toBeVisible({ timeout: 5_000 });

  // Carries the Storyline Consultant result from TC-SKY11412-03 on screen.
  const result = overlay.locator('[data-testid="production-review-result"]');
  await expect(result).toContainText('Storyline Consultant');
  const hitsBefore = mockLlm.hits();

  await overlay.getByLabel('Production role').selectOption('lineEditor');

  // The previous role's notes must not survive under the new role's heading.
  await expect(result).toHaveCount(0);

  // Line Editor is OFF (TC-SKY11412-01): Run is blocked up front, with the
  // reason visible next to it rather than only after a click.
  const runBtn = overlay.locator('[data-testid="production-review-run"]');
  await expect(runBtn).toBeDisabled();
  await expect(overlay.locator('[data-testid="production-review-off-hint"]')).toContainText(
    'Line Editor is off',
  );

  // Nothing reached the provider while the off role was selected.
  expect(mockLlm.hits()).toBe(hitsBefore);

  // Back to the role that produced it: its own review returns, still its own.
  await overlay.getByLabel('Production role').selectOption('storylineConsultant');
  await expect(result).toContainText('Storyline Consultant');
  expect(mockLlm.hits()).toBe(hitsBefore);
});
