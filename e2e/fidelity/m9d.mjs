// M9d (SKY-9825) fidelity captures: continuity flag rich cards, prototype vs app.
// Prototype side: Notes Editor surface, right agent panel (CONTINUITY FLAGS feed).
// App side: global right sidebar Continuity panel with three seeded flags, one
// per scope tag (Story ↔ Vault / Vault internal / Timeline), plus an AI-off
// shot proving the M11b gate hides the surface.
// Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { chromium, _electron as electron } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions, mainJs as MAIN_JS, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('m9d-continuity');
fs.mkdirSync(OUT, { recursive: true });

// ── 1. prototype ─────────────────────────────────────────────────────────────
{
  const proto = await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3500);

  // Notes Editor rail entry — the notes-right agent panel holds the flags feed.
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div,span,button,a')];
    const hit = els.filter((e) => {
      const t = (e.innerText || '').trim();
      if (t !== 'Notes Editor') return false;
      const r = e.getBoundingClientRect();
      return r.left < 110 && r.width > 8 && r.height > 8;
    });
    if (!hit.length) return false;
    hit.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
    hit[0].click();
    return true;
  });
  console.log('proto rail Notes Editor = ' + clicked);
  await page.waitForTimeout(2500);

  const hasFlags = await page.evaluate(() => document.body.innerText.includes('CONTINUITY FLAGS'));
  console.log('proto CONTINUITY FLAGS visible = ' + hasFlags);
  await page.screenshot({ path: `${OUT}/proto-notes-full.png` });
  // Right panel clip — flags feed lives in the right third.
  await page.screenshot({ path: `${OUT}/proto-continuity-cards.png`, clip: { x: 1920 - 400, y: 0, width: 400, height: 1080 } });
  await browser.close();
  await proto.close();
}

// ── 2. app ───────────────────────────────────────────────────────────────────
const NOW = new Date().toISOString();
const STORY_ID = 'story-m9d';
const CHAPTER_ID = 'ch-m9d';
const SCENE_ID = 'scene-m9d';

