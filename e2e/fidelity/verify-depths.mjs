// Verify: (a) is "Part" depth absent? (b) does Chapter/Full Book depth compose
// content once a scene IS open, or stay empty?
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('verify-depths');
fs.mkdirSync(OUT, { recursive: true });
const now = new Date().toISOString();
const storyId = 'v-story';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-v-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-v-'));

const agentCfg = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  agents: { writingAssistant: { ...agentCfg, scanIntervalSeconds: 30 }, brainstorm: agentCfg, archive: { ...agentCfg, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const scenes = [
  { id: 'v-s1', t: "The Smuggler's Bargain", b: 'Kael dealt cards the way other men made confessions — slowly, and only when cornered.' },
  { id: 'v-s2', t: 'Into the Undercity', b: 'The stairwell yawned like a throat carved into the belly of the city.' },
];
const chId = 'v-ch1';
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: storyId, title: 'The Last City of Veynn', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
    chapters: [{ id: chId, title: 'Chapter 2: Fractures', path: `stories/${storyId}/chapters/${chId}`, order: 0, createdAt: now, updatedAt: now,
      scenes: scenes.map((s, i) => ({ id: s.id, title: s.t, order: i, chapterId: chId, storyId,
        path: `stories/${storyId}/chapters/${chId}/scenes/${s.id}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: s.id + '-b', type: 'prose', content: s.b, order: 0, updatedAt: now }] })) }] }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
const dir = path.join(vaultDir, 'stories', storyId, 'chapters', chId, 'scenes');
fs.mkdirSync(dir, { recursive: true });
for (const s of scenes) fs.writeFileSync(path.join(dir, s.id + '.md'),
  ['---', `id: ${s.id}`, `title: "${s.t}"`, 'draftState: in-progress', `updatedAt: ${now}`, '---', '', s.b, ''].join('\n'));

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', d => void d.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1920, height: 1080 });
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(3000);
for (const l of ['Not now', 'Dismiss', 'Got it']) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.isVisible({ timeout: 500 }).catch(() => false)) await b.click().catch(() => {});
}
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(600);

// Expand the whole tree, then click a scene by its TEXT (force past overlays).
for (const sel of ['.nav-story-row', '.nav-chapter-row']) {
  const rows = page.locator(sel);
  const n = await rows.count().catch(() => 0);
  for (let i = 0; i < n; i++) await rows.nth(i).locator('.nav-expand-btn, button').first().click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
}
const sceneHit = page.locator(`text="Into the Undercity"`).first();
let opened = false;
if (await sceneHit.isVisible({ timeout: 4000 }).catch(() => false)) {
  await sceneHit.click({ force: true, timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2200);
  opened = true;
}
console.log('scene opened=' + opened);
await page.screenshot({ path: `${OUT}/scene-open.png` });

// What depth buttons actually exist?
const depths = await page.evaluate(() => {
  const found = [];
  document.querySelectorAll('button,[role="button"],div,span').forEach(el => {
    const t = (el.innerText || '').trim();
    if (['Full Book', 'Part', 'Chapter', 'Scene'].includes(t)) {
      const r = el.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) found.push({ t, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
  });
  const best = new Map();
  for (const f of found) if (!best.has(f.t)) best.set(f.t, f);
  return [...best.values()];
});
console.log('DEPTHS PRESENT: ' + JSON.stringify(depths.map(d => d.t)));

for (const d of depths) {
  await page.mouse.click(d.x, d.y);
  await page.waitForTimeout(1800);
  const safe = d.t.toLowerCase().replace(/ /g, '-');
  await page.screenshot({ path: `${OUT}/depth-${safe}.png` });
  const txt = await page.evaluate(() => document.body.innerText);
  const hasProse = txt.includes('Kael dealt cards') || txt.includes('stairwell yawned');
  const bothScenes = txt.includes('Kael dealt cards') && txt.includes('stairwell yawned');
  const empty = /Select a scene|Welcome to Mythos/.test(txt);
  console.log(`  ${d.t}: prose=${hasProse} bothScenes=${bothScenes} emptyState=${empty}`);
  fs.writeFileSync(`${OUT}/text-${safe}.txt`, txt);
}

await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
