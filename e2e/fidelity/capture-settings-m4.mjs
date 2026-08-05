// M4 (SKY-9018) fidelity capture — Settings over the editor.
// Shots: settings over editor (two frames 2s apart for the moving-background
// check), Appearance tab, high-contrast opaque override.
// Reuses the capture-app2 seed. Run headless via xvfb-run --auto-servernum.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-settings-m4');
const VIEWPORT = { width: 1920, height: 1080 };
const now = new Date().toISOString();
const storyId = 'aud-story-001';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m4-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));

const agentCfg = (extra = {}) => ({
  enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
  maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500000, ...extra,
});
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  agents: { writingAssistant: agentCfg({ scanIntervalSeconds: 30 }), brainstorm: agentCfg(), archive: agentCfg({ continuityCheckIntervalSeconds: 60 }) },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const PROSE = "The gate had not been broken so much as persuaded.";
const chapters = [
  { id: 'aud-ch-001', title: 'Chapter 1: The Quiet Before', order: 0, scenes: [{ id: 'aud-sc-000', title: 'The Long Dusk', order: 0, body: PROSE }] },
];
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: storyId, title: 'The Last City of Veynn', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
    chapters: chapters.map(c => ({ id: c.id, title: c.title, path: `stories/${storyId}/chapters/${c.id}`, order: c.order, createdAt: now, updatedAt: now,
      scenes: c.scenes.map(s => ({ id: s.id, title: s.title, order: s.order, chapterId: c.id, storyId,
        path: `stories/${storyId}/chapters/${c.id}/scenes/${s.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: `${s.id}-b1`, type: 'prose', content: s.body, order: 0, updatedAt: now }] })) })) }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
for (const c of chapters) {
  const dir = path.join(vaultDir, 'stories', storyId, 'chapters', c.id, 'scenes');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of c.scenes) fs.writeFileSync(path.join(dir, `${s.id}.md`),
    ['---', `id: ${s.id}`, `title: "${s.title}"`, 'draftState: in-progress', `updatedAt: ${now}`, '---', '', s.body, ''].join('\n'));
}

const app = await electron.launch({
  args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, MYTHOS_USER_DATA: userData },
});
const page = await app.firstWindow();
await page.setViewportSize(VIEWPORT);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(4000);

// Dismiss any "Not now" modal first (harness rule).
const notNow = page.getByRole('button', { name: /not now/i });
if (await notNow.count()) await notNow.first().click().catch(() => {});

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  shot', name);
};

// Open Settings from the rail.
const settingsBtn = page.getByRole('button', { name: /^settings$/i });
if (await settingsBtn.count()) await settingsBtn.first().click();
else await page.keyboard.press('Control+,');
await page.waitForSelector('.settings-overlay', { timeout: 10000 });
await page.waitForTimeout(1500);

await shot('01-settings-over-editor-frame-a');
await page.waitForTimeout(2000);
await shot('02-settings-over-editor-frame-b'); // must differ from frame A in the bg region

// Appearance tab.
const appearance = page.getByRole('tab', { name: /appearance/i });
if (await appearance.count()) await appearance.first().click();
else await page.getByText('Appearance', { exact: true }).first().click().catch(() => {});
await page.waitForTimeout(1200);
await shot('03-settings-appearance');

// High-contrast opaque override.
await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
await page.waitForTimeout(600);
await shot('04-settings-high-contrast-opaque');

await app.close();
console.log('DONE', OUT);
