// SKY-4712: full E2E coverage for cross-vault wiki-link navigation and graph scopes.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-07-01T00:00:00.000Z';

const STORY_ID = 'story-1';
const CHAPTER_ID = 'chapter-1';
const SCENE_ID = 'scene-one';
const SCENE_TITLE = 'Scene One';
const SCENE_PATH = 'Test Story/Manuscript/Chapter One/Scene One.md';
const ELARA_PATH = 'Characters/Elara.md';
const STORY_NODE_ID = `story:${STORY_ID}/${CHAPTER_ID}/${SCENE_ID}`;

function seedProject(userData: string, storyVaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Notes'), { recursive: true });

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      onboardingStartMode: 'skip',
      theme: 'dark',
      agents: {
        brainstorm: { enabled: false },
        writingAssistant: { enabled: false },
        archive: { enabled: false },
      },
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );

  const scene = {
    id: SCENE_ID,
    title: SCENE_TITLE,
    path: SCENE_PATH,
    order: 1,
    draftState: 'in-progress',
    blocks: [
      {
        id: 'block-1',
        type: 'prose',
        content: 'Meet [[Elara]]. Alias [[Elara|The Hero]]. Anchor [[Elara#background]]. Broken [[NonExistent]].',
        order: 1,
        updatedAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const chapter = {
    id: CHAPTER_ID,
    title: 'Chapter One',
    path: 'Test Story/Manuscript/Chapter One',
    order: 1,
    scenes: [scene],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const story = {
    id: STORY_ID,
    title: 'Test Story',
    path: 'Test Story',
    chapters: [chapter],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const elara = {
    id: 'entity-elara',
    name: 'Elara',
    type: 'character',
    path: ELARA_PATH,
    aliases: [],
    createdAt: NOW,
    updatedAt: NOW,
  };

  fs.writeFileSync(path.join(storyVaultDir, 'manifest.json'), JSON.stringify({
    version: '1.0.0',
    vaultRoot: storyVaultDir,
    stories: [story],
    chapters: [chapter],
    scenes: [scene],
    entities: [elara],
    suggestions: [],
  }, null, 2));

  const sceneBody = [
    '---',
    `id: ${SCENE_ID}`,
    `title: ${SCENE_TITLE}`,
    'order: 1',
    'draftState: in-progress',
    `createdAt: ${NOW}`,
    `updatedAt: ${NOW}`,
    '---',
    '',
    '<!-- BLOCKS_JSON',
    JSON.stringify(scene.blocks),
    'END_BLOCKS_JSON -->',
    '',
    scene.blocks[0].content,
  ].join('\n');
  fs.writeFileSync(path.join(storyVaultDir, SCENE_PATH), sceneBody, 'utf-8');
  fs.writeFileSync(
    path.join(notesVaultDir, ELARA_PATH),
    '---\ntitle: Elara\ntype: character\n---\n\n# Elara\n\n## Background\n\nElara profile. Graph points to [[Scene One]].',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(notesVaultDir, 'Notes', 'Scene Links.md'),
    '# Scene Links\n\nJump to [[Scene One]]. Another edge to [[Elara]].',
    'utf-8',
  );
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
  const page = await app.firstWindow();
  page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[data-testid="app-tab-bar"]')).toBeVisible({ timeout: 15_000 });
  return page;
}

async function openScene(page: Page): Promise<void> {
  await page.locator('[data-testid="app-tab-story"]').click();
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE }).first();
  await expect(sceneRow).toBeVisible({ timeout: 8_000 });
  await sceneRow.click();
  await expect(page.locator('.scene-name', { hasText: SCENE_TITLE })).toBeVisible({ timeout: 8_000 });
}

async function openSceneLinksNote(page: Page): Promise<void> {
  await page.locator('[data-testid="app-tab-notes"]').click();
  await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 8_000 });
  await page.getByText('Scene Links', { exact: true }).click();
  await expect(page.locator('.note-viewer-filename', { hasText: 'Scene Links.md' })).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('[data-testid="note-viewer-preview"]')).toBeVisible({ timeout: 8_000 });
}

