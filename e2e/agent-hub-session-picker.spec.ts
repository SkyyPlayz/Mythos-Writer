/**
 * agent-hub-session-picker.spec.ts — SKY-8537 (GH #960)
 *
 * Real-path E2E for the Agent Hub session picker on the Writing Coach
 * surface: switching the picker between two sessions must render each
 * session's own persisted transcript (not the previous session's, not a
 * blank one), and that separation must survive an app restart — the whole
 * chain is exercised through the REAL (unmocked) `agentSessions` IPC
 * bridge: renderer -> preload -> electron-main handlers -> Sessions/*.md
 * files on disk. No Anthropic/chat IPC is mocked; turns are seeded via the
 * same `agentSessions.appendTurns` / `create` / `rename` calls the app
 * itself uses, so this proves the production read/hydrate/persist path,
 * not a UI-only illusion.
 *
 * GH #960 was filed against `62b943bf` (pre-M12/SKY-7112/SKY-7113); the
 * session store hook (frontend/src/lib/useAgentSessions.ts) and the
 * mid-flight isolation fix (SKY-7113, commit 49c77b5) already cover this at
 * the Vitest integration level with a mocked vault. This spec is the first
 * REAL Electron + real-disk coverage of the same contract.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/agent-hub-session-picker.spec.ts --reporter=list
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

const STORY_ID = 'ahsp-e2e-story-0001';
const CHAPTER_ID = 'ahsp-e2e-chapter-0001';
const SCENE_ID = 'ahsp-e2e-scene-0001';

const ALPHA_TITLE = 'Alpha Session';
const BETA_TITLE = 'Beta Session';
const ALPHA_MARKER = 'ALPHA_TRANSCRIPT_MARKER_777';
const BETA_MARKER = 'BETA_TRANSCRIPT_MARKER_888';

// ─── Seed helpers ──────────────────────────────────────────────────────────────

function buildAppSettings(): object {
  return {
    apiKey: 'sk-ant-e2e-agent-hub-session-picker',
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
        title: 'Agent Hub Session Picker E2E Story',
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
                title: 'Quiet Scene',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [
                  { id: 'ahsp-e2e-block-0001', type: 'prose', content: 'The room held its breath.', order: 0, updatedAt: now },
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
    ['---', `id: ${SCENE_ID}`, 'title: "Quiet Scene"', `updatedAt: ${now}`, '---', '', 'The room held its breath.', ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(buildAppSettings(), null, 2));
  // Pin notesVaultRoot to vaultDir explicitly — without it, sessions land
  // under <userData>/vaults/<name>/ (defaultNotesVaultRoot), not vaultDir.
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: vaultDir }, null, 2),
  );
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
  const p = await app.firstWindow();
  p.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await p.waitForLoadState('domcontentloaded');
  return p;
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
  const proc = app?.process();
  await Promise.race([
    app?.close().catch(() => undefined) ?? Promise.resolve(),
    new Promise<void>((r) => setTimeout(r, 5_000)),
  ]);
  try {
    if (proc && !proc.killed) proc.kill('SIGKILL');
  } catch { /* already exited */ }
}

// ─── Navigation helpers ────────────────────────────────────────────────────────

async function navigateToEditorView(page: Page): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
}

/** Expand the Writing Coach GRS panel and open the in-panel chat (mirrors writing-assistant.spec.ts). */
async function openWritingCoachChat(page: Page): Promise<void> {
  await navigateToEditorView(page);

  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 8_000 });

  // A previous run may have left the hub inside the chat view already.
  const agentRow = page.locator('[aria-label="Open Writing Coach chat"]');
  if (await agentRow.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await agentRow.click();
  }
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });
}

// ─── Session picker helpers ─────────────────────────────────────────────────────

async function openPicker(page: Page): Promise<void> {
  const pill = page.locator('.asp-pill');
  if ((await pill.getAttribute('aria-expanded')) !== 'true') {
    await pill.click();
  }
  await expect(page.locator('.asp-dropdown')).toBeVisible({ timeout: 4_000 });
}

async function renameActiveSession(page: Page, newTitle: string): Promise<void> {
  await openPicker(page);
  const activeRow = page.locator('.asp-row--active');
  await activeRow.getByTitle('Rename').click();
  const input = page.locator('.asp-rename-input');
  await expect(input).toBeVisible({ timeout: 2_000 });
  await input.fill(newTitle);
  await input.press('Enter');
  await expect(page.locator('.asp-pill-label')).toHaveText(newTitle, { timeout: 4_000 });
}

async function startNewChat(page: Page): Promise<void> {
  await openPicker(page);
  await page.locator('.asp-new-btn').click();
}

