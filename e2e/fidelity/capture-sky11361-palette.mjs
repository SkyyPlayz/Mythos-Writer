// SKY-11361 fidelity capture — before/after evidence for the dark-surface
// palette fix (--bg-base / --bg-canvas / --bg-inset / --bg-elevated /
// --surface-3 / glass fills brought down to the design file's luminance).
// Captures the four owner-flagged screens: Vault Graph, Brainstorm, Editor
// (Story Writer), Notes. Run once against baseline tokens.css (LABEL=before)
// and once against the fixed tokens.css (LABEL=after) — see run-both.sh.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const LABEL = process.env.CAPTURE_LABEL || 'run';
const OUT = outDir('capture-sky11361-palette');
const VIEWPORT = { width: 1440, height: 900 };
const now = '2026-06-17T00:00:00.000Z';

function seedProject(userData, storyVaultDir, notesVaultDir) {
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Locations'), { recursive: true });

  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    liquidNeonV2: { wp: 'none' },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
    vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir,
  }, null, 2));

  const scene = {
    id: 'scene-1', title: 'Opening Scene', path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
    order: 1, blocks: [{ id: 'block-1', type: 'prose', content: 'Meet Elara.', order: 1, updatedAt: now }],
    createdAt: now, updatedAt: now,
  };
  const chapter = {
    id: 'chapter-1', title: 'Chapter One', path: 'Test Story/Manuscript/Chapter One',
    order: 1, scenes: [scene], createdAt: now, updatedAt: now,
  };
  const story = {
    id: 'story-1', title: 'Test Story', path: 'Test Story',
    chapters: [chapter], createdAt: now, updatedAt: now,
  };
  fs.writeFileSync(path.join(storyVaultDir, 'manifest.json'), JSON.stringify({
    version: '1.0.0', vaultRoot: storyVaultDir, stories: [story], chapters: [chapter],
    scenes: [scene], entities: [], suggestions: [],
  }, null, 2));
  fs.writeFileSync(path.join(storyVaultDir, scene.path), 'Meet Elara.');

  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Elara.md'), '# Elara\n\nSibling of [[Kest]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Kest.md'), '# Kest\n\nSibling of [[Elara]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Locations', 'The Hollow.md'), '# The Hollow\n\nHome of [[Elara]].');
}

async function launchApp(userData) {
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
    timeout: 30_000,
  });
  const proc = app.process();
  proc.stderr?.on('data', (d) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function clickRail(page, label) {
  const btn = page.locator(`nav[aria-label="Main navigation"] button[aria-label="${label}"]`);
  await btn.waitFor({ state: 'visible', timeout: 12000 });
  await btn.click();
}

async function shot(page, name) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${LABEL}-${name}.png`) });
  console.log('  shot', name);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), `mythos-sky11361-${LABEL}-`));
const storyVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11361-story-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11361-notes-'));
seedProject(userData, storyVaultDir, notesVaultDir);

const app = await launchApp(userData);
const page = await app.firstWindow();
await page.setViewportSize(VIEWPORT);
await page.waitForLoadState('domcontentloaded');
await page.locator('nav[aria-label="Main navigation"]').waitFor({ state: 'visible', timeout: 12000 });
await page.waitForTimeout(1500);

// Vault Graph
await clickRail(page, 'Vault Graph');
await page.waitForSelector('#app-tabpanel-vault-graph', { timeout: 8000 });
await shot(page, '01-vault-graph');

// Notes Editor
await clickRail(page, 'Notes Editor');
await page.waitForTimeout(600);
await shot(page, '02-notes');

// Brainstorm
await clickRail(page, 'Brainstorm');
await page.waitForTimeout(600);
await shot(page, '03-brainstorm');

// Story Writer (Editor)
await clickRail(page, 'Story Writer');
const storyPick = page.locator('[data-testid="nav-rail-story-story-1"]');
if (await storyPick.count()) await storyPick.click();
await page.waitForSelector('#app-tabpanel-story', { timeout: 8000 });
await shot(page, '04-editor');

await app.close();
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(storyVaultDir, { recursive: true, force: true });
fs.rmSync(notesVaultDir, { recursive: true, force: true });
console.log('DONE', OUT);
