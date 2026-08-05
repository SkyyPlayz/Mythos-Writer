// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import fs from 'fs';
import { chromium } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions } from './lib.mjs';

const proto = await serveProto();
const BASE = proto.url;
const OUT = outDir('flip');
const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);
const click = async (label, leftMax) => { const ok = await page.evaluate(({label,leftMax}) => { const els=[...document.querySelectorAll('div,span,button,a,li')].filter(e=>{const t=(e.innerText||'').trim();const r=e.getBoundingClientRect();return t===label&&r.left<leftMax&&r.width>8&&r.height>8;}); if(!els.length)return false; els.sort((a,b)=>a.getBoundingClientRect().height-b.getBoundingClientRect().height); els[0].click(); return true; }, {label,leftMax}); await page.waitForTimeout(1200); return ok; };
await click('Settings', 110); await click('AI Agents', 700);
// Find siblings near the "AI features" heading and dump clickables
const info = await page.evaluate(() => {
  const h = [...document.querySelectorAll('*')].find(e => (e.innerText||'').trim().startsWith('AI features') && e.children.length < 6 && e.getBoundingClientRect().height < 120);
  if (!h) return 'no heading';
  const row = h.closest('div');
  const scope = row?.parentElement?.parentElement || row;
  const out = [];
  scope.querySelectorAll('*').forEach(e => {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (cs.cursor === 'pointer' && r.width > 10 && r.height > 10 && r.width < 120)
      out.push({ tag: e.tagName, cls: String(e.className).slice(0,50), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y), t: (e.innerText||'').slice(0,20) });
  });
  return out;
});
console.log(JSON.stringify(info, null, 1).slice(0, 1500));
// click the first switch-shaped one
const pt = Array.isArray(info) ? info.find(i => i.w > 25 && i.w < 90 && i.h < 40 && !i.t) || info[0] : null;
if (pt) {
  await page.mouse.click(pt.x + pt.w/2, pt.y + pt.h/2);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/04-settings-ai-off.png` });
  const t = await page.evaluate(() => document.body.innerText);
  console.log('AFTER: ' + ((t.match(/Manual mode[^\n]*|AI features off[^\n]*/g)||['no state change']).join(' | ')));
  // editor in manual mode
  await click('Story Writer', 110);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/05-editor-ai-off.png` });
  const e2 = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`${OUT}/editor-ai-off-text.txt`, e2);
  for (const g of ['Writing Coach','Suggestions','Scene Analysis','Coach','Assist','Read','Dictate']) console.log(`  editor ${g}: ${e2.includes(g)?'present':'hidden'}`);
  await click('Notes Editor', 110);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/06-notes-ai-off.png` });
  const n2 = await page.evaluate(() => document.body.innerText);
  for (const g of ['CONTINUITY FLAGS','CHAT','Properties','Agent']) console.log(`  notes ${g}: ${n2.includes(g)?'present':'hidden'}`);
}
await browser.close(); await proto.close(); console.log('DONE');
