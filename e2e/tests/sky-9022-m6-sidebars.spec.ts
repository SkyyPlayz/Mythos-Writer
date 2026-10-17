// SKY-9022 — EPIC M6 sidebars, updated for Slice B partner shell:
//   - Left sidebar three zones unchanged
//   - Right tabs: <partner> · Suggestions · Scenes · Notes & Analysis
//   - Partner tab: card + hands (no AGENTS list); Getting Started card inside
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

const STORY_ID = 'm6-e2e-story-0001';
const CHAPTER_ID = 'm6-e2e-chapter-0001';
const SCENE_ID = 'm6-e2e-scene-0001';
const STORY_TITLE = 'M6 Sidebar Story';

/**
 * Seeds a post-onboarding profile. rightSidebarVisible must be explicit:
 * the GRS only auto-opens via the real onboarding flow (main.ts sets it for
 * non-skip start modes), which these tests bypass with onboardingComplete.
 * Agents are seeded disabled so no scan ever attempts a network call.
 */
function seedUserData(userData: string, vaultDir: string, notesVaultDir: string, opts?: { seedStory?: boolean; omitRightSidebarVisible?: boolean }): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  const agentDefaults = { model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      ...(opts?.omitRightSidebarVisible ? {} : { rightSidebarVisible: true }),
      notesTabUpgradeToastShown: true,
      agents: {
        writingAssistant: { enabled: false, scanIntervalSeconds: 30, ...agentDefaults },
        brainstorm: { enabled: false, ...agentDefaults },
        archive: { enabled: false, continuityCheckIntervalSeconds: 60, ...agentDefaults },
      },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
  if (opts?.seedStory) {
    const now = new Date().toISOString();
    const sceneDir = path.join(vaultDir, 'stories', STORY_ID, 'chapters', CHAPTER_ID, 'scenes');
    fs.mkdirSync(sceneDir, { recursive: true });
    fs.writeFileSync(
      path.join(sceneDir, `${SCENE_ID}.md`),
      '---\ntitle: "The Gate"\n---\n\nShe crossed the threshold.\n',
      'utf8',
    );
    const manifest = {
      version: 1,
      stories: [{
        id: STORY_ID, title: STORY_TITLE, genre: 'Fantasy', path: `stories/${STORY_ID}`, order: 0,
        createdAt: now, updatedAt: now,
        chapters: [{
          id: CHAPTER_ID, title: 'Chapter One', storyId: STORY_ID, order: 0,
          createdAt: now, updatedAt: now,
          scenes: [{
            id: SCENE_ID, title: 'The Gate', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`,
            chapterId: CHAPTER_ID, storyId: STORY_ID, order: 0,
            draftState: 'in-progress', createdAt: now, updatedAt: now, blocks: [],
          }],
        }],
      }],
    };
    fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
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
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test.describe('SKY-9022/M6 — left sidebar (three zones only)', () => {
  let tempRoot: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-left-'));
    const userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'), { seedStory: true });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('[data-testid="left-rail"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('.nav-story-title', { hasText: STORY_TITLE }).click();
    await expect(page.locator('[data-testid="lr-story-card"]')).toBeVisible({ timeout: 8_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('renders exactly the three prototype zones', async () => {
    const rail = page.locator('[data-testid="left-rail"]');
    await expect(rail.locator('[data-testid="lr-story-card"]')).toBeVisible();
    await expect(rail.locator('[data-testid="lr-nav-zone"]')).toBeVisible();
    await expect(rail.locator('[data-testid="lr-project-footer"]')).toBeVisible();
    await expect(rail.locator('.lr-story-icon')).toBeVisible();
    await expect(rail.locator('.lr-story-title')).toBeVisible();
    await expect(rail.locator('.lr-story-meta')).toContainText(/·.*words/);
    await expect(rail.locator('.lr-progress-bar')).toBeVisible();
    await expect(rail.locator('.lr-nav-label')).toHaveText('STORY NAVIGATOR');
    await expect(rail.locator('.lr-nav-add')).toBeVisible();
    await expect(rail.locator('.lr-nav-collapse-btn')).toBeVisible();
    await expect(rail.locator('.nav-header')).toHaveCount(0);
    const sceneRow = rail.locator('.nav-scene-row').first();
    await expect(sceneRow.locator('.nav-scene-title')).toHaveText('Scene 1 · The Gate');
    await expect(sceneRow.locator('.nav-status-dot')).toBeVisible();
    await expect(rail.locator('.nav-draft-badge')).toHaveCount(0);
    await expect(rail.locator('.lr-footer-label')).toHaveText('PROJECT');
    const stats = rail.locator('.lr-stat-key');
    await expect(stats).toHaveText(['Words', 'Scenes', 'On Track']);
  });

  test('story-title click opens the first scene — Scene Analysis populates', async () => {
    const rail = page.locator('[data-testid="left-rail"]');
    await expect(rail.locator('.nav-scene-row.active .nav-scene-title')).toHaveText('Scene 1 · The Gate');
    // Slice B: Scene Analysis lives under Notes & Analysis.
    const hub = page.locator('[data-testid="agent-hub-panel"]');
    await hub.getByRole('tab', { name: 'Notes & Analysis' }).click();
    await expect(hub.locator('[data-testid="scene-analysis-rows"]')).toBeVisible({ timeout: 8_000 });
    await expect(hub.locator('.ahp-analysis-row-k', { hasText: 'Word Count' })).toBeVisible();
    await expect(hub.getByText('Open a scene to see analysis.')).toHaveCount(0);
  });

  test('no panel-system controls exist anywhere in the DOM', async () => {
    await expect(page.getByRole('button', { name: /^\+ Add Panel$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add panel$/i })).toHaveCount(0);
    await expect(page.locator('[data-panel-id]')).toHaveCount(0);
    await expect(page.getByText('⧉', { exact: true })).toHaveCount(0);
    await expect(page.getByText('⊞', { exact: true })).toHaveCount(0);
    await expect(page.locator('[draggable="true"][class*="panel"]')).toHaveCount(0);
  });
});

test.describe('SKY-9022/M6 — right sidebar partner shell (Slice B)', () => {
  let tempRoot: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-right-'));
    const userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'), { seedStory: true });
    app = await launchApp(userData);
    page = await firstWindow(app);
    await expect(page.locator('[data-testid="global-right-sidebar"]')).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('tab strip is Mythos · Suggestions · Scenes · Notes & Analysis', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    const tabs = grs.getByRole('tab');
    await expect(tabs).toHaveText(['Mythos', 'Suggestions', 'Scenes', 'Notes & Analysis']);
    await expect(grs.getByRole('tab', { name: 'Mythos' })).toHaveAttribute('aria-selected', 'true');
  });

  test('partner tab: card + action buttons; no AGENTS list / Suggestions hub card', async () => {
    const hub = page.locator('[data-testid="agent-hub-panel"]');
    await expect(hub.locator('[data-testid="ahp-partner-view"]')).toBeVisible({ timeout: 8_000 });
    await expect(hub.locator('[data-testid="partner-card"]')).toBeVisible();
    await expect(hub.locator('[data-testid="ahp-action-beta-read"]')).toBeVisible();
    await expect(hub.locator('[data-testid="ahp-action-continuity"]')).toBeVisible();
    await expect(hub.locator('[data-testid="ahp-action-notes-to-timeline"]')).toBeVisible();
    await expect(hub.locator('[data-testid="ahp-action-timeline-to-notes"]')).toBeVisible();
    await expect(hub.locator('[data-testid="ahp-hand-writer"]')).toHaveCount(0);
    await expect(hub.locator('[data-testid="ahp-hand-analyst"]')).toHaveCount(0);
    await expect(hub.locator('[data-testid="ahp-hand-archivist"]')).toHaveCount(0);
    await expect(hub.locator('section[aria-label="Agents"]')).toHaveCount(0);
    await expect(hub.locator('[data-testid="ahp-agent-row-writing-assistant"]')).toHaveCount(0);
  });

  test('Suggestions tab mounts the full review list', async () => {
    const hub = page.locator('[data-testid="agent-hub-panel"]');
    await hub.getByRole('tab', { name: 'Suggestions' }).click();
    await expect(hub.locator('[data-testid="ahp-suggestions-tab"]')).toBeVisible({ timeout: 8_000 });
    await expect(hub.locator('.suggestion-review')).toBeVisible({ timeout: 8_000 });
  });

  test('Notes & Analysis includes Scene Analysis + Questions-for-you', async () => {
    const hub = page.locator('[data-testid="agent-hub-panel"]');
    await hub.getByRole('tab', { name: 'Notes & Analysis' }).click();
    await expect(hub.locator('[data-testid="ahp-notes-analysis"]')).toBeVisible({ timeout: 8_000 });
    await expect(hub.locator('section[aria-label="Scene Analysis"]')).toBeVisible();
    await expect(hub.locator('[data-testid="questions-for-you"]')).toBeVisible();
  });

  test('exactly one Continuity header when Notes & Analysis is open', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await grs.getByRole('tab', { name: 'Notes & Analysis' }).click();
    const headers = grs.locator('.pc-header-title', { hasText: 'Continuity' });
    await expect(headers).toHaveCount(1);
  });
});

test.describe('SKY-9022/M6 — fresh profile: tab strip + Getting Started card', () => {
  let tempRoot: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m6-fresh-'));
    const userData = path.join(tempRoot, 'userData');
    seedUserData(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('tab strip is visible immediately; Getting Started panel deleted (F3#10)', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs).toBeVisible({ timeout: 15_000 });

    await expect(grs.getByRole('tab', { name: 'Mythos' })).toBeVisible({ timeout: 8_000 });
    await expect(grs.getByRole('tab', { name: 'Scenes' })).toBeVisible();

    const partner = grs.locator('[data-testid="ahp-partner-view"]');
    await expect(partner).toBeVisible({ timeout: 8_000 });
    await expect(partner.locator('[data-testid="gs-panel"]')).toHaveCount(0);
  });
});

test.describe('SKY-10499 — genuinely fresh profile (rightSidebarVisible unset)', () => {
  let tempRoot: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10499-fresh-'));
    const userData = path.join(tempRoot, 'userData');
    seedUserData(
      userData,
      path.join(tempRoot, 'story-vault'),
      path.join(tempRoot, 'notes-vault'),
      { omitRightSidebarVisible: true },
    );
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('tab strip renders, partner tabs are clickable, Getting Started never occupies the panel as gs-aside', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('.gs-aside')).toHaveCount(0);
    await expect(page.locator('aside.gs-aside')).toHaveCount(0);

    const tabNames = ['Mythos', 'Suggestions', 'Scenes', 'Notes & Analysis'];
    for (const name of tabNames) {
      const tab = grs.getByRole('tab', { name });
      await expect(tab).toBeVisible({ timeout: 8_000 });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }

    await grs.getByRole('tab', { name: 'Mythos' }).click();
    const partner = grs.locator('[data-testid="ahp-partner-view"]');
    await expect(partner).toBeVisible({ timeout: 8_000 });
    // F3#10: GettingStartedPanel deleted — never mount as gs-aside or gs-panel.
    await expect(partner.locator('[data-testid="gs-panel"]')).toHaveCount(0);
  });
});
