// Diagnostic (not a permanent fixture): measure ruler diamond x-position vs
// actual .msv-sheet edges, with a long scene so .msv-page scrolls.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('sky10917-ruler-diag');
fs.mkdirSync(OUT, { recursive: true });
const now = new Date().toISOString();
const SID = 'rd-story';
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-rd-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-rd-'));
const ac = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: .85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  agents: { writingAssistant: { ...ac, scanIntervalSeconds: 30 }, brainstorm: ac, archive: { ...ac, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const longBody = Array.from({ length: 3 }, (_, i) => `Paragraph ${i + 1}. Mira Veynn had counted the bells of the upper city for nineteen years, and never once had they rung at dusk like this, low and long across the rooftops.`).join('\n\n');
const CH = [{ id: 'rd-c1', title: 'Chapter 1', scenes: [{ id: 'rd-s1', t: 'A Long Scene', b: longBody }] }];
fs.writeFileSync(path.join(vaultDir, 'manifest.json'), JSON.stringify({
  version: '1', vaultRoot: vaultDir,
  stories: [{ id: SID, title: 'Ruler Diag Story', path: `stories/${SID}`, genre: 'Epic Fantasy', createdAt: now, updatedAt: now,
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

await page.screenshot({ path: `${OUT}/full.png` });

const measure = async () => page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const rect = (el) => el ? (({ left, right, width }) => ({ left, right, width }))(el.getBoundingClientRect()) : null;
  const page_ = q('.msv-page');
  return {
    scrollHeight: page_?.scrollHeight, clientHeight: page_?.clientHeight,
    hasScrollbar: page_ ? page_.scrollHeight > page_.clientHeight : null,
    msvPage: rect(page_),
    msvBody: rect(q('.msv-body')),
    mgrRoot: rect(q('.mgr-root')),
    mgrTrack: rect(q('.mgr-track')),
    mgrSpan: rect(q('.mgr-span')),
    sheet: rect(q('.msv-sheet')),
    sheetWrap: rect(q('.msv-sheet-wrap')),
    handleL: rect(q('[data-testid="margin-ruler-handle-l"]')),
    handleR: rect(q('[data-testid="margin-ruler-handle-r"]')),
    marginHandleL: rect(q('[data-testid="margin-ruler-margin-handle-l"]')),
    marginHandleR: rect(q('[data-testid="margin-ruler-margin-handle-r"]')),
  };
});

const m1 = await measure();
console.log('MEASURE(before-any-interaction)=' + JSON.stringify(m1));

// Compute deltas: handle center x vs sheet edge x
function summarize(m) {
  if (!m.sheet || !m.handleL || !m.handleR) return 'missing elements';
  const hlCenter = (m.handleL.left + m.handleL.right) / 2;
  const hrCenter = (m.handleR.left + m.handleR.right) / 2;
  const sheetL = m.sheet.left;
  const sheetR = m.sheet.right;
  const out = {
    hasScrollbar: m.hasScrollbar,
    outerHandleL_vs_sheetLeft: +(hlCenter - sheetL).toFixed(2),
    outerHandleR_vs_sheetRight: +(hrCenter - sheetR).toFixed(2),
  };
  if (m.marginHandleL && m.sheetWrap) {
    // margin diamond should sit at sheet content edge = sheetWrap.left + paddingLeft(marginPx)
    out.marginHandleL_x = (m.marginHandleL.left + m.marginHandleL.right) / 2;
    out.marginHandleR_x = (m.marginHandleR.left + m.marginHandleR.right) / 2;
  }
  return out;
}
console.log('SUMMARY(before)=' + JSON.stringify(summarize(m1)));

fs.writeFileSync(`${OUT}/measure.json`, JSON.stringify({ m1 }, null, 2));
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(vaultDir, { recursive: true, force: true });
console.log('DONE');
