import fs from 'fs';
import { chromium } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions } from './lib.mjs';

const proto = await serveProto();
const BASE = proto.url;
const OUT = outDir('capture-brainstorm-only');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(chromiumLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);

const texts = {};
const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  texts[name] = await page.evaluate(() => document.body.innerText);
  console.log('  shot ' + name);
};

const clickRail = async (label) => {
  const ok = await page.evaluate((lbl) => {
    const els = [...document.querySelectorAll('div,span,button,a')];
    const hit = els.filter(e => {
      const t = (e.innerText || '').trim();
      if (t !== lbl) return false;
      const r = e.getBoundingClientRect();
      return r.left < 110 && r.width > 8 && r.height > 8;
    });
    if (!hit.length) return false;
    hit.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
    hit[0].click();
    return true;
  }, label);
  if (!ok) console.log(`  MISS rail "${label}"`);
  await page.waitForTimeout(1600);
  return ok;
};

const clickText = async (label, maxLen = 40) => {
  const ok = await page.evaluate(({ lbl, maxLen }) => {
    const els = [...document.querySelectorAll('div,span,button,a,li')];
    const hit = els.filter(e => {
      const t = (e.innerText || '').trim();
      return t === lbl && t.length <= maxLen && getComputedStyle(e).cursor === 'pointer';
    });
    if (!hit.length) return false;
    hit.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    hit[0].click();
    return true;
  }, { lbl: label, maxLen });
  await page.waitForTimeout(1300);
  return ok;
};

await shot('00-default');
await clickRail('Brainstorm');
await shot('rail-brainstorm-chat-default');

// try Board tab
for (const t of ['Board', 'Agent Chat', 'Chat']) {
  const ok = await clickText(t);
  if (ok) await shot('brainstorm-tab-' + t.toLowerCase().replace(/ /g, '-'));
}

fs.writeFileSync(`${OUT}/proto-text.json`, JSON.stringify(texts, null, 1));
await browser.close();
await proto.close();
console.log('DONE');
