/**
 * sky214-entity-screenshots.spec.ts — SKY-214
 *
 * Captures screenshots of the entity system surfaces for the user guide:
 *   1. EntityBrowser + New Entity dialog (create flow)
 *   2. EntityBrowser grouped tree (all 7 types visible)
 *   3. Entity card — SKIPPED (M5.5 product gap, see SKY-214-03 below)
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
  expect,
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
  // M6 (SKY-9022): the sidebar panel stack is gone — Entity Browser opens as
  // a workspace tab via the + picker instead (SKY-9920, same entry as
  // entity-system.spec.ts TC-E-01).
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
  const newTabBtn = page.locator('[data-testid="wtb-new-tab-btn"]');
  await expect(newTabBtn).toBeVisible({ timeout: 8_000 });
  await newTabBtn.click();
  await page.locator('[data-testid="wtb-new-tab-menu-item-entities"]').click();
  await expect(page.locator('.entity-browser')).toBeVisible({ timeout: 6_000 });
  // Wait for entities to load and all 7 type groups to render
  await page.waitForTimeout(1_200);
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  if (userData) fs.rmSync(userData, { recursive: true, force: true });
  if (vaultDir) fs.rmSync(path.dirname(vaultDir), { recursive: true, force: true });
});

test('SKY-214-01: EntityBrowser + New Entity create dialog', async () => {
  // "+ New Entity" opens the SKY-619 CreateDialog (role="dialog") — the old
  // TypePickerPopover is gone (selectors per entity-system.spec.ts TC-E-01).
  await page.locator('.entity-btn.entity-btn-primary.entity-btn-sm').click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  // Dialog is open — screenshot the full window to capture it in context
  await page.screenshot({
    path: path.join(OUT_DIR, 'entity-01-create-dialog.png'),
    clip: { x: 0, y: 0, width: 1280, height: 800 },
  });
  // The modal overlay would swallow 214-02/03's pointer events if left open —
  // dismiss via Escape (wired to onCancel) and confirm it is gone.
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible({ timeout: 3_000 });
});

test('SKY-214-02: EntityBrowser grouped tree', async () => {
  await page.waitForTimeout(400);
  await page.locator('.entity-browser').screenshot({ path: path.join(OUT_DIR, 'entity-02-browser-tree.png') });
});

// M5 (SKY-9920, already on main) made the tab-hosted Entity Browser's click
// only highlight the row (handleSelectEntityInTab) instead of opening
// EntityDetail, and M6 removed the sidebar panel stack — the last surface
// where clicking an entity still opened EntityDetail. Confirmed locally at
// this branch: `.entity-detail` never renders, so there is nothing to
// screenshot until Entity Browser relocation lands (M5.5 — see
// plans/fidelity-rebuild/PLAN.md §4, "Entity Browser lives on per M5.5").
// Same deferred product gap as entity-system.spec.ts TC-E-02; re-enable and
// recapture entity-03-entity-card.png when M5.5 lands.
test.skip('SKY-214-03: Entity card with Connections + Backlinks — product gap, no UI path opens EntityDetail until M5.5 lands', () => {});

test('SKY-214-04: WikiLink autocomplete in scene editor', async () => {
  // Switch to the Story Writer section (nav-rail rewrite, SKY-3098/3218).
  // Re-clicking an already-active "Story Writer" item toggles the Stories
  // popover instead of navigating (see AppNavRail), so only click when the
  // section isn't already active (test 03 may have already switched there).
  const storyWriterTab = page.locator('button.nav-rail__item[aria-label="Story Writer"]');
  const alreadyActive = await storyWriterTab.evaluate((el) => el.classList.contains('nav-rail__item--active'));
  if (!alreadyActive) await storyWriterTab.click();
  await page.waitForTimeout(800);

  // Test 03 may have left the Stories popover open (re-clicking an
  // already-active "Story Writer" item toggles it) — its backdrop intercepts
  // pointer events over the rest of the shell, so dismiss it before proceeding.
  const storiesBackdrop = page.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await storiesBackdrop.isVisible({ timeout: 500 }).catch(() => false)) {
    await storiesBackdrop.click();
    await expect(storiesBackdrop).not.toBeVisible({ timeout: 3_000 });
  }

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

  // Type [[ in editor to trigger autocomplete hint.
  // Scene depth renders the tiptap BlockEditor (.ProseMirror); the combined
  // `.ProseMirror, [contenteditable="true"]` selector used to match this, but
  // now also matches the hidden ManuscriptView scope-title h1 (also
  // contenteditable), which sorts first in DOM order and never becomes
  // visible at scene depth — so `.first()` waited on the wrong node.
  const editor = page.locator('.ProseMirror');
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
