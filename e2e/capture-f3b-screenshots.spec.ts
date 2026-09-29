/**
 * F3b VERIFY capture — real Electron 1440×900 screenshots for tip-freeze.
 * Not part of CI. Run after `npm run build:electron`:
 *   xvfb-run --auto-servernum npx playwright test e2e/capture-f3b-screenshots.spec.ts --reporter=list
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
/** Shield residual: never hardcode agent-store / artifacts paths. */
const OUT_DIR = process.env.MYTHOS_CAPTURE_DIR
  ? path.resolve(process.env.MYTHOS_CAPTURE_DIR)
  : path.join(os.tmpdir(), 'mythos-f3b-capture');
const ARTIFACTS = process.env.MYTHOS_CAPTURE_ARTIFACTS
  ? path.resolve(process.env.MYTHOS_CAPTURE_ARTIFACTS)
  : path.join(os.tmpdir(), 'mythos-f3b-artifacts');

const STORY_ID = 'f3b-story-0001';
const CHAPTER_ID = 'f3b-chapter-0001';
const SCENE_ID = 'f3b-scene-0001';

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  ensureDir(ARTIFACTS);
  const file = `${name}.png`;
  await page.setViewportSize({ width: 1440, height: 900 });
  // Electron BrowserWindow may ignore viewport; also resize the window.
  const win = page;
  await win.evaluate(() => {
    /* no-op — window size set via CDP below */
  }).catch(() => undefined);
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
  fs.copyFileSync(path.join(OUT_DIR, file), path.join(ARTIFACTS, file));
  console.log(`  wrote ${file}`);
}

async function resizeWindow(app: ElectronApplication, w: number, h: number) {
  await app.evaluate(async ({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.setContentSize(size.w, size.h);
    win.center();
  }, { w, h });
}

async function launchFresh(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    env: { ...process.env, HOME: userData, MYTHOS_E2E: '1' },
    timeout: 60_000,
  });
}

function seedOnboarded(userData: string, vaultDir: string) {
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'F3b Evidence Story',
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
    ['---', `id: ${SCENE_ID}`, 'title: "Harbor Scene"', `updatedAt: ${now}`, '---', '', 'Fog rolled over the harbor.', ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      apiKey: 'sk-ant-e2e-f3b',
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
        brainstorm: {
          enabled: false,
          model: 'claude-haiku-4-5-20251001',
          autoApply: false,
          confidenceThreshold: 0.85,
          maxTokensPerHour: 100_000,
          maxSuggestionsPerHour: 50,
          heartbeatIntervalMinutes: 5,
          maxTokensPerDay: 500_000,
        },
        archive: {
          enabled: false,
          model: 'claude-sonnet-4-6',
          continuityCheckIntervalSeconds: 60,
          autoApply: false,
          confidenceThreshold: 0.85,
          maxTokensPerHour: 100_000,
          maxSuggestionsPerHour: 50,
          heartbeatIntervalMinutes: 5,
          maxTokensPerDay: 500_000,
        },
      },
      theme: 'dark',
      rightSidebarVisible: true,
      rightSidebarWidth: 420,
      notesTabUpgradeToastShown: true,
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir }, null, 2),
  );
}

test.describe('F3b VERIFY screenshots 1440×900', () => {
  test('welcome overlay + cancel stays on overlay', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f3b-welcome-'));
    const app = await launchFresh(userData);
    try {
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.waitForLoadState('domcontentloaded');
      await resizeWindow(app, 1440, 900);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('desktop-shell')).toHaveCount(0);
      await shot(page, 'f3b-welcome-1440x900');

      await page.getByTestId('welcome-path-template').click();
      await expect(page.getByRole('dialog', { name: 'Create a Mythos vault' })).toBeVisible({
        timeout: 15_000,
      });
      await shot(page, 'f3b-welcome-create-modal-1440x900');

      await page.getByTestId('create-vault-cancel').click();
      await expect(page.getByRole('dialog', { name: 'Create a Mythos vault' })).toHaveCount(0);
      await expect(page.getByTestId('welcome-overlay')).toBeVisible();
      await expect(page.getByTestId('desktop-shell')).toHaveCount(0);
      // Wait for setupBusy clear + card opacity transition (cards not dimmed).
      await expect(page.getByTestId('welcome-overlay')).not.toHaveAttribute('data-setup-busy', 'true');
      const templateCard = page.getByTestId('welcome-path-template');
      await expect(templateCard).toBeEnabled();
      await expect(templateCard).toHaveCSS('opacity', '1');
      await shot(page, 'f3b-welcome-after-cancel-1440x900');
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test('agent hub single avatar + WP confidence slider', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f3b-hub-'));
    const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f3b-vault-'));
    seedOnboarded(userData, vaultDir);
    const app = await launchFresh(userData);
    try {
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.waitForLoadState('domcontentloaded');
      await resizeWindow(app, 1440, 900);

      await expect(page.getByTestId('desktop-shell')).toBeVisible({ timeout: 60_000 });
      await clickStoryNav(page);
      await page.locator('[data-testid="story-subview-editor"]').click();
      await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
      const sceneRow = page.locator('.nav-scene-row', { hasText: 'Harbor Scene' });
      await expect(sceneRow).toBeVisible({ timeout: 8_000 });
      await sceneRow.click();

      await page.locator('[data-testid="ahp-tab-partner"]').click().catch(() => undefined);
      await expect(page.locator('[data-testid="agent-hub-panel"]')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('partner-avatar')).toHaveCount(1);
      await shot(page, 'f3b-agent-single-avatar-1440x900');

      await page.locator('.app-menu-gear-btn').click();
      await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({
        timeout: 5_000,
      });
      const partnerTab = page.locator(
        '.settings-cat-nav__tab, [data-testid="settings-cat-writingPartner"], button',
        { hasText: /Writing Partner|Partner/i },
      ).first();
      await partnerTab.click();
      await expect(page.getByTestId('wp-confidence')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('wp-confidence').scrollIntoViewIfNeeded();
      await shot(page, 'f3b-wp-confidence-1440x900');
    } finally {
      await app.close();
      fs.rmSync(userData, { recursive: true, force: true });
      fs.rmSync(vaultDir, { recursive: true, force: true });
    }
  });
});