async function switchToSession(page: Page, title: string): Promise<void> {
  await openPicker(page);
  await page.locator('.asp-row', { hasText: title }).locator('.asp-row-label').click();
  await expect(page.locator('.asp-pill-label')).toHaveText(title, { timeout: 4_000 });
}

/** Real IPC round-trip (renderer -> preload -> main -> vault disk), same call the app itself makes. */
async function listCoachSessions(page: Page): Promise<Array<{ id: string; title?: string }>> {
  const { sessions } = await page.evaluate(() => window.api!.agentSessions!.list('coach'));
  return sessions;
}

async function appendMarkerTurn(page: Page, sessionId: string, text: string): Promise<void> {
  await page.evaluate(
    async ({ id, marker }) => {
      await window.api!.agentSessions!.appendTurns(id, [
        { role: 'user', text: marker, at: new Date().toISOString() },
      ]);
    },
    { id: sessionId, marker: text },
  );
}

function messagesLocator(page: Page) {
  return page.locator('.writing-assistant-messages');
}

// ─── Test lifecycle ───────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ahsp-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ahsp-vault-'));
  seedUserData(userData, vaultDir);
});

test.afterAll(async () => {
  await closeApp(app);
  try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(vaultDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('TC-8537-01: the picker switches between two Writing Coach sessions and each renders its own real (vault-file) transcript', async () => {
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openWritingCoachChat(page);

  // The store auto-creates one session on first mount. Name it, then seed a
  // marker turn straight through the real appendTurns IPC (the same call
  // WritingAssistantPanel makes when a reply finishes) so this proves the
  // read path independently of any chat UI.
  await renameActiveSession(page, ALPHA_TITLE);
  const alphaId = (await listCoachSessions(page)).find((s) => s.title === ALPHA_TITLE)!.id;
  await appendMarkerTurn(page, alphaId, ALPHA_MARKER);

  // "+ New chat" creates and switches to a second session.
  await startNewChat(page);
  await renameActiveSession(page, BETA_TITLE);
  const betaId = (await listCoachSessions(page)).find((s) => s.title === BETA_TITLE)!.id;
  await appendMarkerTurn(page, betaId, BETA_MARKER);

  // Switching TO Alpha must hydrate ALPHA's turns from disk (written above
  // via a call that bypassed this renderer's in-memory store) and must NOT
  // show Beta's marker.
  await switchToSession(page, ALPHA_TITLE);
  await expect(messagesLocator(page)).toContainText(ALPHA_MARKER, { timeout: 8_000 });
  await expect(messagesLocator(page)).not.toContainText(BETA_MARKER);

  // Switching TO Beta must show only Beta's transcript.
  await switchToSession(page, BETA_TITLE);
  await expect(messagesLocator(page)).toContainText(BETA_MARKER, { timeout: 8_000 });
  await expect(messagesLocator(page)).not.toContainText(ALPHA_MARKER);

  // Cross-check on disk directly (mirrors TC-M20-04 in brainstorm.spec.ts):
  // the two markers must live in two DIFFERENT session files under
  // Sessions/, proving the write path (not just the UI) kept them isolated.
  const sessionsDir = path.join(vaultDir, 'Sessions');
  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.md'));
  const fileFor = (marker: string) =>
    files.find((f) => fs.readFileSync(path.join(sessionsDir, f), 'utf-8').includes(marker));
  const alphaFile = fileFor(ALPHA_MARKER);
  const betaFile = fileFor(BETA_MARKER);
  expect(alphaFile).toBeTruthy();
  expect(betaFile).toBeTruthy();
  expect(alphaFile).not.toBe(betaFile);

  await closeApp(app);
  app = undefined;
});

test('TC-8537-02: both sessions transcripts survive an app restart (fresh process reads real vault files)', async () => {
  app = await launchApp(userData);
  page = await firstWindow(app);
  await openWritingCoachChat(page);

  // Beta was updated last (its marker was appended after Alpha's), so a
  // fresh store picks it as the initial session — its transcript must come
  // straight off disk with no manual switch, proving persistence across
  // reopening without relying on which session happens to be "active".
  await expect(messagesLocator(page)).toContainText(BETA_MARKER, { timeout: 8_000 });
  await expect(page.locator('.asp-pill-label')).toHaveText(BETA_TITLE);

  // Switching to Alpha in this brand-new process (which has never read
  // Alpha's file before) must still hydrate its real persisted content.
  await switchToSession(page, ALPHA_TITLE);
  await expect(messagesLocator(page)).toContainText(ALPHA_MARKER, { timeout: 8_000 });
  await expect(messagesLocator(page)).not.toContainText(BETA_MARKER);

  await closeApp(app);
  app = undefined;
});