async function openGraph(page: Page): Promise<void> {
  await page.locator('[data-testid="app-tab-notes"]').click();
  await page.locator('[data-testid="notes-subview-graph"]').click();
  await expect(page.locator('[data-testid="vault-graph-view"]')).toBeVisible({ timeout: 15_000 });
}

async function expectElaraNoteOpen(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="app-tab-notes"]')).toHaveAttribute('aria-selected', 'true', { timeout: 8_000 });
  await expect(page.locator('.note-viewer-filename', { hasText: 'Elara.md' })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText('Elara profile.')).toBeVisible({ timeout: 8_000 });
}

async function clickStoryWikiLink(page: Page, target: string): Promise<void> {
  await openScene(page);
  const wikiLink = page.locator(`[data-wiki-link="${target}"]`).first();
  if (await wikiLink.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await wikiLink.click();
    return;
  }
  await page.getByText(`[[${target}]]`, { exact: true }).click();
}

test.describe('wiki-links and multi-vault graph', () => {
  test.setTimeout(90_000);

  let tempRoot: string;
  let userData: string;
  let storyVaultDir: string;
  let notesVaultDir: string;
  let app: ElectronApplication;
  let page: Page;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wiki-links-'));
    userData = path.join(tempRoot, 'user-data');
    storyVaultDir = path.join(tempRoot, 'story-vault');
    notesVaultDir = path.join(tempRoot, 'notes-vault');
    seedProject(userData, storyVaultDir, notesVaultDir);
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterEach(async () => {
    await app?.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('[[Character Name]] in a story scene opens the Notes Vault entity', async () => {
    await clickStoryWikiLink(page, 'Elara');
    await expectElaraNoteOpen(page);
  });

  test('[[Scene One]] in a notes file opens the story scene editor', async () => {
    await openSceneLinksNote(page);
    await page.getByRole('button', { name: '[[Scene One]]' }).click();
    await expect(page.locator('[data-testid="app-tab-story"]')).toHaveAttribute('aria-selected', 'true', { timeout: 8_000 });
    await expect(page.locator('.scene-name', { hasText: SCENE_TITLE })).toBeVisible({ timeout: 8_000 });
  });

  test('graph scope Both shows story and note nodes', async () => {
    await openGraph(page);
    await page.locator('[data-testid="vault-graph-scope-both"]').click();
    await expect(page.getByRole('button', { name: /Open note Elara/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Open scene Scene One/i })).toBeVisible({ timeout: 10_000 });
  });

  test('clicking a graph story node opens the scene editor', async () => {
    await openGraph(page);
    await page.locator('[data-testid="vault-graph-scope-both"]').click();
    const sceneNode = page.getByRole('button', { name: /Open scene Scene One/i });
    await expect(sceneNode).toBeVisible({ timeout: 10_000 });
    await sceneNode.locator('[data-testid="vault-graph-node-circle"]').click();
    await expect(page.locator('[data-testid="app-tab-story"]')).toHaveAttribute('aria-selected', 'true', { timeout: 8_000 });
    await expect(page.locator('.scene-name', { hasText: SCENE_TITLE })).toBeVisible({ timeout: 8_000 });
  });

  test('[[NonExistent]] shows an unresolved wiki-link toast', async () => {
    await clickStoryWikiLink(page, 'NonExistent');
    await expect(page.locator('[data-testid="app-toast"]').filter({ hasText: 'No note or scene found' })).toBeVisible({ timeout: 8_000 });
  });

  test('[[Elara|The Hero]] resolves by stripping the alias suffix', async () => {
    await clickStoryWikiLink(page, 'Elara|The Hero');
    await expectElaraNoteOpen(page);
  });

  test('[[stem#heading]] resolves by stripping the heading anchor', async () => {
    await clickStoryWikiLink(page, 'Elara#background');
    await expectElaraNoteOpen(page);
  });

  test('graph defaults to Notes scope and hides story nodes for backward compatibility', async () => {
    await openGraph(page);
    await expect(page.locator('[data-testid="vault-graph-scope-notes"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /Open note Elara/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="vault-node-${STORY_NODE_ID}"]`)).toHaveCount(0);
  });
});
