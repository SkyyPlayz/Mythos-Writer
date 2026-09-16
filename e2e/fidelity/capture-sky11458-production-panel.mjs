// SKY-11458 evidence capture: Beta Reader → Production Team tab with its chrome
// styled (the panel's classes had no CSS rules before this ticket, and the tab
// wrapper fell into the Reports page's 220px first grid column).
//
// Three shots from the real packaged renderer (electron-vite build, `_electron`,
// fresh userData): idle with an enabled role, after a mocked run with a review
// rendered, and with an OFF role selected. Modeled on
// capture-sky11221-beta-reader-consolidation.mjs; the Production Team path is
// the one e2e/sky-11412-production-roles-e2e.spec.ts drives.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

process.env.MYTHOS_DISABLE_BOOT_MIGRATION = '1';

requireBuild();
const OUT = outDir('capture-sky11458-production-panel');
const VIEWPORT = { width: 1440, height: 900 };

const STORY_ID = 'sky11458-story-0001';
const CHAPTER_ID = 'sky11458-chapter-0001';
const SCENE_ID = 'sky11458-scene-0001';
const SCENE_TITLE = 'Lighthouse Scene';
const SCENE_BODY = [
  'The old lighthouse stood at the edge of the cliff, its white-painted walls reflecting',
  'the last light of a dying sun. For twenty years, the keeper had climbed its spiral',
  'staircase every evening, carrying the heavy oil canisters that kept the beacon burning.',
].join('\n');

const MOCK_REVIEW = [
  'Opening image: the lighthouse against a dying sun lands — I saw it immediately.',
  '',
  'Where I slowed: "For twenty years" arrives before I know who the keeper is, so the',
  'weight of the habit hits a beat late. Consider a half-line of the keeper first.',
  '',
  'Where I stopped: nowhere yet. I want to know why tonight is different.',
].join('\n');

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11458-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11458-vault-'));
  const now = new Date().toISOString();

  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'SKY-11458 Evidence Story',
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
                blocks: [{ id: 'sky11458-block-0001', type: 'prose', content: SCENE_BODY, order: 0, updatedAt: now }],
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

  const budget = { maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, maxTokensPerDay: 500000 };
  const appSettings = {
    apiKey: 'sk-ant-test-key-for-e2e',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: true, model: 'claude-haiku-4-5-20251001', scanIntervalSeconds: 3600, autoApply: false, confidenceThreshold: 0.85, heartbeatIntervalMinutes: 60, ...budget },
      brainstorm: { enabled: false, model: 'claude-haiku-4-5-20251001', autoApply: false, confidenceThreshold: 0.85, heartbeatIntervalMinutes: 60, ...budget },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 3600, autoApply: false, confidenceThreshold: 0.85, heartbeatIntervalMinutes: 60, ...budget },
      betaReader: { enabled: true, model: 'claude-haiku-4-5-20251001', ...budget },
      // Two roles on, one off — the OFF state is part of what gets styled.
      alphaReader: { enabled: true, model: 'claude-haiku-4-5-20251001', ...budget },
      storylineConsultant: { enabled: true, model: 'claude-haiku-4-5-20251001', ...budget },
      lineEditor: { enabled: false, model: 'claude-haiku-4-5-20251001', ...budget },
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
    try { ipcMain.removeHandler('productionRole:run'); } catch { /* not yet registered */ }
    // A non-envelope object passes straight through unwrapIpcEnvelope.
    ipcMain.handle('productionRole:run', async () => {
      await new Promise((r) => setTimeout(r, 300));
      return { text: args.review };
    });
  }, { review: MOCK_REVIEW });
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

  // ── Agent hub → Beta Reader → Production Team tab ────────────────────────
  await page.locator('[data-testid="agent-hub-panel"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('[data-testid="ahp-agent-row-beta-reader"]').click();
  const overlay = page.locator('.beta-reader-overlay');
  await overlay.waitFor({ state: 'visible', timeout: 8000 });
  await overlay.getByRole('tab', { name: 'Production Team' }).click();
  const panel = page.locator('[data-testid="production-review-panel"]');
  await panel.waitFor({ state: 'visible', timeout: 5000 });

  // Proof the wrapper left the Reports grid: the panel spans the page, not 220px.
  const panelWidth = await panel.evaluate((el) => el.getBoundingClientRect().width);
  if (panelWidth < 600) throw new Error(`Production panel is only ${panelWidth}px wide — still in the Reports grid column?`);

  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '01-idle-alpha-reader.png') });

  // ── Run (mocked) → result card ───────────────────────────────────────────
  await overlay.locator('[data-testid="production-review-run"]').click();
  await overlay.locator('[data-testid="production-review-result"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '02-after-run-result.png') });

  // ── OFF role selected ────────────────────────────────────────────────────
  await overlay.getByLabel('Production role').selectOption('lineEditor');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '03-off-role-line-editor.png') });

  console.log(`Captured 3 shots to ${OUT} (panel width ${Math.round(panelWidth)}px)`);

  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
}

main().catch((err) => { console.error(err); process.exit(1); });
