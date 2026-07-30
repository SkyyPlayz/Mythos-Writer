// App capture v2 — dismiss blocking modals, verify navigation actually happened,
// dump per-surface text. Reuses the v1 seed.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from '/home/skyy/Mythos-Writer/node_modules/playwright/index.mjs';

const REPO = '/home/skyy/Mythos-Writer';
const MAIN_JS = path.join(REPO, 'out/main/main.js');
const OUT = '/tmp/claude-1000/-home-skyy-PaperclipWork/7b5f74a1-1f91-48aa-8e4c-dc9984d1fe5d/scratchpad/shots-app2';
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };
const now = new Date().toISOString();
const storyId = 'aud-story-001';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-a2-'));
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

const PROSE = {
  s1: "Kael dealt cards the way other men made confessions — slowly, and only when cornered.",
  s2: "The stairwell yawned like a throat carved into the belly of the city. Damp air rolled up from below, thick with the smell of rot, smoke, and something metallic.",
  s3: "The gate had not been broken so much as persuaded.",
};
const chapters = [
  { id: 'aud-ch-001', title: 'Chapter 1: The Quiet Before', order: 0, scenes: [{ id: 'aud-sc-000', title: 'The Long Dusk', order: 0, body: PROSE.s3 }] },
  { id: 'aud-ch-002', title: 'Chapter 2: Fractures', order: 1, scenes: [
    { id: 'aud-sc-001', title: "The Smuggler's Bargain", order: 0, body: PROSE.s1 },
    { id: 'aud-sc-002', title: 'Into the Undercity', order: 1, body: PROSE.s2 },
    { id: 'aud-sc-003', title: 'The Broken Gate', order: 2, body: PROSE.s3 },
  ] },
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
// Seed a notes side so Notes Editor has content (Obsidian-style folders + emoji test).
const notes = [
  ['Worldbuilding/Locations/The Sunken Gate.md', '# The Sunken Gate\n\nAn ancient floodgate.\n\n[[The Great Deep]]\n'],
  ['Worldbuilding/Locations/The Last City of Veynn.md', '# The Last City of Veynn\n\nCapital.\n'],
  ['Worldbuilding/Factions/The Ash Court.md', '# The Ash Court\n'],
  ['Characters/Mira Veynn.md', '# Mira Veynn\n\nProtagonist.\n'],
  ['Research/Tide Mechanics.md', '# Tide Mechanics\n'],
  ['🌊 Emoji Folder Test/🔥 Emoji Note Test.md', '# 🔥 Emoji Note Test\n\nEmoji in title, folder and body 🎭.\n'],
];
for (const [rel, body] of notes) {
  const p = path.join(vaultDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', d => void d.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize(VIEWPORT);
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(2500);

// ── dismiss anything blocking ───────────────────────────────────────────────
const alive = () => !page.isClosed();
async function clearBlockers() {
  // Only dismiss labels that cannot close the app window itself.
  for (let i = 0; i < 4; i++) {
    if (!alive()) return;
    let acted = false;
    for (const label of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
      if (!alive()) return;
      const b = page.locator(`button:has-text("${label}")`).first();
      if (await b.isVisible({ timeout: 400 }).catch(() => false)) {
        await b.click().catch(() => {}); acted = true;
        await page.waitForTimeout(500).catch(() => {});
      }
    }
    if (!acted) break;
  }
  if (alive()) await page.keyboard.press('Escape').catch(() => {});
  if (alive()) await page.waitForTimeout(400).catch(() => {});
}
await clearBlockers();

const texts = {};
const shot = async (name) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  texts[name] = await page.evaluate(() => document.body.innerText);
  console.log('  shot ' + name);
};
await shot('00-boot');

// ── rail nav with verification ──────────────────────────────────────────────
async function goRail(label) {
  await clearBlockers();
  const ok = await page.evaluate((lbl) => {
    const items = [...document.querySelectorAll('.nav-rail__item, [class*="nav-rail__item"]')];
    for (const el of items) {
      const box = el.closest('button,[role="button"],li,div') || el;
      if ((box.innerText || '').replace(/[^A-Za-z ]/g, '').trim() === lbl) { box.click(); return true; }
    }
    return false;
  }, label);
  await page.waitForTimeout(2000);
  const active = await page.evaluate(() => {
    const a = document.querySelector('.nav-rail__item--active, [class*="nav-rail__item"][class*="active"]');
    return a ? (a.closest('button,li,div')?.innerText || a.innerText || '').replace(/\n/g, ' ').trim() : '(none)';
  });
  console.log(`  goRail ${label} -> clicked=${ok} active="${active}"`);
  return ok;
}

for (const r of ['Notes Editor', 'Scene Crafter', 'Brainstorm', 'Timeline', 'Vault Graph', 'Story Writer']) {
  if (await goRail(r)) await shot('rail-' + r.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}

// ── editor: open a scene, capture depths, then the notes split ──────────────
await goRail('Story Writer');
await clearBlockers();
try {
  const storyRow = page.locator('.nav-story-row').first();
  if (await storyRow.isVisible({ timeout: 4000 }).catch(() => false)) {
    await storyRow.locator('.nav-expand-btn, button').first().click().catch(() => {});
    await page.waitForTimeout(500);
    const rows = page.locator('.nav-chapter-row');
    const cn = await rows.count().catch(() => 0);
    for (let i = 0; i < cn; i++) await rows.nth(i).locator('.nav-expand-btn, button').first().click().catch(() => {});
    await page.waitForTimeout(600);
    await shot('editor-tree-expanded');
    const scene = page.locator('.nav-scene-row').first();
    if (await scene.isVisible({ timeout: 2000 }).catch(() => false)) { await scene.click(); await page.waitForTimeout(1800); await shot('editor-scene-open'); }
  }
} catch (e) { console.log('tree nav: ' + String(e).slice(0, 120)); }

for (const d of ['Full Book', 'Part', 'Chapter', 'Scene']) {
  const b = page.locator(`button:has-text("${d}")`).first();
  if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(1300); await shot(`depth-${d.toLowerCase().replace(/ /g, '-')}`); }
}

// Emoji check: does the tree render the emoji folder/note?
const emoji = await page.evaluate(() => {
  const t = document.body.innerText;
  return { hasWave: t.includes('🌊'), hasFire: t.includes('🔥'), sample: (t.match(/.{0,40}Emoji.{0,40}/g) || []).slice(0, 4) };
});
console.log('EMOJI: ' + JSON.stringify(emoji));

fs.writeFileSync(`${OUT}/app-text.json`, JSON.stringify(texts, null, 1));
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
