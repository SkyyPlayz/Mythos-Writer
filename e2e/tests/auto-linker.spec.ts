/**
 * auto-linker.spec.ts — SKY-192
 *
 * Acceptance criteria:
 *   AL-01  Type a known character name in a scene editor
 *          → auto-linker hint decoration appears inline
 *   AL-02  Hover over the hint → tooltip appears with Accept / Reject buttons
 *   AL-03  Click Accept → the anchor text becomes a [[wikilink]] in the editor
 *
 * The test pre-seeds a vault manifest with one character entity ("Elara Voss")
 * and her entity file. The app loads entities on mount, so the linker can match
 * the name as soon as the editor receives content.
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const ENTITY_ID = 'e2e-auto-linker-entity-001';
const ENTITY_NAME = 'Elara Voss';
const STORY_TITLE = 'Linker Test Story';
const CHAPTER_TITLE = 'Chapter One';
const SCENE_TITLE = 'Opening Scene';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const now = new Date().toISOString();

  // Entity file at entities/characters/<id>.md (in Story Vault)
  const entityDir = path.join(vaultDir, 'entities', 'characters');
  fs.mkdirSync(entityDir, { recursive: true });
  fs.writeFileSync(
    path.join(entityDir, `${ENTITY_ID}.md`),
    [
      '---',
      `id: ${ENTITY_ID}`,
      `name: ${ENTITY_NAME}`,
      'type: character',
      'aliases: []',
      'tags: []',
      `createdAt: ${now}`,
      `updatedAt: ${now}`,
      '---',
      '',
      'A mysterious protagonist.',
      '',
    ].join('\n'),
  );

  // Manifest.json with the entity pre-indexed
  const manifest = {
    schemaVersion: 1,
    version: '2.0.0',
    vaultRoot: vaultDir,
    stories: [],
    entities: [
      {
        id: ENTITY_ID,
        name: ENTITY_NAME,
        type: 'character',
        path: `entities/characters/${ENTITY_ID}.md`,
        aliases: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    suggestions: [],
    scenes: [],
    updatedAt: now,
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // App settings (no API key, all agents disabled, autoLinker in suggest mode)
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    autoLinker: { mode: 'suggest' },
  };

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[al:main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[al:main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[al:renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[al:renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function fillPrompt(pg: Page, response: string): Promise<void> {
  const input = pg.locator('.prompt-modal-input');
  await input.waitFor({ state: 'visible', timeout: 6_000 });
  await input.fill(response);
  await pg.locator('.prompt-modal-ok').click();
  await input.waitFor({ state: 'detached', timeout: 6_000 });
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-al-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-al-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-al-notes-'));
  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

// ─── AL-01 + AL-02 + AL-03 ───────────────────────────────────────────────────

test('AL-01–03: type entity name → hint appears → accept → becomes [[wikilink]]', async () => {
  // Wait for shell to render
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Ensure Stories tab is active
  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();

  // Create story
  await page.locator('.nav-add-btn').first().click();
  await fillPrompt(page, STORY_TITLE);
  const storyRow = page.locator('.nav-story-row').first();
  await expect(storyRow).toBeVisible({ timeout: 8_000 });

  // Create chapter
  await storyRow.locator('.nav-inline-add').click();
  await fillPrompt(page, CHAPTER_TITLE);
  const chapterRow = page.locator('.nav-chapter-row').first();
  await expect(chapterRow).toBeVisible({ timeout: 6_000 });

  // Create scene
  await chapterRow.locator('.nav-inline-add').click();
  await fillPrompt(page, SCENE_TITLE);
  const sceneRow = page.locator('.nav-scene-row').first();
  await expect(sceneRow).toBeVisible({ timeout: 6_000 });

  // Click scene to open editor
  await sceneRow.click();

  // Wait for ProseMirror editor
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible({ timeout: 8_000 });

  // Click to focus the editor and type the entity name with surrounding text.
  // We type a sentence that contains the entity name as a standalone word.
  await editor.click();
  await page.keyboard.type(`${ENTITY_NAME} walked through the door.`);

  // AL-01: Auto-linker hint decoration must appear on the entity name.
  // Give generous timeout: entities load asynchronously and the decoration
  // is rebuilt on the next transaction after they arrive.
  const hint = page.locator('.archive-wl-hint').first();
  await expect(hint).toBeVisible({ timeout: 12_000 });

  // Verify the hint targets the right entity name (data-wl-link = [[Elara Voss]])
  const wlLink = await hint.getAttribute('data-wl-link');
  expect(wlLink).toBe(`[[${ENTITY_NAME}]]`);

  // AL-02: Hover over the hint → tooltip appears with Accept button.
  await hint.hover();
  const tooltip = page.locator('.wl-hint-tooltip');
  await expect(tooltip).toBeVisible({ timeout: 4_000 });
  await expect(tooltip.locator('.wl-hint-accept')).toBeVisible();

  // AL-03: Click Accept → anchor text replaced with wikilink node.
  const acceptBtn = tooltip.locator('.wl-hint-accept');
  await acceptBtn.click({ force: true });

  // The editor should now contain [[Elara Voss]] (wikiLink node renders as [[...]] text)
  await expect(editor).toContainText(`[[${ENTITY_NAME}]]`, { timeout: 6_000 });

  // The standalone plain-text occurrence should be gone
  // (hint decoration disappears once the node is a wikiLink atom)
  await expect(hint).not.toBeVisible({ timeout: 4_000 });
});
