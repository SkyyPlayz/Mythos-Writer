// Walk every prototype surface and capture it + a text dump for structural diffing.
import fs from 'fs';
import { chromium } from '/home/skyy/Mythos-Writer/node_modules/playwright/index.mjs';

const BASE = 'http://127.0.0.1:8899/index.html';
const OUT = '/tmp/claude-1000/-home-skyy-PaperclipWork/7b5f74a1-1f91-48aa-8e4c-dc9984d1fe5d/scratchpad/shots-proto';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);

const texts = {};
const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  texts[name] = await page.evaluate(() => document.body.innerText);
  console.log('  shot ' + name);
};

// The rail labels are plain text nodes; click by exact text within the left 100px.
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
    // click the outermost matching (largest) target
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

await shot('00-editor-default');

// Editor depths
for (const d of ['Full Book', 'Part', 'Chapter', 'Scene']) {
  if (await clickText(d)) await shot(`editor-depth-${d.toLowerCase().replace(/ /g, '-')}`);
}
// Editor sub-tabs
for (const t of ['Coach', 'Structure', 'Book', 'Editor']) {
  if (await clickText(t)) await shot(`editor-tab-${t.toLowerCase()}`);
}
// Right panel tabs
for (const t of ['Scenes', 'Notes', 'References', 'Assistant']) {
  if (await clickText(t)) await shot(`rightpanel-${t.toLowerCase()}`);
}

// Other rail surfaces
for (const r of ['Notes Editor', 'Scene Crafter', 'Brainstorm', 'Timeline', 'Vault Graph', 'Settings']) {
  if (await clickRail(r)) await shot('rail-' + r.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
}

fs.writeFileSync(`${OUT}/proto-text.json`, JSON.stringify(texts, null, 1));
await browser.close();
console.log('DONE');
