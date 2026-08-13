// SKY-9022 — EPIC M6: Sidebars to prototype spec, both sides (panel system
// removed; one Continuity header). Drives the real app and asserts the
// epic's acceptance checkboxes directly in the DOM:
//   - Left sidebar renders the three zones and nothing else; no panel
//     controls exist in the DOM.
//   - Right sidebar tab order matches the spec; exactly one Continuity
//     header.
//   - Fresh profile: tab strip visible immediately; Getting Started is a
//     card inside Assistant.
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
function seedUserData(userData: string, vaultDir: string, notesVaultDir: string, opts?: { seedStory?: boolean }): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  const agentDefaults = { model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      rightSidebarVisible: true,
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
    // Zone 1 (story card) is per-story chrome — select the seeded story first,
    // the same way a writer does from the navigator tree.
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
    // Story card: icon, title, "Genre · N words", progress bar, collapse «.
    await expect(rail.locator('.lr-story-icon')).toBeVisible();
    await expect(rail.locator('.lr-story-title')).toBeVisible();
    await expect(rail.locator('.lr-story-meta')).toContainText(/·.*words/);
    await expect(rail.locator('.lr-progress-bar')).toBeVisible();
    // Navigator: STORY NAVIGATOR label + add + collapse — and ONLY that
    // header (GAP-3: StoryNavigator's internal "Stories" header is gone).
    await expect(rail.locator('.lr-nav-label')).toHaveText('STORY NAVIGATOR');
    await expect(rail.locator('.lr-nav-add')).toBeVisible();
    await expect(rail.locator('.lr-nav-collapse-btn')).toBeVisible();
    await expect(rail.locator('.nav-header')).toHaveCount(0);
    // Scene rows: prototype anatomy (GAP-4) — `Scene N · Title` label,
    // word count, status dot; the old text draft badge is gone.
    const sceneRow = rail.locator('.nav-scene-row').first();
    await expect(sceneRow.locator('.nav-scene-title')).toHaveText('Scene 1 · The Gate');
    await expect(sceneRow.locator('.nav-status-dot')).toBeVisible();
    await expect(rail.locator('.nav-draft-badge')).toHaveCount(0);
    // Project footer: PROJECT label + Words / Scenes / On Track% trio.
    await expect(rail.locator('.lr-footer-label')).toHaveText('PROJECT');
    const stats = rail.locator('.lr-stat-key');
    await expect(stats).toHaveText(['Words', 'Scenes', 'On Track']);
  });

  // GAP-2 regression guard: the beforeAll story-title click was the exact
  // repro — the editor opened scene 1 while selectedScene stayed null, so
  // Scene Analysis sat on its empty state with a scene demonstrably open.
  test('story-title click opens the first scene — Scene Analysis populates', async () => {
    const rail = page.locator('[data-testid="left-rail"]');
    // The resolved scene is selected in the tree (GAP-4 selection chip)…
    await expect(rail.locator('.nav-scene-row.active .nav-scene-title')).toHaveText('Scene 1 · The Gate');
    // …and the right sidebar reads the same open scene.
    const hub = page.locator('[data-testid="agent-hub-panel"]');
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

test.describe('SKY-9022/M6 — right sidebar (tab order, single Continuity header)', () => {
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

  test('tab strip is Assistant · Scenes · Notes · References, in that order', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    const tabs = grs.getByRole('tab');
    await expect(tabs).toHaveText(['Assistant', 'Scenes', 'Notes', 'References']);
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Assistant tab order: AGENTS, Suggestions, Scene Analysis, Continuity, Research Quick Links', async () => {
    const hub = page.locator('[data-testid="agent-hub-panel"] .ahp-hub');
    const sectionEyebrows = hub.locator('.ahp-card-eyebrow');
    await expect(sectionEyebrows.first()).toHaveText('AGENTS', { timeout: 8_000 });

    // Five landmark sections, top to bottom, by their real accessible names
    // (aria-label on AGENTS/Suggestions/Scene Analysis/Research Quick Links;
    // the Continuity panel's own PanelHeader title for Continuity).
    const landmarks: Array<{ label: string; locator: ReturnType<Page['locator']> }> = [
      { label: 'AGENTS', locator: hub.locator('section[aria-label="Agents"]') },
      { label: 'Suggestions', locator: hub.locator('section[aria-label="Suggestions"]') },
      { label: 'SceneAnalysis', locator: hub.locator('section[aria-label="Scene Analysis"]') },
      { label: 'Continuity', locator: hub.locator('.pc-header-title', { hasText: 'Continuity' }) },
      { label: 'ResearchQuickLinks', locator: hub.locator('section[aria-label="Research Quick Links"]') },
    ];
    const tops: Array<{ label: string; top: number }> = [];
    for (const { label, locator } of landmarks) {
      await expect(locator).toBeVisible({ timeout: 8_000 });
      const box = await locator.boundingBox();
      if (!box) throw new Error(`${label} has no bounding box`);
      tops.push({ label, top: box.y });
    }
    const order = [...tops].sort((a, b) => a.top - b.top).map((t) => t.label);
    expect(order).toEqual(['AGENTS', 'Suggestions', 'SceneAnalysis', 'Continuity', 'ResearchQuickLinks']);
  });

  test('exactly one Continuity header in the DOM', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    const headers = grs.locator('.pc-header-title', { hasText: 'Continuity' });
    await expect(headers).toHaveCount(1);
  });

  // SKY-10057: "See All Suggestions" used to expand a panel-stack entry that
  // M6's removal of the panel system left with no rendered home — the button
  // was a same-tab no-op. It now drills into a self-contained Review Inbox
  // in place, mirroring the AGENTS row → agent chat swap.
  test('"See All Suggestions" opens the Review Inbox in place and Back returns to the hub', async () => {
    const hub = page.locator('[data-testid="agent-hub-panel"]');
    await expect(hub.locator('section[aria-label="Suggestions"]')).toBeVisible({ timeout: 8_000 });

    await hub.getByRole('button', { name: 'See All Suggestions' }).click();

    await expect(hub.locator('.ahp-chat-agent-name', { hasText: 'Review Inbox' })).toBeVisible({ timeout: 8_000 });
    await expect(hub.locator('.suggestion-review')).toBeVisible();
    await expect(hub.locator('section[aria-label="Suggestions"]')).toHaveCount(0);

    await hub.getByRole('button', { name: 'Back to agents' }).click();

    await expect(hub.locator('section[aria-label="Suggestions"]')).toBeVisible({ timeout: 8_000 });
    await expect(hub.locator('.suggestion-review')).toHaveCount(0);
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

  test('tab strip is visible immediately and Getting Started renders as a card inside Assistant', async () => {
    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs).toBeVisible({ timeout: 15_000 });

    // Tab strip visible immediately — never hidden behind Getting Started.
    await expect(grs.getByRole('tab', { name: 'Assistant' })).toBeVisible({ timeout: 8_000 });
    await expect(grs.getByRole('tab', { name: 'Scenes' })).toBeVisible();

    // Getting Started is the first child of the Assistant hub, not a
    // separate panel occupying the sidebar in place of the tabs.
    const hub = grs.locator('[data-testid="agent-hub-panel"] .ahp-hub');
    await expect(hub.locator('[data-testid="gs-panel"], .gs-card, [class*="getting-started"]').first())
      .toBeVisible({ timeout: 8_000 });
  });
});
