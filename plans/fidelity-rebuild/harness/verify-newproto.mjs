// Verify the 2026-07-30 export: margin ruler + AI master toggle, and capture
// what the app looks like with AI OFF (the manual-mode spec).
import fs from 'fs';
import { chromium } from '/home/skyy/Mythos-Writer/node_modules/playwright/index.mjs';

const OUT = '/tmp/claude-1000/-home-skyy-PaperclipWork/7b5f74a1-1f91-48aa-8e4c-dc9984d1fe5d/scratchpad/shots-newproto';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://127.0.0.1:8899/index.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(3500);

const clickText = async (label, leftMax = 9999, leftMin = 0) => {
  const ok = await page.evaluate(({ label, leftMax, leftMin }) => {
    const els = [...document.querySelectorAll('div,span,button,a,li')];
    const hit = els.filter(e => {
      const t = (e.innerText || '').trim();
      if (t !== label) return false;
      const r = e.getBoundingClientRect();
      return r.left < leftMax && r.left >= leftMin && r.width > 8 && r.height > 8;
    });
    if (!hit.length) return false;
    hit.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    hit[0].click();
    return true;
  }, { label, leftMax, leftMin });
  await page.waitForTimeout(1300);
  return ok;
};

// 1. Editor: status bar should read "margin N px"
const t0 = await page.evaluate(() => document.body.innerText);
console.log('MARGIN-IN-STATUSBAR: ' + /margin \d+ px/.test(t0) + '  (' + (t0.match(/Page \d+ px[^\n]*/) || [''])[0] + ')');
await page.screenshot({ path: `${OUT}/01-editor-ruler.png` });

// 2. Settings → AI Agents
console.log('rail Settings: ' + await clickText('Settings', 110));
await page.screenshot({ path: `${OUT}/02-settings.png` });
console.log('AI Agents: ' + await clickText('AI Agents', 700));
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/03-settings-ai.png` });
const tAI = await page.evaluate(() => document.body.innerText);
const idx = tAI.search(/AI Agents/);
fs.writeFileSync(`${OUT}/ai-settings-text.txt`, tAI);
console.log('--- AI SETTINGS PAGE (head) ---');
console.log(tAI.slice(idx, idx + 900));

// 3. Flip the master toggle — find the topmost toggle-looking control on the AI page.
const flipped = await page.evaluate(() => {
  // look for a switch near the "AI features" / master copy at the top of the content column
  const cands = [...document.querySelectorAll('div,button,span,input')].filter(e => {
    const cs = getComputedStyle(e);
    if (cs.cursor !== 'pointer') return false;
    const r = e.getBoundingClientRect();
    if (r.left < 700 || r.top > 500 || r.width < 24 || r.width > 90 || r.height < 14 || r.height > 40) return false;
    // toggle shape: wide-ish, short, rounded
    return parseFloat(cs.borderRadius) >= r.height / 3;
  });
  if (!cands.length) return false;
  cands.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  cands[0].click();
  return true;
});
await page.waitForTimeout(1500);
console.log('MASTER TOGGLE CLICKED: ' + flipped);
await page.screenshot({ path: `${OUT}/04-settings-ai-off.png` });
const tOff = await page.evaluate(() => document.body.innerText);
console.log('TOAST/STATE: ' + ((tOff.match(/AI features[^\n]*|Manual mode[^\n]*/g) || []).slice(0, 3).join(' | ')));

// 4. Back to the editor — capture manual mode
await clickText('Story Writer', 110);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/05-editor-ai-off.png` });
const tEd = await page.evaluate(() => document.body.innerText);
fs.writeFileSync(`${OUT}/editor-ai-off-text.txt`, tEd);
const gone = ['Writing Coach', 'Brainstorm Agent', 'Archive Agent', 'Beta Reader', 'Suggestions', 'Coach', 'Scene Analysis', 'Assist'];
console.log('--- AI-OFF EDITOR: what remains of AI vocabulary ---');
for (const g of gone) console.log(`  ${g}: ${tEd.includes(g) ? 'STILL PRESENT' : 'hidden'}`);
console.log('SUBTABS: ' + ((tEd.match(/Editor\n[^]{0,80}/) || [''])[0]).replace(/\n/g, ' · ').slice(0, 100));

// 5. Notes editor AI-off too (continuity flags / agent chat should hide)
await clickText('Notes Editor', 110);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/06-notes-ai-off.png` });
const tN = await page.evaluate(() => document.body.innerText);
for (const g of ['CONTINUITY FLAGS', 'Brainstorm Agent', 'CHAT']) console.log(`  notes ${g}: ${tN.includes(g) ? 'STILL PRESENT' : 'hidden'}`);

await browser.close();
console.log('DONE');
