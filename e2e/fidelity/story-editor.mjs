// Deep pass on the STORY EDITOR — the owner's top priority.
// Builds a real multi-chapter story, opens a scene for real, then inventories
// the editor chrome at each depth and compares to the prototype's inventory.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('story-editor');
fs.mkdirSync(OUT, { recursive: true });
const now = new Date().toISOString();
const SID = 'se-story';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-se-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-se-'));
const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const CH = [
  { id: 'se-c1', title: 'Chapter 1: The Quiet Before', scenes: [
    { id: 'se-s0', t: 'The Long Dusk', b: 'The gate had not been broken so much as persuaded. Its hinges hung open like a question nobody wanted answered, and the guards had long since stopped pretending to watch it.' }] },
  { id: 'se-c2', title: 'Chapter 2: Fractures', scenes: [
    { id: 'se-s1', t: "The Smuggler's Bargain", b: 'Kael dealt cards the way other men made confessions — slowly, and only when cornered. "Passage through Ward Violet costs more than coin," he said. "It costs a favor. And favors compound."' },
    { id: 'se-s2', t: 'Into the Undercity', b: 'The stairwell yawned like a throat carved into the belly of the city. Damp air rolled up from below, thick with the smell of rot, smoke, and something metallic — like old coins left too long in a gutter.' },
    { id: 'se-s3', t: 'The Broken Gate', b: 'Mira counted the bells and found one missing. In Veynn, a silent bell meant a door had been opened that should not have been.' }] },
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
// Leave the Getting Started panel alone — the generic "close" selectors hit the
// window chrome and kill the app. Escape only.
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(800);

// ── dump the nav tree so we can click a scene for real ─────────────────────
const tree = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('[class*="nav-"]').forEach(el => {
    const t = (el.innerText || '').split('\n')[0].trim();
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    out.push({ cls: el.className.toString(), t: t.slice(0, 40), y: Math.round(r.y), h: Math.round(r.height) });
  });
  return out.slice(0, 60);
});
fs.writeFileSync(`${OUT}/nav-dom.json`, JSON.stringify(tree, null, 1));
console.log('NAV CLASSES: ' + JSON.stringify([...new Set(tree.map(t => t.cls.split(' ')[0]))]));

// Expand everything
for (let pass = 0; pass < 3; pass++) {
  const btns = page.locator('.nav-expand-btn');
  const n = await btns.count().catch(() => 0);
  for (let i = 0; i < n; i++) await btns.nth(i).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${OUT}/01-tree.png` });

// Click the scene by its own row class, falling back to text
let opened = false;
for (const sel of ['.nav-scene-row', '[class*="scene-row"]', '[class*="nav-scene"]']) {
  const rows = page.locator(sel);
  const n = await rows.count().catch(() => 0);
  console.log(`  ${sel} -> ${n} rows`);
  if (n > 1) {
    await rows.nth(1).click({ force: true, timeout: 6000 }).catch(e => console.log('   click err ' + String(e).slice(0, 60)));
    await page.waitForTimeout(2500);
    const txt = await page.evaluate(() => document.body.innerText);
    if (!/Select a scene|Welcome to Mythos/.test(txt)) { opened = true; break; }
  }
}
if (!opened) {
  const t = page.locator('text="Into the Undercity"').last();
  if (await t.isVisible({ timeout: 3000 }).catch(() => false)) {
    await t.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    const txt = await page.evaluate(() => document.body.innerText);
    opened = !/Select a scene|Welcome to Mythos/.test(txt);
  }
}
console.log('SCENE OPENED = ' + opened);
await page.screenshot({ path: `${OUT}/02-scene-open.png` });

// ── inventory the editor chrome ────────────────────────────────────────────
const inv = await page.evaluate(() => {
  const rows = {};
  const seen = new Set();
  document.querySelectorAll('button,select,[role="button"],[role="tab"]').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return;
    if (r.left < 340) return;                 // skip rail + left sidebar
    if (r.top > 420) return;                  // chrome region only
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\n+/g, ' ');
    if (!label) return;
    const band = Math.round(r.top / 26) * 26; // group into visual rows
    const k = band + '|' + label;
    if (seen.has(k)) return;
    seen.add(k);
    (rows[band] ||= []).push(label.slice(0, 34));
  });
  return Object.keys(rows).sort((a, b) => a - b).map(y => ({ y: +y, items: rows[y] }));
});
console.log('--- APP EDITOR CHROME BY ROW ---');
for (const r of inv) console.log(`  y=${String(r.y).padStart(4)}  ${r.items.join(' · ')}`);

// Which page-setup / snapshot controls are visible right now?
const strips = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    pageSetupStrip: /Letter[\s\S]{0,40}A4[\s\S]{0,40}A5/.test(t),
    fontModeStrip: /Serif[\s\S]{0,20}Sans[\s\S]{0,20}Mono/.test(t),
    snapshotStrip: t.includes('Save snapshot now'),
    historyBtn: t.includes('History'),
    partDepth: /(^|\n)Part(\n|$)/.test(t),
    dropCap: !!document.querySelector('[class*="dropcap" i], [class*="drop-cap" i]'),
    commentsGutter: !!document.querySelector('[class*="comments-gutter" i], [class*="CommentsGutter"]'),
    chapterNote: t.includes('CHAPTER NOTE'),
    statusButtons: ['In Progress', 'Review', 'Final'].filter(s => t.includes(s)),
  };
});
console.log('STRIPS/FEATURES: ' + JSON.stringify(strips, null, 1));

for (const d of ['Chapter', 'Full Book', 'Scene']) {
  const b = page.locator(`button:has-text("${d}")`).first();
  if (await b.isVisible({ timeout: 1000 }).catch(() => false)) {
    await b.click().catch(() => {});
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/depth-${d.toLowerCase().replace(/ /g, '-')}.png` });
  }
}
fs.writeFileSync(`${OUT}/final-text.txt`, await page.evaluate(() => document.body.innerText));
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
