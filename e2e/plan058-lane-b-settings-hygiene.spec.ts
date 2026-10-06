/**
 * PLAN-058 Lane B — settings-write hygiene (B-1 layout flag, B-2 legacy-key Settings close).
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
import { openSettingsDialog, closeSettingsDialog } from './helpers/aiOffSuite';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

const STORY_ID = 'plan058-b2-story';
const CHAPTER_ID = 'plan058-b2-chapter';
const SCENE_ID = 'plan058-b2-scene';

function agentBlock() {
  return {
    writingAssistant: {
      enabled: false,
      model: '',
      scanIntervalSeconds: 30,
      autoApply: false,
      confidenceThreshold: 0.85,
      maxTokensPerHour: 100_000,
      maxSuggestionsPerHour: 50,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 500_000,
    },
    brainstorm: {
      enabled: false,
      model: '',
      autoApply: false,
      confidenceThreshold: 0.85,
      maxTokensPerHour: 100_000,
      maxSuggestionsPerHour: 50,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 500_000,
    },
    archive: {
      enabled: false,
      model: '',
      continuityCheckIntervalSeconds: 60,
      autoApply: false,
      confidenceThreshold: 0.85,
      maxTokensPerHour: 100_000,
      maxSuggestionsPerHour: 50,
      heartbeatIntervalMinutes: 5,
      maxTokensPerDay: 500_000,
    },
  };
}

function seedVault(userData: string, vaultDir: string, settings: Record<string, unknown>): void {
  const now = new Date().toISOString();
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [
      {
        id: STORY_ID,
        title: 'Plan058 B2 Story',
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
                title: 'Scene',
                path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
                order: 0,
                chapterId: CHAPTER_ID,
                storyId: STORY_ID,
                blocks: [{ id: 'b1', type: 'prose', content: 'Hello from plan058 B2.', order: 0, updatedAt: now }],
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
    ['---', `id: ${SCENE_ID}`, 'title: Scene', `updatedAt: ${now}`, '---', '', 'Hello from plan058 B2.', ''].join('\n'),
  );
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: vaultDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined); });
  await page.waitForLoadState('domcontentloaded');
  return page;
}

function readAppSettings(userData: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8')) as Record<string, unknown>;
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
}

test.describe('PLAN-058 Lane B — settings-write hygiene', () => {
  test('B-1: layoutMigrationDone persists across relaunch', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-b1-'));
    const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-b1-vault-'));
    seedVault(userData, vaultDir, {
      apiKey: 'sk-ant-test-key-for-e2e',
      onboardingComplete: true,
      slice2AutonomyOffMigrated: true,
      notesTabUpgradeToastShown: true,
      rightSidebarVisible: true,
      agents: agentBlock(),
      theme: 'dark',
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    });

    let app = await launchApp(userData);
    const page = await firstWindow(app);
    await waitForShell(page);
    await page.waitForTimeout(1_500);

    const afterFirst = readAppSettings(userData);
    expect(afterFirst.layoutMigrationDone).toBe(true);
    expect(Array.isArray(afterFirst.workspaceLayouts)).toBe(true);
    expect((afterFirst.workspaceLayouts as unknown[]).length).toBeGreaterThanOrEqual(3);

    await app.close();

    app = await launchApp(userData);
    const page2 = await firstWindow(app);
    await waitForShell(page2);
    await page2.waitForTimeout(1_500);

    const afterRelaunch = readAppSettings(userData);
    expect(afterRelaunch.layoutMigrationDone).toBe(true);
    expect((afterRelaunch.workspaceLayouts as unknown[]).length).toBe(
      (afterFirst.workspaceLayouts as unknown[]).length,
    );

    await page2.screenshot({ path: path.join(userData, 'plan058-b1-shell.png') });
    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('B-2: Settings close on legacy-shaped profile does not write empty provider', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-b2-'));
    const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-b2-vault-'));
    // Legacy-shaped: no `provider` block; apiKey field empty after prior migration.
    seedVault(userData, vaultDir, {
      apiKey: '',
      onboardingComplete: true,
      slice2AutonomyOffMigrated: true,
      notesTabUpgradeToastShown: true,
      rightSidebarVisible: true,
      layoutMigrationDone: true,
      agents: agentBlock(),
      theme: 'dark',
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    });

    const app = await launchApp(userData);
    const page = await firstWindow(app);
    await waitForShell(page);

    await openSettingsDialog(page);
    await page.screenshot({
      path: '/opt/cursor/artifacts/screenshots/plan058-b2-settings-close.png',
    });
    await closeSettingsDialog(page);
    await page.waitForTimeout(800);

    const disk = readAppSettings(userData);
    expect(disk.provider).toBeUndefined();

    await app.close();
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });
});
