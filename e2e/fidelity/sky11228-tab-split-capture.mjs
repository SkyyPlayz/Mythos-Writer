// SKY-11228 — one-off evidence capture: Notes Editor right sidebar, Agent
// (full-height chat) and Flags (full-height continuity list) as separate
// tabs at the real 340px sidebar width. Not part of the test suite.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky11228-tab-split');
const VIEWPORT = { width: 1280, height: 800 };
const now = new Date().toISOString();

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11228-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-sky11228-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-sky11228-'));

fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  ai: { enabled: true },
  agents: {
    writingAssistant: { enabled: true }, brainstorm: { enabled: true },
    archive: { enabled: true, continuityCheckIntervalSeconds: 60 },
  },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

const storyId = 'sky11228-story', CID = 'sky11228-c1', SC = 'sky11228-s1';
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: storyId, title: 'The Sunken Gate', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
    chapters: [{ id: CID, title: 'Fractures', path: `stories/${storyId}/chapters/${CID}`, order: 0, createdAt: now, updatedAt: now,
      scenes: [{ id: SC, title: 'Into the Undercity', order: 0, chapterId: CID, storyId,
        path: `stories/${storyId}/chapters/${CID}/scenes/${SC}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: SC + '-b', type: 'prose', content: 'The stairwell yawned like a throat.', order: 0, updatedAt: now }] }] }] }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
const sd = path.join(vaultDir, 'stories', storyId, 'chapters', CID, 'scenes');
fs.mkdirSync(sd, { recursive: true });
fs.writeFileSync(path.join(sd, SC + '.md'), ['---', `id: ${SC}`, 'title: "Into the Undercity"', 'draftState: in-progress', `updatedAt: ${now}`, '---', '', 'The stairwell yawned like a throat.', ''].join('\n'));

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', d => void d.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize(VIEWPORT);
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(2000);

const sceneRow = page.locator('.nav-scene-row').first();
if (await sceneRow.isVisible({ timeout: 5000 }).catch(() => false)) await sceneRow.click();
await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
await page.locator('[data-testid="notes-tab-center"]').waitFor({ state: 'visible', timeout: 8000 });
await page.waitForTimeout(1500);

// Agent tab (default) — chat should fill the full sidebar column.
await page.screenshot({ path: `${OUT}/01-agent-tab-full-height-chat.png` });

// Flags tab — sibling tab, full column to itself.
const flagsTab = page.locator('[data-testid="notes-right-tab-flags"]');
if (await flagsTab.isVisible({ timeout: 3000 }).catch(() => false)) {
  await flagsTab.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/02-flags-tab-full-height.png` });
} else {
  console.log('Flags tab not present in this fixture (archiveContinuityEnabled off) — skipped.');
}

console.log(`Screenshots written to ${OUT}`);
await app.close().catch(() => {});
