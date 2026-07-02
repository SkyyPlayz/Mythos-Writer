/**
 * continuity-peek.spec.ts — SKY-2012
 *
 * Selector map:
 *   Right sidebar tab:       .right-sidebar [role="tab"], label "Continuity"
 *   Continuity panel:        .continuity-panel
 *   Search input:            input[aria-label="Search entities in Notes Vault"]
 *   Entity card:             .entity-card[aria-label="<entity name>"]
 *   Type badge:              .entity-type-badge[aria-label="Type: <type>"]
 *   View-full-note button:   button[aria-label="View full note: <entity name>"]
 *   Focus overlay:           .continuity-focus-overlay[role="dialog"]
 *   Notes editor:            .note-viewer-editor
 *
 * Acceptance coverage:
 *   TC-CP-01  Continuity tab appears in the right sidebar
 *   TC-CP-02  Ctrl/Cmd+Shift+K opens/focuses the Continuity panel
 *   TC-CP-03  Selecting an entity name auto-populates its card
 *   TC-CP-04  Selecting an alias resolves to the entity card
 *   TC-CP-05  Selection lookup still works with 100 seeded entities
 *   TC-CP-06  Entity card content + View full note navigation
 *   TC-CP-07  Manual search by partial name shows results and selecting loads a card
 *   TC-CP-08  Shortcut-opened panel auto-focuses search
 *   TC-CP-09  Focus Mode uses a dismissible floating overlay
 *   TC-CP-10  Empty state when no selection/search is present
 *   TC-CP-11  Re-triggered lookup reads updated note content from disk
 *   TC-CP-12  Works with no AI provider/API key configured
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
const STORY_ID = 'cp-e2e-story-0001';
const CHAPTER_ID = 'cp-e2e-chapter-0001';
const SCENE_ID = 'cp-e2e-scene-0001';
const SCENE_TITLE = 'Continuity Peek Scene';
const INITIAL_SCENE_BODY = 'Marcus waits while the Duke studies the obsidian gate.';

const MARCUS_REL_PATH = path.join('Universes', 'E2E World', 'Characters', 'Marcus.md');
const DUKE_REL_PATH = path.join('Universes', 'E2E World', 'Characters', 'Duke Aurelius.md');

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeNote(notesVaultDir: string, relPath: string, body: string, frontmatter: Record<string, unknown>): void {
  const absPath = path.join(notesVaultDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const fmLines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.map((v) => JSON.stringify(v)).join(', ')}]`;
    return `${key}: ${String(value)}`;
  });
  fs.writeFileSync(absPath, ['---', ...fmLines, '---', '', body, ''].join('\n'));
}

function seedStoryVault(vaultDir: string): void {
  const now = new Date().toISOString();
  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [{
      id: STORY_ID,
      title: 'Continuity Peek E2E Story',
      path: `stories/${STORY_ID}`,
      chapters: [{
        id: CHAPTER_ID,
        title: 'Chapter One',
        path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`,
        order: 0,
        scenes: [{
          id: SCENE_ID,
          title: SCENE_TITLE,
          path: scenePath,
          order: 0,
          chapterId: CHAPTER_ID,
          storyId: STORY_ID,
          blocks: [{
            id: 'cp-e2e-block-0001',
            type: 'prose',
            content: INITIAL_SCENE_BODY,
            order: 0,
            updatedAt: now,
          }],
          draftState: 'in-progress',
          createdAt: now,
          updatedAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    }],
    entities: [],
    suggestions: [],
    provenance: {},
    boardReferences: [],
    scenes: [],
    chapters: [],
  };

  const sceneAbsPath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(sceneAbsPath), { recursive: true });
  fs.writeFileSync(sceneAbsPath, ['---', `id: ${SCENE_ID}`, `title: "${SCENE_TITLE}"`, 'draftState: in-progress', `updatedAt: ${now}`, '---', '', INITIAL_SCENE_BODY, ''].join('\n'));
  writeJson(path.join(vaultDir, 'manifest.json'), manifest);
}

function seedNotesVault(notesVaultDir: string): void {
  writeNote(
    notesVaultDir,
    MARCUS_REL_PATH,
    'Marcus is a principled cartographer from the glass coast. **He refuses** to abandon lost travelers. '.repeat(3),
    { type: 'character', aliases: ['Marc'] },
  );
  writeNote(
    notesVaultDir,
    DUKE_REL_PATH,
    'Aurelius rules the western marches and is known publicly as the Duke. He collects forbidden maps.',
    { type: 'character', aliases: ['the Duke'] },
  );

  for (let i = 0; i < 100; i += 1) {
    const name = `Perf Entity ${String(i).padStart(3, '0')}`;
    writeNote(
      notesVaultDir,
      path.join('Universes', 'E2E World', 'Characters', `${name}.md`),
      `${name} is seeded to exercise lookup scale without using AI.`,
      { type: 'character', aliases: [`perf-${i}`] },
    );
  }
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  writeJson(path.join(userData, 'app-settings.json'), appSettings);
  writeJson(path.join(userData, 'vault-settings.json'), {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
    layoutMode: 'blank',
  });
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
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function openSeededScene(page: Page): Promise<void> {
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible().catch(() => false)) await storiesTab.click();
  const sceneRow = page.locator('.nav-scene-row', { hasText: SCENE_TITLE });
  await expect(sceneRow).toBeVisible({ timeout: 10_000 });
  await sceneRow.click();
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
}

async function selectFirstChars(page: Page, charCount: number): Promise<void> {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Home' : 'Control+Home');
  for (let i = 0; i < charCount; i += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
}

async function selectWholeEditor(page: Page): Promise<void> {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
}

async function replaceSceneText(page: Page, text: string): Promise<void> {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.type(text);
  await expect(editor).toContainText(text, { timeout: 5_000 });
}

async function openContinuityWithShortcut(page: Page): Promise<void> {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+K' : 'Control+Shift+K');
  await expect(page.locator('.continuity-panel').first()).toBeVisible({ timeout: 6_000 });
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication | undefined;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp-user-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp-notes-'));
  seedStoryVault(vaultDir);
  seedNotesVault(notesVaultDir);
  seedUserData(userData, vaultDir, notesVaultDir);

  app = await launchApp(userData);
  page = await firstWindow(app);
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  await openSeededScene(page);
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-CP-01: with entity notes present, the Continuity tab appears in the right sidebar', async () => {
  await expect(page.locator('.right-sidebar [role="tab"]', { hasText: 'Continuity' })).toBeVisible({ timeout: 8_000 });
});

test('TC-CP-02 and TC-CP-08: Ctrl/Cmd+Shift+K opens Continuity and focuses search', async () => {
  await openContinuityWithShortcut(page);
  const continuityTab = page.locator('.right-sidebar [role="tab"]', { hasText: 'Continuity' });
  await expect(continuityTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('input[aria-label="Search entities in Notes Vault"]')).toBeFocused({ timeout: 4_000 });
});

test('TC-CP-10: empty state is shown with no selection and no search query', async () => {
  await openContinuityWithShortcut(page);
  const search = page.locator('input[aria-label="Search entities in Notes Vault"]');
  await search.fill('');
  await page.keyboard.press('Escape');
  await page.locator('.ProseMirror').click();
  await expect(page.locator('.continuity-panel')).toContainText('Select text in the editor');
});

test('TC-CP-03: selecting an entity name auto-populates a Marcus card', async () => {
  await openContinuityWithShortcut(page);
  await replaceSceneText(page, 'Marcus');
  await selectWholeEditor(page);
  const card = page.locator('.entity-card', { hasText: 'Marcus' }).first();
  await expect(card).toBeVisible({ timeout: 4_000 });
});

test('TC-CP-04: selecting an alias resolves to the aliased entity card', async () => {
  await openContinuityWithShortcut(page);
  await replaceSceneText(page, 'the Duke');
  await selectWholeEditor(page);
  const card = page.locator('.entity-card', { hasText: 'Duke Aurelius' }).first();
  await expect(card).toBeVisible({ timeout: 4_000 });
  await expect(card).toContainText('a.k.a. "the Duke"');
});

test('TC-CP-05: selection lookup works with 100 entities seeded', async () => {
  await openContinuityWithShortcut(page);
  await replaceSceneText(page, 'Perf Entity 099');
  await selectWholeEditor(page);
  const started = Date.now();
  const card = page.locator('.entity-card', { hasText: 'Perf Entity 099' }).first();
  await expect(card).toBeVisible({ timeout: 4_000 });
  expect(Date.now() - started).toBeLessThan(4_000);
});

test('TC-CP-06: entity card shows required fields and View full note opens the note', async () => {
  await openContinuityWithShortcut(page);
  await replaceSceneText(page, 'Marcus');
  await selectWholeEditor(page);
  const card = page.locator('.entity-card', { hasText: 'Marcus' }).first();
  await expect(card).toBeVisible({ timeout: 4_000 });
  await expect(card.locator('.entity-card-name')).toHaveText('Marcus');
  await expect(card.locator('.entity-type-badge')).toHaveText('character');
  await expect(card.locator('.entity-card-excerpt')).toContainText('Marcus is a principled cartographer');
  await expect(card.locator('.entity-card-excerpt')).not.toContainText('**');

  await card.getByRole('button', { name: 'View full note: Marcus' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page', { timeout: 6_000 });
  await expect(page.locator('.note-viewer-editor')).toContainText('Marcus is a principled cartographer', { timeout: 8_000 });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1');
  await openSeededScene(page);
  await openContinuityWithShortcut(page);
});

test('TC-CP-07: manual search returns partial-name matches and clicking a result loads its card', async () => {
  await openContinuityWithShortcut(page);
  const search = page.locator('input[aria-label="Search entities in Notes Vault"]');
  await search.fill('Marc');
  const result = page.locator('.entity-card', { hasText: 'Marcus' }).first();
  await expect(result).toBeVisible({ timeout: 4_000 });
  await result.click();
  await expect(page.locator('.continuity-section-label')).toContainText('Best match', { timeout: 4_000 });
  await expect(page.locator('.entity-card', { hasText: 'Marcus' }).first()).toBeVisible();
});

test('TC-CP-09: Focus Mode opens Continuity as a dismissible floating overlay', async () => {
  await page.locator('.ProseMirror').click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+F' : 'Control+Shift+F');
  await expect(page.locator('.desktop-shell')).toHaveClass(/writing-mode-focus/, { timeout: 4_000 });

  await openContinuityWithShortcut(page);
  const overlay = page.locator('.continuity-focus-overlay[role="dialog"]');
  await expect(overlay).toBeVisible({ timeout: 4_000 });
  await expect(page.locator('.shell-right')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(overlay).not.toBeVisible({ timeout: 4_000 });

  await openContinuityWithShortcut(page);
  await expect(overlay).toBeVisible({ timeout: 4_000 });
  await page.mouse.click(20, 20);
  await expect(overlay).not.toBeVisible({ timeout: 4_000 });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+N' : 'Control+Shift+N');
  await expect(page.locator('.desktop-shell')).toHaveClass(/writing-mode-normal/, { timeout: 4_000 });
});

test('TC-CP-11: re-triggered lookup reads updated note content from disk', async () => {
  await openContinuityWithShortcut(page);
  const search = page.locator('input[aria-label="Search entities in Notes Vault"]');
  await search.fill('Marcus');
  await expect(page.locator('.entity-card-excerpt').first()).toContainText('principled cartographer', { timeout: 4_000 });

  writeNote(
    notesVaultDir,
    MARCUS_REL_PATH,
    'Marcus now carries a silver astrolabe and trusts the tide charts more than kings.',
    { type: 'character', aliases: ['Marc'] },
  );

  await search.fill('');
  await search.fill('Marcus');
  await expect(page.locator('.entity-card-excerpt').first()).toContainText('silver astrolabe', { timeout: 4_000 });
});

test('TC-CP-12: Continuity Peek works with no AI provider configured', async () => {
  const settings = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf-8'));
  expect(settings.apiKey).toBe('');
  expect(settings.agents.archive.enabled).toBe(false);
  const match = await page.evaluate(async ({ selectedText, notesVaultRoot }) => {
    return (window as any).api.continuityMatchSelection(selectedText, notesVaultRoot);
  }, { selectedText: 'Marcus', notesVaultRoot: notesVaultDir }) as { match?: { name?: string } | null };
  expect(match.match?.name).toBe('Marcus');
});
