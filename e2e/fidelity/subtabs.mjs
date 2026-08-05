// Capture the APP's editor sub-tabs (Coach / Scene Crafter / Structure / Timeline / Book)
// with a scene actually open, so they can be diffed against the prototype's.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('subtabs');
fs.mkdirSync(OUT, { recursive: true });
const now = new Date().toISOString();
const SID = 'st-story';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-st-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-st-'));
const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const CH = [
  { id: 'st-c1', title: 'Chapter 1: The Quiet Before', scenes: [
    { id: 'st-s1', t: "The Watcher's Call", b: 'Mira Veynn had counted the bells of the upper city for nineteen years, and never once had they rung at dusk.' },
    { id: 'st-s2', t: 'A City in Shadows', b: 'By morning the rumor had grown teeth. The Council pretended not to notice, which is how Mira knew it mattered.' }] },
  { id: 'st-c2', title: 'Chapter 2: Fractures', scenes: [
    { id: 'st-s3', t: "The Smuggler's Bargain", b: 'Kael dealt cards the way other men made confessions — slowly, and only when cornered.' },
    { id: 'st-s4', t: 'Into the Undercity', b: 'The stairwell yawned like a throat carved into the belly of the city.' }] },
];
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, genre: 'Epic Fantasy', createdAt: now, updatedAt: now,
    chapters: CH.map((c, ci) => ({ id: c.id, title: c.title, path: `stories/${SID}/chapters/${c.id}`, order: ci, createdAt: now, updatedAt: now,
      scenes: c.scenes.map((s, si) => ({ id: s.id, title: s.t, order: si, chapterId: c.id, storyId: SID,
        path: `stories/${SID}/chapters/${c.id}/scenes/${s.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: s.id + '-b', type: 'prose', content: s.b, order: 0, updatedAt: now }] })) })) }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
for (const c of CH) {
  const d = path.join(vaultDir, 'stories', SID, 'chapters', c.id, 'scenes');
  fs.mkdirSync(d, { recursive: true });
  for (const s of c.scenes) fs.writeFileSync(path.join(d, s.id + '.md'),
    ['---', `id: ${s.id}`, `title: "${s.t}"`, 'draftState: in-progress', `updatedAt: ${now}`, '---', '', s.b, ''].join('\n'));
}

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', d => void d.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1920, height: 1080 });
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(3000);
for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(400); }
}
await page.keyboard.press('Escape').catch(() => {});

// expand + open a scene
for (let i = 0; i < 3; i++) {
  const btns = page.locator('.nav-expand-btn');
  const n = await btns.count().catch(() => 0);
  for (let j = 0; j < n; j++) await btns.nth(j).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
const rows = page.locator('.nav-scene-row');
if (await rows.count().catch(() => 0) > 0) { await rows.nth(0).click({ force: true, timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2200); }
const opened = !/Select a scene|Welcome to Mythos/.test(await page.evaluate(() => document.body.innerText));
console.log('scene opened = ' + opened);

const texts = {};
for (const tab of ['Coach', 'Scene Crafter', 'Structure', 'Timeline', 'Book', 'Editor']) {
  // click the sub-tab in the editor header band only (avoid the nav rail)
  const ok = await page.evaluate((label) => {
    const els = [...document.querySelectorAll('button,[role="tab"],div,span')];
    for (const el of els) {
      if ((el.innerText || '').trim() !== label) continue;
      const r = el.getBoundingClientRect();
      if (r.left < 340 || r.top > 150 || r.width < 8) continue;   // header band, right of sidebar
      el.click();
      return true;
    }
    return false;
  }, tab);
  await page.waitForTimeout(2200);
  const safe = tab.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await page.screenshot({ path: `${OUT}/tab-${safe}.png` });
  texts[tab] = await page.evaluate(() => document.body.innerText);
  console.log(`  ${tab}: clicked=${ok} len=${texts[tab].length}`);
}
fs.writeFileSync(`${OUT}/subtab-text.json`, JSON.stringify(texts, null, 1));
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
