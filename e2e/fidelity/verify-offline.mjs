// P0.1 done-criterion: the prototype-of-record must render fully OFFLINE, preferring
// the vendored react/react-dom/babel copies committed beside support.js. This script
// serves the prototype from 127.0.0.1, aborts every non-loopback request, and asserts
// the render still mounts: dual-diamond margin ruler + AI master toggle both present.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
import { chromium } from 'playwright';
import { serveProto, outDir, chromiumLaunchOptions } from './lib.mjs';

const proto = await serveProto();
const OUT = outDir('verify-offline');

const browser = await chromium.launch(chromiumLaunchOptions());
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

// Network block: anything not served by our loopback prototype server is refused.
const external = [];
await context.route('**/*', (route) => {
  const req = route.request();
  const host = new URL(req.url()).hostname;
  if (host === '127.0.0.1' || host === 'localhost') return route.continue();
  external.push({ type: req.resourceType(), url: req.url() });
  return route.abort('internetdisconnected');
});

const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto(proto.url, { waitUntil: 'load', timeout: 60000 });
await page.waitForTimeout(4000);

const mounted = await page.evaluate(() => {
  const text = document.body.innerText || '';
  return {
    // The runtime mounts into a plain div (the raw <x-dc> template is consumed);
    // a successful mount produces several hundred elements.
    nodes: document.body.querySelectorAll('*').length,
    marginRuler: /margin \d+ px/.test(text),   // dual-diamond ruler writes "margin N px" to the status bar
    react: !!window.React,
    reactDom: !!window.ReactDOM,
  };
});
await page.screenshot({ path: `${OUT}/offline-editor.png` });

// AI master toggle lives at the top of Settings → AI Agents.
const clickText = async (label, leftMax) => {
  const ok = await page.evaluate(({ label, leftMax }) => {
    const els = [...document.querySelectorAll('div,span,button,a,li')].filter((e) => {
      const t = (e.innerText || '').trim();
      const r = e.getBoundingClientRect();
      return t === label && r.left < leftMax && r.width > 8 && r.height > 8;
    });
    if (!els.length) return false;
    els.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
    els[0].click();
    return true;
  }, { label, leftMax });
  await page.waitForTimeout(1300);
  return ok;
};
await clickText('Settings', 110);
await clickText('AI Agents', 700);
const aiToggle = await page.evaluate(() => (document.body.innerText || '').includes('AI features'));
await page.screenshot({ path: `${OUT}/offline-settings-ai.png` });

console.log(JSON.stringify({ ...mounted, aiToggle, externalRequestsAttempted: external, pageErrors: errs.slice(0, 5) }, null, 2));

await browser.close();
await proto.close();

// The .dc.html links Google Fonts from its own markup (content we may not edit);
// blocked fonts/stylesheets degrade gracefully. Only executable/data externals
// (script, xhr, fetch) mean the vendored-first loader failed.
const badExternal = external.filter((e) => ['script', 'xhr', 'fetch'].includes(e.type));
const pass = mounted.nodes > 300 && mounted.marginRuler && aiToggle && badExternal.length === 0;
console.log(pass ? 'OFFLINE RENDER: PASS' : 'OFFLINE RENDER: FAIL');
process.exit(pass ? 0 : 1);