function seedFixture({ aiOff = false } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m9d-ud-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-m9d-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-m9d-'));
  const agentDefaults = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000,
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedProgress: { completedItems: [], dismissed: true },
    ...(aiOff ? { ai: { enabled: false } } : {}),
    agents: {
      writingAssistant: { ...agentDefaults, scanIntervalSeconds: 30 },
      brainstorm: agentDefaults,
      archive: { ...agentDefaults, enabled: true, continuityCheckIntervalSeconds: 60 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    rightSidebarVisible: true, rightSidebarWidth: 360,
    rightSidebarPanels: [{ id: 'archive-continuity', collapsed: false }],
    archiveStoryEditConsentGiven: true,
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

  const scenePath = `stories/${STORY_ID}/chapters/${CHAPTER_ID}/scenes/${SCENE_ID}.md`;
  fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
    version: '1', vaultRoot: vaultDir,
    stories: [{ id: STORY_ID, title: 'The Last City of Veynn', path: `stories/${STORY_ID}`, createdAt: NOW, updatedAt: NOW,
      chapters: [{ id: CHAPTER_ID, title: 'Fractures', path: `stories/${STORY_ID}/chapters/${CHAPTER_ID}`, order: 0, createdAt: NOW, updatedAt: NOW,
        scenes: [{ id: SCENE_ID, title: 'Into the Undercity', order: 0, chapterId: CHAPTER_ID, storyId: STORY_ID,
          path: scenePath, draftState: 'in-progress', createdAt: NOW, updatedAt: NOW, blocks: [] }] }] }],
    entities: [], suggestions: [], scenes: [], chapters: [], provenance: {}, boardReferences: [], smartFolders: [],
  }, null, 2));
  const fullScenePath = path.join(vaultDir, scenePath);
  fs.mkdirSync(path.dirname(fullScenePath), { recursive: true });
  fs.writeFileSync(fullScenePath, ['---', `id: ${SCENE_ID}`, 'title: Into the Undercity', `chapterId: ${CHAPTER_ID}`, `storyId: ${STORY_ID}`, '---', '', 'Scene 4 enters the Gate at high tide.'].join('\n'));

  // Three flags, one per scope — copy mirrors the prototype's contFinds demo data.
  const mythosDir = path.join(vaultDir, '.mythos');
  fs.mkdirSync(mythosDir, { recursive: true });
  const db = new DatabaseSync(path.join(mythosDir, 'state.db'));
  db.exec(`CREATE TABLE IF NOT EXISTS continuity_issues (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, severity TEXT NOT NULL,
      manuscript_scene_id TEXT NOT NULL, manuscript_offset INTEGER NOT NULL, manuscript_excerpt TEXT NOT NULL,
      vault_note_path TEXT NOT NULL, vault_line INTEGER NOT NULL, vault_excerpt TEXT NOT NULL,
      rationale TEXT NOT NULL, proposed_match_archive TEXT NOT NULL, proposed_suggest_story TEXT NOT NULL,
      status TEXT NOT NULL, resolved_at TEXT, resolved_action TEXT, created_at TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'story_vault');`);
  const ins = db.prepare(`INSERT INTO continuity_issues
      (id, scope, category, severity, manuscript_scene_id, manuscript_offset, manuscript_excerpt,
       vault_note_path, vault_line, vault_excerpt, rationale, proposed_match_archive, proposed_suggest_story,
       status, resolved_at, resolved_action, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, 'open', NULL, NULL, ?)`);
  ins.run('m9d-1', 'story_vault', 'factual_contradiction', 'high', SCENE_ID,
    'Scene 4 enters the Gate at high tide', 'Universes/Aster/Locations/The Sunken Gate.md',
    'the inner passage opens only at low tide',
    'Scene 4 enters the Gate at high tide; note “The Sunken Gate” says the inner passage opens only at low tide.',
    'Update “The Sunken Gate” so the passage opens at high tide.',
    'Change Scene 4 so the crossing waits for low tide.', NOW);
  ins.run('m9d-2', 'vault_internal', 'factual_contradiction', 'medium', SCENE_ID,
    '“The Drowning of the Coast” says 312 AG', 'Universes/Aster/Events/Founding of Veynn.md',
    '“The Last City of Veynn” founding property says 298 AG',
    '“The Drowning of the Coast” says 312 AG; “The Last City of Veynn” founding property says 298 AG.',
    'Align the founding date to 312 AG across both notes.',
    'Keep 298 AG and adjust the Drowning entry.', NOW);
  ins.run('m9d-3', 'timeline', 'factual_contradiction', 'medium', SCENE_ID,
    'Ch. 3 opens “three days later”', 'Universes/Aster/Timeline/Ward Violet.md',
    'the timeline places Ward Violet the night BEFORE the descent',
    'Ch. 3 opens “three days later” but the timeline places Ward Violet the night BEFORE the descent.',
    'Move Ward Violet after the descent on the timeline.',
    'Reword the Ch. 3 opener to match the timeline order.', NOW);
  db.close();
  return { userData, vaultDir, notesVaultDir };
}

async function launchAndShoot(fixture, name, expectPanel) {
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', (x) => void x.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const panelVisible = await page.locator('[data-panel-id="archive-continuity"]').isVisible().catch(() => false);
  console.log(`${name}: continuity panel visible = ${panelVisible} (expected ${expectPanel})`);
  const cardCount = await page.locator('[data-testid="ic-scope-tag"]').count().catch(() => 0);
  console.log(`${name}: scope tags rendered = ${cardCount}`);
  await page.screenshot({ path: `${OUT}/${name}-full.png` });
  const sidebar = page.getByTestId('global-right-sidebar');
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.screenshot({ path: `${OUT}/${name}.png` });
  }
  await app.close().catch(() => {});
}

const fx = seedFixture();
await launchAndShoot(fx, 'app-continuity-cards', true);
const fxOff = seedFixture({ aiOff: true });
await launchAndShoot(fxOff, 'app-continuity-ai-off', false);
for (const f of [fx, fxOff]) {
  fs.rmSync(f.userData, { recursive: true, force: true });
  fs.rmSync(f.vaultDir, { recursive: true, force: true });
  fs.rmSync(f.notesVaultDir, { recursive: true, force: true });
}
console.log('done → ' + OUT);
