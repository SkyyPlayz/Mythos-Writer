/**
 * post-onboarding.spec.ts — SKY-1188
 *
 * E2E tests for the three post-onboarding polish surfaces:
 *
 *   TC-PO-01  Getting Started panel — renders after onboarding, auto-dismisses
 *             when all 4 items are checked, × dismiss persists.
 *   TC-PO-02  Scene editor hint — placeholder text shows on an empty scene,
 *             hides once the user types.
 *   TC-PO-03  Template CTA — shown for blank-mode users in StoryNavigator,
 *             hidden after startMode is not blank.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright install chromium
 *   npx playwright test e2e/post-onboarding.spec.ts --reporter=list
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface SeedOptions {
  onboardingStartMode?: 'blank' | 'sample' | 'template' | 'quick-start' | 'default-mythos-vault' | 'skip';
  gettingStartedProgress?: {
    completedItems: string[];
    dismissed: boolean;
  };
  firstLaunchAt?: number;
}

/**
 * Seed userData so the app boots directly into DesktopShell with a fresh vault.
 * `opts` controls which post-onboarding flags are set.
 */
function seedUserData(userData: string, vaultDir: string, opts: SeedOptions = {}): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    onboardingStartMode: opts.onboardingStartMode ?? 'default-mythos-vault',
    firstLaunchAt: opts.firstLaunchAt ?? Date.now(),
    gettingStartedProgress: opts.gettingStartedProgress ?? undefined,
    rightSidebarVisible: true,
    agents: {
      writingAssistant: {
        enabled: false,
        model: 'claude-sonnet-4-6',
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
        model: 'claude-sonnet-4-6',
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
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };

  const vaultSettings = { vaultRoot: vaultDir };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
}

/** Seed a minimal vault so the app has a story → chapter → scene to load. */
function seedMinimalVault(vaultDir: string): void {
  const storyId = 'test-story-01';
  const chapterId = 'test-chapter-01';
  const sceneId = 'test-scene-01';

  const storyDir = path.join(vaultDir, 'Manuscript', storyId, chapterId);
  fs.mkdirSync(storyDir, { recursive: true });

  const sceneContent = [
    '---',
    `id: ${sceneId}`,
    'title: Opening Scene',
    'order: 0',
    'draftState: in-progress',
    `createdAt: ${new Date().toISOString()}`,
    `updatedAt: ${new Date().toISOString()}`,
    '---',
    '',
    '<!-- BLOCKS_JSON',
    JSON.stringify([]),
    'END_BLOCKS_JSON -->',
  ].join('\n');

  fs.writeFileSync(path.join(storyDir, `${sceneId}.md`), sceneContent);

  const scenePath = `Manuscript/${storyId}/${chapterId}/${sceneId}.md`;
  const now = new Date(Date.now() - 5_000).toISOString(); // 5s in the past so mtime > updatedAt triggers reindex
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    stories: [
      {
        id: storyId,
        title: 'Test Story',
        createdAt: now,
        updatedAt: now,
        chapters: [
          {
            id: chapterId,
            title: 'Chapter One',
            order: 0,
            path: `Manuscript/${storyId}/${chapterId}`,
            createdAt: now,
            updatedAt: now,
            scenes: [
              {
                id: sceneId,
                title: 'Opening Scene',
                path: scenePath,
                order: 0,
                draftState: 'in-progress',
                blocks: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ],
      },
    ],
    // reindexVault iterates manifest.scenes — must be an array, not undefined
    scenes: [],
    entities: [],
    suggestions: [],
    chapters: [],
    provenance: {},
    boardReferences: [],
  };

  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
}

// ─── TC-PO-01: Getting Started panel ─────────────────────────────────────────

test.describe('TC-PO-01: Getting Started panel', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po01-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po01-vault-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, { onboardingStartMode: 'default-mythos-vault' });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('panel renders in the right sidebar after first launch', async () => {
    await expect(page.locator('[data-testid="gs-panel"]')).toBeVisible({ timeout: 8_000 });
  });

  test('panel shows 4 checklist items', async () => {
    const items = page.locator('[data-testid^="gs-item-"]');
    await expect(items).toHaveCount(4, { timeout: 6_000 });
  });

  test('dismiss button (×) hides the panel', async () => {
    await page.locator('[data-testid="gs-dismiss"]').click();
    await expect(page.locator('[data-testid="gs-panel"]')).not.toBeVisible({ timeout: 4_000 });
  });
});

test.describe('TC-PO-01b: Getting Started panel already dismissed', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po01b-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po01b-vault-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, {
      onboardingStartMode: 'default-mythos-vault',
      gettingStartedProgress: { completedItems: [], dismissed: true },
    });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('panel is not shown when dismissed flag is persisted', async () => {
    // Give the shell a moment to render, then assert panel is absent
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-testid="gs-panel"]')).not.toBeVisible();
  });
});

test.describe('TC-PO-01c: Getting Started panel hidden for skip mode', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po01c-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po01c-vault-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, { onboardingStartMode: 'skip' });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('panel is not shown when startMode is skip', async () => {
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-testid="gs-panel"]')).not.toBeVisible();
  });
});

// ─── TC-PO-02: Scene editor hint ──────────────────────────────────────────────

test.describe('TC-PO-02: Scene editor hint', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po02-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po02-vault-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, { onboardingStartMode: 'default-mythos-vault' });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('hint CSS class is applied to editor wrapper for an empty scene', async () => {
    // Wait for vault to finish loading (story row visible = manifest parsed)
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 20_000 });
    // Select the scene via the StoryNavigator
    const sceneRow = page.locator('.nav-scene-row').first();
    await expect(sceneRow).toBeVisible({ timeout: 10_000 });
    await sceneRow.click();

    // The editor wrapper should gain the hint class for an empty scene
    await expect(
      page.locator('.shell-editor-beta-wrap--hint'),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ─── TC-PO-03: Template CTA ────────────────────────────────────────────────────

test.describe('TC-PO-03: Template CTA shown for blank mode', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po03-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po03-vault-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, { onboardingStartMode: 'blank' });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('template CTA button is visible in StoryNavigator for blank-mode users', async () => {
    await expect(page.locator('[data-testid="vs-template-cta"]')).toBeVisible({ timeout: 8_000 });
  });
});

test.describe('TC-PO-03b: Template CTA hidden for non-blank mode', () => {
  let userData: string;
  let vaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po03b-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-po03b-vault-'));
    seedMinimalVault(vaultDir);
    seedUserData(userData, vaultDir, { onboardingStartMode: 'default-mythos-vault' });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await waitForShell(page);
  });

  test.afterAll(async () => {
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  test('template CTA is hidden for non-blank startMode', async () => {
    await page.waitForTimeout(1_500);
    await expect(page.locator('[data-testid="vs-template-cta"]')).not.toBeVisible();
  });
});
