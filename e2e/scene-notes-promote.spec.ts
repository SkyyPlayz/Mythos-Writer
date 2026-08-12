/**
 * scene-notes-promote.spec.ts — SKY-9823 (M9b, EPIC M9 SKY-9023)
 *
 * SCENE NOTES pinned to the open scene: add, persist, drag-promote to vault.
 * Runs against the real Electron app + real filesystem (no mocked window.api):
 * renderer → notes:get/notes:set IPC → SQLite for the pinned list, and
 * renderer → notesVault:write IPC → a real .md file on disk for the promote.
 *
 * Coverage (PLAN.md §M9 item 2 acceptance):
 *   SN-01  Add a scene note      — card appears, input clears
 *   SN-02  Persist               — full app relaunch, note card still pinned
 *   SN-03  Drag-promote to vault — drag the card onto the story navigator;
 *                                  the promoted .md EXISTS IN THE NOTES VAULT
 *                                  ON DISK with the note text + frontmatter,
 *                                  and the card is unpinned from the scene
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/scene-notes-promote.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const NOTE_TEXT = 'Foreshadow the Lamplighter in the crowd scene';
const PROMOTED_FILE = `${NOTE_TEXT}.md`;

const SID = 'snp-story';
const CID = 'snp-c1';
const SC = 'snp-s1';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const agentDefaults = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
  };
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    // Without an explicit value the right sidebar does not render at all
    // (SKY-1686: undefined = hidden for legacy E2E layouts).
    rightSidebarVisible: true,
    agents: {
      writingAssistant: { ...agentDefaults, scanIntervalSeconds: 30 },
      brainstorm: { ...agentDefaults },
      archive: { ...agentDefaults, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedStoryVault(vaultDir: string): void {
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{
      id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, createdAt: now, updatedAt: now,
      chapters: [{
        id: CID, title: 'Fractures', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: now, updatedAt: now,
        scenes: [{
          id: SC, title: 'Into the Undercity', order: 0, chapterId: CID, storyId: SID,
          path: `stories/${SID}/chapters/${CID}/scenes/${SC}.md`, draftState: 'in-progress',
          createdAt: now, updatedAt: now,
          blocks: [{ id: `${SC}-b`, type: 'prose', content: 'The stairwell yawned like a throat.', order: 0, updatedAt: now }],
        }],
      }],
    }],
    entities: [], suggestions: [], scenes: [], chapters: [],
  }, null, 2));
  const sceneDir = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${SC}.md`), [
    '---', `id: ${SC}`, 'title: "Into the Undercity"', 'draftState: in-progress', '---', '',
    'The stairwell yawned like a throat.', '',
  ].join('\n'));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
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
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/**
 * Dismiss first-run overlays, open the seeded scene from the navigator, then
 * switch the right panel (AgentHubPanel) to its Notes tab.
 */
async function openSceneNotesTab(pg: Page): Promise<void> {
  await pg.waitForTimeout(2500);
  for (const label of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
    const b = pg.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible({ timeout: 500 }).catch(() => false)) {
      await b.click().catch(() => {});
      await pg.waitForTimeout(300);
    }
  }
  await pg.keyboard.press('Escape').catch(() => {});
  const row = pg.locator('.nav-scene-row', { hasText: 'Into the Undercity' }).first();
  await row.waitFor({ state: 'visible', timeout: 20_000 });
  await row.click({ force: true });
  const notesTab = pg.locator('.ahp-tab', { hasText: 'Notes' });
  await notesTab.waitFor({ state: 'visible', timeout: 15_000 });
  await notesTab.click();
  await pg.locator('input[aria-label="New scene note"]').waitFor({ state: 'visible', timeout: 10_000 });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000, intervalMs = 150): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

test.describe('SKY-9823 — scene notes: add, persist, drag-promote to vault', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);

  let userData: string;
  let vaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-snp-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-snp-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-snp-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    seedStoryVault(vaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openSceneNotesTab(page);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    for (const dir of [userData, vaultDir, notesVaultDir]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('SN-01: Add pins a note card to the open scene', async () => {
    const input = page.locator('input[aria-label="New scene note"]');
    await input.fill(NOTE_TEXT);
    await page.locator('.snp-add-btn').click();
    const card = page.locator('[data-testid="snp-note"]', { hasText: NOTE_TEXT });
    await expect(card).toBeVisible();
    await expect(input).toHaveValue('');
    // The prototype's pinned-notes copy is present verbatim.
    await expect(page.locator('.snp-hint')).toContainText(
      'Pinned to this scene — promote a note to the vault by dragging it onto the navigator.',
    );
  });

  test('SN-02: the note survives a full app relaunch', async () => {
    await app.close();
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openSceneNotesTab(page);
    await expect(page.locator('[data-testid="snp-note"]', { hasText: NOTE_TEXT })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('SN-03: drag-promote onto the navigator writes a real vault file on disk', async () => {
    const card = page.locator('[data-testid="snp-note"]', { hasText: NOTE_TEXT });
    await card.waitFor({ state: 'visible', timeout: 10_000 });

    // One DataTransfer across the whole gesture: dragstart populates it via the
    // panel's real handler; drop hands it to StoryNavigator's real drop handler.
    await page.evaluate(() => {
      const cardEl = document.querySelector('[data-testid="snp-note"]');
      const nav = document.querySelector('.story-navigator');
      if (!cardEl || !nav) throw new Error('drag source or navigator target missing');
      const dt = new DataTransfer();
      cardEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      nav.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      nav.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      cardEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    });

    // THE acceptance assertion: the promoted note file exists in the notes
    // vault on disk (renderer → notesVault:write IPC → main → fs).
    const promotedPath = path.join(notesVaultDir, PROMOTED_FILE);
    expect(await waitUntil(() => fs.existsSync(promotedPath), 15_000)).toBe(true);
    const content = fs.readFileSync(promotedPath, 'utf-8');
    expect(content).toContain(NOTE_TEXT);
    expect(content).toContain('source: promoted-scene-note');
    expect(content).toContain('scene: "Into the Undercity"');

    // Vault write precedes unpin (SKY-5154 ordering), so the card disappearing
    // proves the whole promote flow completed.
    await expect(page.locator('[data-testid="snp-note"]', { hasText: NOTE_TEXT })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
