// Final sweep: app's right-panel tabs (Assistant/Scenes/Notes/References) + Settings.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('rightpanel');
fs.mkdirSync(OUT, { recursive: true });
const now = new Date().toISOString();
const SID = 'rp-story';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-rp-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-rp-'));
const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));
const CID = 'rp-c1', SC = 'rp-s1';
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: SID, title: 'The Last City of Veynn', path: `stories/${SID}`, createdAt: now, updatedAt: now,
    chapters: [{ id: CID, title: 'Fractures', path: `stories/${SID}/chapters/${CID}`, order: 0, createdAt: now, updatedAt: now,
      scenes: [{ id: SC, title: 'Into the Undercity', order: 0, chapterId: CID, storyId: SID,
        path: `stories/${SID}/chapters/${CID}/scenes/${SC}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: SC + '-b', type: 'prose', content: 'The stairwell yawned like a throat. Mira thought of [[The Sunken Gate]] and of [[Tide Mechanics]].', order: 0, updatedAt: now }] }] }] }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
const d = path.join(vaultDir, 'stories', SID, 'chapters', CID, 'scenes');
fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, SC + '.md'), ['---', `id: ${SC}`, 'title: "Into the Undercity"', 'draftState: in-progress', `updatedAt: ${now}`, '---', '', 'The stairwell yawned like a throat. Mira thought of [[The Sunken Gate]] and of [[Tide Mechanics]].', ''].join('\n'));

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', x => void x.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1920, height: 1080 });
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
if (await rows.count().catch(() => 0) > 0) { await rows.nth(0).click({ force: true, timeout: 6000 }).catch(() => {}); await page.waitForTimeout(2200); }
console.log('scene open = ' + !/Select a scene|Welcome to Mythos/.test(await page.evaluate(() => document.body.innerText)));

// Right panel tabs live on the right third of the window.
const texts = {};
for (const tab of ['Assistant', 'Scenes', 'Notes', 'References']) {
  const ok = await page.evaluate((label) => {
    const els = [...document.querySelectorAll('button,[role="tab"],div,span')];
    for (const el of els) {
      if ((el.innerText || '').trim() !== label) continue;
      const r = el.getBoundingClientRect();
      if (r.left < 1500 || r.width < 8 || r.height < 8) continue;  // right panel only
      el.click();
      return true;
    }
    return false;
  }, tab);
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${OUT}/rp-${tab.toLowerCase()}.png` });
  // just the right-hand column's text
  texts[tab] = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left < 1500 || r.width < 4) return;
      if (el.children.length) return;
      const t = (el.innerText || '').trim();
      if (t) out.push(t);
    });
    return [...new Set(out)].join('\n');
  });
  console.log(`  ${tab}: clicked=${ok} len=${texts[tab].length}`);
}

// Settings — is it a modal or a full workspace view?
const gear = page.locator('.nav-rail__settings, [class*="nav-rail__settings"]').first();
if (await gear.isVisible({ timeout: 2000 }).catch(() => false)) {
  await gear.click().catch(() => {});
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/settings.png` });
  const s = await page.evaluate(() => ({
    modal: !!document.querySelector('[class*="modal" i][class*="settings" i], [role="dialog"]'),
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    text: document.body.innerText.slice(0, 900),
  }));
  console.log('SETTINGS modal=' + s.modal + ' dialogs=' + s.dialogs);
  fs.writeFileSync(`${OUT}/settings.txt`, s.text);
}
fs.writeFileSync(`${OUT}/rp-text.json`, JSON.stringify(texts, null, 1));
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
