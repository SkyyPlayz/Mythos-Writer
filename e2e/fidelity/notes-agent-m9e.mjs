// M9e (SKY-9826): notes-side agent panel chat input — AI-on / AI-off captures
// of the app AND the prototype for the P0.3 side-by-side gate.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild, serveProto, chromiumLaunchOptions } from './lib.mjs';

requireBuild();
const OUT = outDir('notes-agent-m9e');
const VIEWPORT = { width: 1920, height: 1080 };
const now = new Date().toISOString();

// ── seed (same shape as capture-app2) ───────────────────────────────────────
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m9e-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-m9e-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-m9e-'));

const agentCfg = (extra = {}) => ({
  enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
  maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
  maxTokensPerDay: 500000, ...extra,
});
const writeSettings = (aiEnabled) => fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  ai: { enabled: aiEnabled },
  agents: { writingAssistant: agentCfg({ scanIntervalSeconds: 30 }), brainstorm: agentCfg(), archive: agentCfg({ continuityCheckIntervalSeconds: 60 }) },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));

const storyId = 'm9e-story', CID = 'm9e-c1', SC = 'm9e-s1';
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: storyId, title: 'The Last City of Veynn', path: `stories/${storyId}`, createdAt: now, updatedAt: now,
    chapters: [{ id: CID, title: 'Fractures', path: `stories/${storyId}/chapters/${CID}`, order: 0, createdAt: now, updatedAt: now,
      scenes: [{ id: SC, title: 'Into the Undercity', order: 0, chapterId: CID, storyId,
        path: `stories/${storyId}/chapters/${CID}/scenes/${SC}.md`, draftState: 'in-progress', createdAt: now, updatedAt: now,
        blocks: [{ id: SC + '-b', type: 'prose', content: 'The stairwell yawned like a throat.', order: 0, updatedAt: now }] }] }] }],
  entities: [], suggestions: [], scenes: [], chapters: [],
}, null, 2));
const sd = path.join(vaultDir, 'stories', storyId, 'chapters', CID, 'scenes');
fs.mkdirSync(sd, { recursive: true });
fs.writeFileSync(path.join(sd, SC + '.md'), ['---', `id: ${SC}`, 'title: "Into the Undercity"', 'draftState: in-progress', `updatedAt: ${now}`, '---', '', 'The stairwell yawned like a throat.', ''].join('\n'));
const notes = [
  ['Worldbuilding/Locations/The Sunken Gate.md', '# The Sunken Gate\n\nAn ancient floodgate.\n'],
  ['Characters/Mira Veynn.md', '# Mira Veynn\n\nProtagonist.\n'],
  ['Research/Tide Mechanics.md', '# Tide Mechanics\n'],
];
for (const [rel, body] of notes) {
  const p = path.join(notesVaultDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

// ── app capture, one launch per AI state ────────────────────────────────────
async function captureApp(aiEnabled, name) {
  writeSettings(aiEnabled);
  const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
  const page = await app.firstWindow();
  page.on('dialog', d => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    let acted = false;
    for (const label of ['Not now', 'Dismiss', 'Later', 'Skip', 'Got it']) {
      const b = page.locator(`button:has-text("${label}")`).first();
      if (await b.isVisible({ timeout: 400 }).catch(() => false)) { await b.click().catch(() => {}); acted = true; await page.waitForTimeout(500); }
    }
    if (!acted) break;
  }
  await page.keyboard.press('Escape').catch(() => {});
  const ok = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.nav-rail__item, [class*="nav-rail__item"]')];
    for (const el of items) {
      const box = el.closest('button,[role="button"],li,div') || el;
      if ((box.innerText || '').replace(/[^A-Za-z ]/g, '').trim() === 'Notes Editor') { box.click(); return true; }
    }
    return false;
  });
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => ({
    agentTab: !!document.querySelector('[data-testid="notes-right-tab-agent"]'),
    propsTab: !!document.querySelector('[data-testid="notes-right-tab-props"]'),
    placeholder: document.querySelector('.notes-agent-chat textarea')?.placeholder ?? null,
    propsShown: !!document.querySelector('[data-testid="notes-right-props"], [data-testid="notes-right-props-empty"]'),
  }));
  console.log(`APP ai=${aiEnabled} nav=${ok} ` + JSON.stringify(state));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await app.close().catch(() => {});
  return state;
}

const on = await captureApp(true, 'app-notes-agent-ai-on');
const off = await captureApp(false, 'app-notes-ai-off');

// ── prototype capture, AI on then flipped off ───────────────────────────────
const proto = await serveProto();
const browser = await chromium.launch(chromiumLaunchOptions());
const ppage = await browser.newPage({ viewport: VIEWPORT });
await ppage.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
await ppage.waitForTimeout(3500);
const click = async (label, leftMax) => {
  const ok = await ppage.evaluate(({ label, leftMax }) => {
    const els = [...document.querySelectorAll('div,span,button,a,li')].filter(e => {
      const t = (e.innerText || '').trim(); const r = e.getBoundingClientRect();
      return t === label && r.left < leftMax && r.width > 8 && r.height > 8;
    });
    if (!els.length) return false;
    els.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    els[0].click(); return true;
  }, { label, leftMax });
  await ppage.waitForTimeout(1400);
  return ok;
};
await click('Notes Editor', 110);
await ppage.waitForTimeout(1200);
console.log('PROTO on: input=' + await ppage.evaluate(() => !!document.querySelector('textarea[placeholder*="Tell me about your world"]')));
await ppage.screenshot({ path: `${OUT}/proto-notes-agent-ai-on.png` });

// flip the master toggle off (same walk as flip.mjs)
await click('Settings', 110); await click('AI Agents', 700);
const sw = await ppage.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find(e => (e.innerText || '').trim().startsWith('AI features') && e.children.length < 6 && e.getBoundingClientRect().height < 120);
  if (!h) return null;
  const scope = h.closest('div')?.parentElement?.parentElement || h.closest('div');
  for (const e of scope.querySelectorAll('*')) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (cs.cursor === 'pointer' && r.width > 25 && r.width < 90 && r.height > 10 && r.height < 40 && !(e.innerText || '').trim())
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
});
if (sw) { await ppage.mouse.click(sw.x, sw.y); await ppage.waitForTimeout(1800); }
console.log('PROTO toggle clicked=' + !!sw);
await click('Notes Editor', 110);
await ppage.waitForTimeout(1200);
const ptext = await ppage.evaluate(() => document.body.innerText);
for (const g of ['CONTINUITY FLAGS', 'CHAT', 'Properties', 'Agent']) console.log(`  proto-off notes ${g}: ${ptext.includes(g) ? 'present' : 'hidden'}`);
await ppage.screenshot({ path: `${OUT}/proto-notes-ai-off.png` });
await browser.close(); await proto.close();

fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
fs.rmSync(notesVaultDir, { recursive: true, force: true });

const pass = on.agentTab && on.propsTab && on.placeholder && on.placeholder.startsWith('Tell me about your world')
  && !off.agentTab && !off.propsTab && off.propsShown && off.placeholder === null;
console.log(pass ? 'M9E CAPTURE PASS' : 'M9E CAPTURE FAIL');
console.log('DONE');
