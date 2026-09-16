// SKY-11221 evidence capture: Writing Assistant chat after removing the
// duplicate beta-read intercept. Typing "beta read this scene" now runs a
// normal assistant turn instead of silently switching to the old inline
// BetaReadPanel. Modeled on e2e/writing-assistant.spec.ts's TC-WA-17 setup.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

process.env.MYTHOS_DISABLE_BOOT_MIGRATION = '1';

requireBuild();
const OUT = outDir('capture-sky11221-beta-reader-consolidation');
const VIEWPORT = { width: 1440, height: 900 };

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

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11221-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11221-vault-'));
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
                blocks: [{ id: 'sky11221-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now }],
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

  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: true,
        model: 'claude-haiku-4-5-20251001',
        scanIntervalSeconds: 3600,
        autoApply: false,
        confidenceThreshold: 0.85,
        maxTokensPerHour: 100000,
        maxSuggestionsPerHour: 50,
        heartbeatIntervalMinutes: 60,
        maxTokensPerDay: 500000,
      },
      brainstorm: { enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 60, maxTokensPerDay: 500000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 3600, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 60, maxTokensPerDay: 500000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    rightSidebarVisible: true,
    rightSidebarPanels: [{ id: 'writing-assistant', collapsed: false }],
    notesTabUpgradeToastShown: true,
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

  return { userData, vaultDir };
}

async function installIpcMocks(app) {
  await app.evaluate(async ({ ipcMain }, args) => {
    const safeRemove = (ch) => { try { ipcMain.removeHandler(ch); } catch { /* not yet registered */ } };
    safeRemove('agent:writing-assistant');
    ipcMain.handle('agent:writing-assistant', async (event) => {
      for (const token of args.chatTokens) {
        await new Promise((r) => setTimeout(r, 60));
        if (!event.sender.isDestroyed()) event.sender.send('agent:writing-assistant:chunk', { chunk: token });
      }
      return { text: args.chatResponse };
    });
    // Kept registered so we can prove it is NOT invoked by this flow anymore.
    safeRemove('betaRead:scan');
    ipcMain.handle('betaRead:scan', async () => {
      throw new Error('betaRead:scan should not be invoked from the Writing Assistant chat anymore (SKY-11221)');
    });
  }, { chatTokens: MOCK_CHAT_TOKENS, chatResponse: MOCK_CHAT_RESPONSE });
}

async function main() {
  const { userData, vaultDir } = seedFixture();
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await installIpcMocks(app);

  // ── Navigate: rail → Story Writer → editor subview → scene row ──────────
  const nav = page.locator('nav[aria-label="Main navigation"]');
  const storyBtn = nav.locator('button[aria-label="Story Writer"]');
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') await storyBtn.click();
  const backdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await backdrop.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await page.locator('[data-testid="story-subview-editor"]').click().catch(() => {});
  await page.locator('.nav-story-row').first().waitFor({ state: 'visible', timeout: 20000 });
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await sceneRow.waitFor({ state: 'visible', timeout: 8000 });
  await sceneRow.click();

  // ── Open the Writing Coach agent row in the hub ──────────────────────────
  const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
  if (await hubPanel.isVisible({ timeout: 4000 }).catch(() => false)) {
    const agentRow = page.locator('[aria-label^="Open Writing Coach chat"]');
    if (await agentRow.isVisible({ timeout: 1000 }).catch(() => false)) await agentRow.click();
  }
  await page.locator('.writing-assistant-panel').waitFor({ state: 'attached', timeout: 8000 });

  // ── Type "beta read this scene" and submit ───────────────────────────────
  const input = page.getByRole('textbox', { name: 'Writing coach prompt' });
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill('beta read this scene');
  await input.press('Enter');

  // Proof: a normal user/assistant chat bubble pair appears...
  await page.locator('.wa-user-bubble', { hasText: 'beta read this scene' }).last().waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.wa-assistant-bubble', { hasText: MOCK_CHAT_RESPONSE }).last().waitFor({ state: 'visible', timeout: 8000 });
  // ...and the old inline beta-read panel never mounts.
  const brPanelCount = await page.locator('.br-panel').count();
  if (brPanelCount !== 0) throw new Error(`Expected 0 .br-panel elements post-consolidation, found ${brPanelCount}`);

  await page.waitForTimeout(500);
  const shotPath = path.join(OUT, 'writing-assistant-post-consolidation.png');
  await page.screenshot({ path: shotPath });
  console.log(`Captured ${shotPath} (br-panel count: ${brPanelCount})`);

  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
}

main().catch((err) => { console.error(err); process.exit(1); });
