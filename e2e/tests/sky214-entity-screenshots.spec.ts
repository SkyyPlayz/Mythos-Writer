/**
 * sky214-entity-screenshots.spec.ts — SKY-214
 *
 * Captures 5 screenshots of the entity system surfaces for the user guide:
 *   1. EntityBrowser + New Entity dialog (create flow)
 *   2. EntityBrowser grouped tree (all 7 types visible)
 *   3. Entity card with Connections + Backlinks panels
 *   4. Scene editor with [[...]] wiki-link autocomplete hint
 *   5. Global search panel with entity results
 *
 * Output: docs/user-guide/screenshots/entity-*.png
 *
 * Run from repo root:
 *   xvfb-run --auto-servernum npx playwright test e2e/tests/sky214-entity-screenshots.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../../docs/user-guide/screenshots');

// ─── Vault seeding ────────────────────────────────────────────────────────────

function makeEntityFile(
  id: string,
  type: string,
  name: string,
  aliases: string[],
  tags: string[],
  prose: string,
  relations: { relType: string; target: string }[],
): string {
  const now = new Date().toISOString();
  const lines = [
    '---',
    `id: ${id}`,
    `name: ${name}`,
    `type: ${type}`,
    `aliases: [${aliases.join(', ')}]`,
    tags.length ? `tags: [${tags.join(', ')}]` : null,
    `createdAt: ${now}`,
    `updatedAt: ${now}`,
    '---',
    '',
    prose,
  ].filter((l): l is string => l !== null);
  if (relations.length) {
    const relBlock = relations.map(r => `## ${r.relType}\n- ${r.target}`).join('\n');
    // Insert relations block before closing ---
    const closingIdx = lines.indexOf('---', 1);
    lines.splice(closingIdx, 0, relBlock);
  }
  return lines.join('\n');
}

function seedVault(vaultDir: string): void {
  const now = new Date().toISOString();

  const entities: Array<{
    id: string; type: string; name: string; aliases: string[]; tags: string[];
    prose: string; relations: { relType: string; target: string }[];
  }> = [
    {
      id: 'aria-voss-001', type: 'character', name: 'Aria Voss',
      aliases: ['Aria', 'The Weaver'], tags: ['protagonist', 'mage'],
      prose: 'Aria is the last surviving member of the Arcane Guild.',
      relations: [
        { relType: 'allied with', target: 'kael-dorn-001' },
        { relType: 'enemy of', target: 'hollow-king-001' },
      ],
    },
    {
      id: 'kael-dorn-001', type: 'character', name: 'Kael Dorn',
      aliases: ['Kael'], tags: ['supporting', 'soldier'],
      prose: 'A veteran soldier who fights alongside Aria.',
      relations: [],
    },
    {
      id: 'thornwall-001', type: 'location', name: 'Thornwall City',
      aliases: ['Thornwall'], tags: ['capital', 'fortified'],
      prose: 'The walled capital of the Northern Reaches.',
      relations: [],
    },
    {
      id: 'arias-tower-001', type: 'location', name: "Aria's Tower",
      aliases: [], tags: ['landmark'],
      prose: 'A ruined tower where Aria trained.',
      relations: [],
    },
    {
      id: 'arcane-guild-001', type: 'faction', name: 'Arcane Guild',
      aliases: ['The Guild'], tags: ['destroyed', 'mages'],
      prose: 'A once-powerful organisation of magic practitioners, now extinct.',
      relations: [],
    },
    {
      id: 'staff-001', type: 'item', name: 'Staff of Echoes',
      aliases: ['The Staff'], tags: ['artefact', 'magical'],
      prose: 'An ancient staff that amplifies arcane magic.',
      relations: [],
    },
    {
      id: 'fall-001', type: 'event', name: 'Fall of the Arcane Guild',
      aliases: ['The Purge'], tags: ['historical', 'turning-point'],
      prose: 'The night the Guild was destroyed.',
      relations: [],
    },
    {
      id: 'echo-magic-001', type: 'concept', name: 'Echo Magic',
      aliases: [], tags: ['magic-system'],
      prose: 'A form of magic that amplifies existing resonance in objects.',
      relations: [],
    },
  ];

  for (const e of entities) {
    const typeDir = path.join(vaultDir, 'entities', `${e.type}s`);
    fs.mkdirSync(typeDir, { recursive: true });
    fs.writeFileSync(
      path.join(typeDir, `${e.id}.md`),
      makeEntityFile(e.id, e.type, e.name, e.aliases, e.tags, e.prose, e.relations),
      'utf8',
    );
  }

  // Scene with wiki-links so backlinks will show
  const storyId = 'story-001';
  const chapterId = 'chapter-001';
  const sceneId = 'scene-001';
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });

  const sceneContent = [
    '---',
    `id: ${sceneId}`,
    'title: "The Gate"',
    'draftState: in-progress',
    `updatedAt: ${now}`,
    '---',
    '',
    '[[Aria Voss]] found [[Kael Dorn]] waiting at the gate. She gripped the [[Staff of Echoes]] tightly.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), sceneContent, 'utf8');

  const manifest = {
    version: '1',
    vaultRoot: vaultDir,
    stories: [
      {
        id: storyId, title: 'The Hollow King',
        path: `stories/${storyId}`,
        chapters: [
          {
            id: chapterId, title: 'Chapter 1',
            path: `stories/${storyId}/chapters/${chapterId}`,
            order: 0,
            scenes: [
              {
                id: sceneId, title: 'The Gate',
                path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
                order: 0, chapterId, storyId,
                blocks: [{ id: 'b1', type: 'prose', content: '[[Aria Voss]] found [[Kael Dorn]] waiting at the gate. She gripped the [[Staff of Echoes]] tightly.', order: 0, updatedAt: now }],
                draftState: 'in-progress', createdAt: now, updatedAt: now,
              },
            ],
            createdAt: now, updatedAt: now,
          },
        ],
        createdAt: now, updatedAt: now,
      },
    ],
    entities: [], suggestions: [], scenes: [], chapters: [],
  };
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function seedUserData(userData: string, vaultDir: string): void {
  const settings = {
    apiKey: '', onboardingComplete: true, theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(settings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
}

// ─── Launch helpers ───────────────────────────────────────────────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env['DISPLAY'] ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 45_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => undefined));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2_500);
  return page;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

let app: ElectronApplication;
let page: Page;
let userData: string;
let vaultDir: string;

test.beforeAll(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sky214-ud-'));
  vaultDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sky214-vault-')), 'vault');
  fs.mkdirSync(vaultDir, { recursive: true });
  seedVault(vaultDir);
  seedUserData(userData, vaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
  // Navigate to the entities tab — this triggers reindexEntities on first call
  await page.locator('#leftrail-tab-entities').click();
  // Wait for entities to load and all 7 type groups to render
  await page.waitForTimeout(1_200);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
  if (vaultDir) fs.rmSync(path.dirname(vaultDir), { recursive: true, force: true });
});

test('SKY-214-01: EntityBrowser + New Entity type picker', async () => {
  // Click "+ New Entity" to reveal the TypePickerPopover
  await page.locator('button:has-text("+ New Entity")').click();
  await page.waitForTimeout(400);
  // TypePickerPopover is visible — screenshot the full window to capture the popover
  await page.screenshot({
    path: path.join(OUT_DIR, 'entity-01-create-dialog.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  // Dismiss by clicking outside the popover
  await page.mouse.click(800, 400);
  await page.waitForTimeout(500);
  // Ensure picker is gone before next test
  await page.waitForSelector('.entity-type-picker', { state: 'hidden', timeout: 3_000 }).catch(() => undefined);
});

test('SKY-214-02: EntityBrowser grouped tree', async () => {
  await page.waitForTimeout(400);
  await page.locator('.entity-browser').screenshot({ path: path.join(OUT_DIR, 'entity-02-browser-tree.png') });
});

test('SKY-214-03: Entity card with Connections + Backlinks', async () => {
  const firstItem = page.locator('.entity-item-select').first();
  await firstItem.click();
  await page.waitForTimeout(1_000);

  const card = page.locator('.entity-detail');
  await card.screenshot({ path: path.join(OUT_DIR, 'entity-03-entity-card.png') });
});

test('SKY-214-04: WikiLink autocomplete in scene editor', async () => {
  // Switch to stories tab
  await page.locator('#leftrail-tab-stories').click();
  await page.waitForTimeout(800);

  // Click the story toggle button to expand (stories start pre-expanded but make sure)
  const storyToggle = page.locator('.nav-story-toggle').first();
  await storyToggle.waitFor({ state: 'visible', timeout: 8_000 });
  // Check if expanded; if not, click to expand
  const isExpanded = await storyToggle.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await storyToggle.click();
    await page.waitForTimeout(400);
  }

  // Expand chapter
  const chapterToggle = page.locator('.nav-chapter-toggle').first();
  await chapterToggle.waitFor({ state: 'visible', timeout: 6_000 });
  const isChapterExpanded = await chapterToggle.getAttribute('aria-expanded');
  if (isChapterExpanded !== 'true') {
    await chapterToggle.click();
    await page.waitForTimeout(400);
  }

  // Click scene row
  const sceneRow = page.locator('.nav-scene-row').first();
  await sceneRow.waitFor({ state: 'visible', timeout: 6_000 });
  await sceneRow.click();
  await page.waitForTimeout(1_000);

  // Type [[ in editor to trigger autocomplete hint
  const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 6_000 });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(200);
  await page.keyboard.type('\n[[Kael');
  await page.waitForTimeout(800);

  await page.screenshot({
    path: path.join(OUT_DIR, 'entity-04-wikilink-autocomplete.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  await page.keyboard.press('Escape');
});

test('SKY-214-05: Global search panel with entity results', async () => {
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(500);

  const panel = page.locator('.gsp-panel');
  if (await panel.isVisible()) {
    await page.locator('.gsp-input').fill('aria');
    await page.waitForTimeout(700);
    await panel.screenshot({ path: path.join(OUT_DIR, 'entity-05-global-search.png') });
    await page.keyboard.press('Escape');
  }
});
