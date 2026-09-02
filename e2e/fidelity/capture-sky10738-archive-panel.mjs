// SKY-10738 fidelity capture — Archive panel redesign per owner's annotated
// screenshot ruling. Seeds continuity_issues directly into the real SQLite
// state DB (same fixture shape as e2e/continuity-panel.spec.ts) and shoots
// the global right-sidebar Continuity panel showing the 6 owner-required
// elements: `Story internal` scope tag, `Suggest fix`/`Open sources` action
// row, `Continuity pass ▾` header selector, and the HIGH/MEDIUM severity
// chips.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky10738-archive-panel');
const VIEWPORT = { width: 1920, height: 1080 };

const STORY_ID = 'story-sky10738';
const CHAPTER_ID = 'chapter-sky10738';
const SCENE_ID = 'scene-sky10738';
const NOW = '2026-08-26T05:00:00.000Z';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10738-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-sky10738-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-sky10738-'));

fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  agents: {
    writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    archive: { enabled: true, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
  },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  rightSidebarVisible: true, rightSidebarWidth: 380,
  rightSidebarPanels: [{ id: 'archive-continuity', collapsed: false }],
  archiveStoryEditConsentGiven: true,
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
  vaultRoot: vaultDir, notesVaultRoot: notesVaultDir,
}, null, 2));

// ── seed a minimal story/scene so the scene lookup used by the panel resolves ──
const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
const manifest = {
  schemaVersion: 1, version: '2.0.0', vaultRoot: vaultDir,
  stories: [{
    id: STORY_ID, title: 'Fidelity Capture Story', path: `stories/${STORY_ID}`,
    chapters: [{
      id: CHAPTER_ID, title: 'Chapter One', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`, order: 0,
      scenes: [{
        id: SCENE_ID, title: 'Opening Scene', path: scenePath, order: 0,
        chapterId: CHAPTER_ID, storyId: STORY_ID, blocks: [], createdAt: NOW, updatedAt: NOW,
      }],
      createdAt: NOW, updatedAt: NOW,
    }],
    createdAt: NOW, updatedAt: NOW,
  }],
  entities: [], suggestions: [], scenes: [], chapters: [], provenance: {},
  boardReferences: [], smartFolders: [],
};
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const fullScenePath = path.join(vaultDir, scenePath);
fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });
fs.writeFileSync(fullScenePath, [
  '---', `id: ${SCENE_ID}`, 'title: Opening Scene', `chapterId: ${CHAPTER_ID}`, `storyId: ${STORY_ID}`, '---',
  '', 'Mara crossed the Glass Bridge under twin moons.',
].join('\n'));

// ── seed continuity_issues so the panel renders populated flag cards ──
const mythosDir = path.join(vaultDir, '.mythos');
fs.mkdirSync(mythosDir, { recursive: true });
const db = new DatabaseSync(path.join(mythosDir, 'state.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS continuity_issues (
    id TEXT PRIMARY KEY, category TEXT NOT NULL, severity TEXT NOT NULL,
    manuscript_scene_id TEXT NOT NULL, manuscript_offset INTEGER NOT NULL,
    manuscript_excerpt TEXT NOT NULL, vault_note_path TEXT NOT NULL, vault_line INTEGER NOT NULL,
    vault_excerpt TEXT NOT NULL, rationale TEXT NOT NULL, proposed_match_archive TEXT NOT NULL,
    proposed_suggest_story TEXT NOT NULL, status TEXT NOT NULL, resolved_at TEXT, resolved_action TEXT,
    created_at TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'story_vault'
  );
`);
const insert = db.prepare(`
  INSERT INTO continuity_issues
    (id, scope, category, severity, manuscript_scene_id, manuscript_offset, manuscript_excerpt,
     vault_note_path, vault_line, vault_excerpt, rationale, proposed_match_archive,
     proposed_suggest_story, status, resolved_at, resolved_action, created_at)
  VALUES (?, ?, ?, ?, ?, 12, ?, ?, 8, ?, ?, ?, ?, 'open', NULL, NULL, ?)
`);
insert.run(
  'inc-story-internal', 'story_internal', 'character_attribute_drift', 'high',
  SCENE_ID, 'Glass Bridge under twin moons', 'Universes/Aster/Characters/Mara.md',
  'Glass Bridge only appears in daylight',
  'The manuscript places Mara on the Glass Bridge at night, but an earlier scene in this same story already established the bridge only appears in daylight.',
  'Update the earlier scene to match.', 'Change this scene to match the earlier scene.', NOW,
);
insert.run(
  'inc-story-vault', 'story_vault', 'location_detail_conflict', 'medium',
  SCENE_ID, 'twin moons lit the water', 'Universes/Aster/Locations/GlassBridge.md',
  'the bridge stands beneath a single pale moon',
  'The vault note describes a single moon over the bridge, but this scene describes twin moons.',
  'Update the vault note to match the manuscript.', 'Change the manuscript to match the vault note.', NOW,
);
db.close();

const notePath = path.join(notesVaultDir, 'Universes', 'Aster', 'Characters', 'Mara.md');
fs.mkdirSync(path.dirname(notePath), { recursive: true });
fs.writeFileSync(notePath, [
  '---', 'name: Mara', 'type: character', '---', '', '# Mara', '',
  'The Glass Bridge only appears in daylight, so she crosses before the bells.',
].join('\n'));

const app = await electron.launch({
  args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, MYTHOS_USER_DATA: userData, MYTHOS_DISABLE_BOOT_MIGRATION: '1' },
});
const page = await app.firstWindow();
await page.setViewportSize(VIEWPORT);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(4000);

const notNow = page.getByRole('button', { name: /not now/i });
if (await notNow.count()) await notNow.first().click().catch(() => {});

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  shot', name);
};

// The default right sidebar (AgentHubPanel "Assistant" tab) renders the
// ContinuityPanel as its last section, scoped to the active scene — select
// a scene first so it reads the seeded flags instead of the not-scanned
// empty state, then scroll the sidebar's internal scroll container all the
// way down to bring the flag cards into view.
const sidebar = page.locator('[data-testid="global-right-sidebar"]');
await sidebar.waitFor({ state: 'visible', timeout: 12000 });

const sceneRow = page.locator('.nav-scene-row').first();
await sceneRow.waitFor({ state: 'visible', timeout: 12000 });
await sceneRow.click();
await page.waitForTimeout(1000);

await page.evaluate(() => {
  const sb = document.querySelector('[data-testid="global-right-sidebar"]');
  const scrollable = sb ? Array.from(sb.querySelectorAll('*')).find(
    (el) => el.scrollHeight > el.clientHeight + 20,
  ) : null;
  if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
});
await page.waitForTimeout(800);

await shot('01-archive-continuity-panel-redesign');
await sidebar.screenshot({ path: path.join(OUT, '02-archive-continuity-panel-sidebar-only.png') });
console.log('  shot 02-archive-continuity-panel-sidebar-only');

await app.close();
console.log('DONE', OUT);
