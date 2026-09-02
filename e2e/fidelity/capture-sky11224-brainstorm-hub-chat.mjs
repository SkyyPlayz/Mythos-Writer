// SKY-11224 fidelity capture — the AGENTS card's Brainstorm row used to open
// onto "Brainstorm Agent chat coming soon." (the owner's exact "Brainy" repro).
// Proves the row now opens a real mini chat instead.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11224-brainstorm-hub-chat');
const VIEWPORT = { width: 1920, height: 1080 };

const now = new Date().toISOString();
const SID = 'sky11224-story';
const CID = 'sky11224-c1';
const SC = 'sky11224-s1';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11224-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-sky11224-'));

fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  rightSidebarVisible: true,
  agents: {
    writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
  },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, createdAt: now, updatedAt: now,
    chapters: [{ id: CID, title: 'Fractures', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: now, updatedAt: now,
      scenes: [{ id: SC, title: 'Into the Undercity', order: 0, chapterId: CID, storyId: SID,
        path: `stories/${SID}/chapters/${CID}/scenes/${SC}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: SC + '-b', type: 'prose', content: 'The stairwell yawned like a throat.', order: 0, updatedAt: now }] }] }] }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
const sceneDir = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
fs.mkdirSync(sceneDir, { recursive: true });
fs.writeFileSync(path.join(sceneDir, SC + '.md'), ['---', `id: ${SC}`, 'title: "Into the Undercity"', 'draftState: in-progress', `updatedAt: ${now}`, '---', '', 'The stairwell yawned like a throat.', ''].join('\n'));

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', (d) => void d.accept().catch(() => {}));
await page.setViewportSize(VIEWPORT);
await page.waitForLoadState('domcontentloaded');
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(3000);
for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
}
await page.keyboard.press('Escape').catch(() => {});

for (let i = 0; i < 3; i++) {
  const btns = page.locator('.nav-expand-btn');
  const n = await btns.count().catch(() => 0);
  for (let j = 0; j < n; j++) await btns.nth(j).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
const rows = page.locator('.nav-scene-row');
if (await rows.count().catch(() => 0) > 0) {
  await rows.nth(0).click({ force: true, timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(2200);
}

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  shot', name);
};

const tabsFound = await page.locator('.ahp-tabs').count().catch(() => 0);
if (!tabsFound) {
  console.error('FAIL: right-panel tab strip (.ahp-tabs) not found — cannot capture.');
  await app.close().catch(() => {});
  process.exit(1);
}

await shot('01-assistant-tab-agents-list');

const brainstormRow = page.getByTestId('ahp-agent-row-brainstorm');
await brainstormRow.waitFor({ state: 'visible', timeout: 5000 });
await brainstormRow.click();
await page.waitForTimeout(800);

const comingSoon = await page.getByText(/chat coming soon/i).count().catch(() => 0);
const chatBody = await page.getByTestId('ahp-brainstorm-chat').count().catch(() => 0);
console.log(`comingSoonVisible=${comingSoon > 0} brainstormChatBodyPresent=${chatBody > 0}`);

await shot('02-brainstorm-row-clicked-real-chat');

if (comingSoon > 0 || chatBody === 0) {
  console.error('FAIL: Brainstorm row still shows the placeholder (or the new chat body did not mount).');
  await app.close().catch(() => {});
  process.exit(1);
}

await app.close();
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE', OUT);
