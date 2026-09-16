/**
 * capture-sky-11221-screenshot.spec.ts — SKY-11221 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots for the
 * Beta Reader consolidation fix: the Writing Assistant's duplicate inline
 * "beta read" intercept (BetaReadPanel, `br-panel` / `betaRead:scan`) was
 * deleted. Beta Reader is now the single canonical agent, reachable only
 * from the Agent Hub's "Beta Reader" row → BetaReaderPage overlay.
 *
 *   1. beta-reader-agent-panel — Agent Hub → click the "Beta Reader" row →
 *      BetaReaderPage renders its real Reports panel (history rail, score
 *      chips empty-state, Run-a-Beta-Read card) — not a stub, not a second
 *      competing implementation.
 *   2. writing-assistant-beta-read-normal-turn — typing "beta read this
 *      scene" into the Writing Assistant chat now runs a normal assistant
 *      turn (plain streamed reply) instead of switching to the old inline
 *      Beta-Read engine — there is no `.br-panel` in this build at all.
 *
 * Output: pr-screenshots/sky-11221-beta-reader-consolidation/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-11221-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11221-beta-reader-consolidation');

const STORY_ID = 'sky11221-story-0001';
const CHAPTER_ID = 'sky11221-chapter-0001';
const SCENE_ID = 'sky11221-scene-0001';
const SCENE_TITLE = 'Lighthouse Scene';
const SCENE_BODY = [
  'The old lighthouse stood at the edge of the cliff, its white-painted walls reflecting',
  'the last light of a dying sun. For twenty years, the keeper had climbed its spiral',
  'staircase every evening, carrying the heavy oil canisters that kept the beacon burning.',
].join('\n');

const MOCK_CHAT_TOKENS = ['Sure — ', 'here is a read on pacing ', 'for this scene.'];
const MOCK_CHAT_RESPONSE = MOCK_CHAT_TOKENS.join('');

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
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
        title: 'SKY-11221 Evidence Story',
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

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: 'sk-ant-e2e-sky11221',
    onboardingComplete: true,
    theme: 'dark',
    rightSidebarVisible: true,
    rightSidebarWidth: 420,
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
    },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

async function clickStoryNav(page: Page): Promise<void> {
  const nav = page.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 10_000 });
  const storyBtn = nav.locator('button[aria-label="Story Writer"]');
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

async function openScene(page: Page, sceneTitle: string): Promise<void> {
  await clickStoryNav(page);
  await page.locator('[data-testid="story-subview-editor"]').click();
  await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: sceneTitle });
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
}

/** Install a real chat-turn mock on the `agent:writing-assistant` IPC channel
 *  (same seam TC-WA-17 used to assert the old betaRead:scan intercept never
 *  fired). Nothing on the beta-read side is mocked because nothing beta-read
 *  shaped exists in this build any more. */
async function installChatMock(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain }, args: { chatTokens: string[]; chatResponse: string }) => {
    try { ipcMain.removeHandler('agent:writing-assistant'); } catch { /* not registered */ }
    ipcMain.handle('agent:writing-assistant', async (event) => {
      for (const token of args.chatTokens) {
        await new Promise<void>((r) => setTimeout(r, 40));
        if (!event.sender.isDestroyed()) {
          event.sender.send('agent:writing-assistant:chunk', { chunk: token });
        }
      }
      return { text: args.chatResponse };
    });
  }, { chatTokens: MOCK_CHAT_TOKENS, chatResponse: MOCK_CHAT_RESPONSE });
}

test('capture SKY-11221 beta reader consolidation screenshots', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11221-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11221-vault-'));
  seedUserData(userData, vaultDir);

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  await installChatMock(app);

  const page: Page = await app.firstWindow();
  page.on('dialog', (dialog) => void dialog.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await applyTheme(page);

  await openScene(page, SCENE_TITLE);

  // ── 1. Agent Hub → Beta Reader row → BetaReaderPage (the single canonical
  //    agent surface post-consolidation, not a stub). ─────────────────────
  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  await expect(hubPanel).toBeVisible({ timeout: 8_000 });

  const betaRow = page.locator('[data-testid="ahp-agent-row-beta-reader"]');
  await expect(betaRow).toBeVisible({ timeout: 8_000 });
  await betaRow.click();

  const betaOverlay = page.locator('.beta-reader-overlay');
  await expect(betaOverlay).toBeVisible({ timeout: 8_000 });
  // The real panel, not a placeholder: header title, Reports/Chat tabs, and
  // the "Run a Beta Read" card must all be present.
  await expect(betaOverlay.locator('.beta-reader-run-card')).toBeVisible({ timeout: 5_000 });
  await expect(betaOverlay.getByRole('tab', { name: 'Reports' })).toBeVisible();
  await expect(betaOverlay.getByRole('tab', { name: 'Chat' })).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '1-beta-reader-agent-panel');

  await betaOverlay.locator('.beta-reader-close').click();
  await expect(betaOverlay).toBeHidden({ timeout: 5_000 });

  // ── 2. Writing Assistant chat: "beta read this scene" is now just a
  //    normal assistant turn — no second engine, no `.br-panel` intercept. ──
  const waRow = page.locator('[aria-label^="Open Writing Coach chat"]');
  if (await waRow.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await waRow.click();
  }
  await expect(page.locator('.writing-assistant-panel')).toBeAttached({ timeout: 8_000 });

  const input = page.getByRole('textbox', { name: 'Writing coach prompt' });
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeEnabled({ timeout: 5_000 });
  await expect(async () => {
    await input.fill('beta read this scene');
    await expect(input).toHaveValue('beta read this scene', { timeout: 500 });
  }).toPass({ timeout: 5_000 });
  await input.press('Enter');

  // No beta-read intercept UI exists any more — this must never appear.
  await expect(page.locator('.br-panel')).toHaveCount(0);

  const assistantReply = page.locator('.wa-message-assistant', { hasText: MOCK_CHAT_RESPONSE });
  await expect(assistantReply).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.br-panel')).toHaveCount(0);
  await page.waitForTimeout(300);
  await shot(page, '2-writing-assistant-beta-read-normal-turn');

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
});
