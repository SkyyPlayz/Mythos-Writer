/* Debug heights to figure out why empty state isn't vertically centered. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const REPO = path.resolve(__dirname, '..');
const TOKENS_CSS = fs.readFileSync(path.join(REPO, 'frontend/src/tokens.css'), 'utf8');
const VB_CSS = fs.readFileSync(path.join(REPO, 'frontend/src/components/VaultBrowser/VaultBrowser.css'), 'utf8');

const html = `<!doctype html>
<html><head><style>
${TOKENS_CSS}
${VB_CSS}
html, body { margin:0; padding:0; background: var(--bg-canvas); color: var(--text-body); font-family: var(--font-sans); }
body { display: flex; height: 100vh; }
.sidebar { width: 240px; height: 100%; background: var(--bg-panel); display: flex; flex-direction: column; }
.canvas-spacer { flex: 1; }
.vb-notes-empty { animation: none !important; opacity: 1 !important; }
</style></head>
<body>
<div class="sidebar">
  <div class="vb-notes-vault" data-testid="vb-notes-vault">
    <div class="vb-section-header"><span class="vb-section-label">Notes Vault</span><button class="vb-section-add">+</button></div>
    <section class="vb-notes-empty" role="region" data-testid="vb-notes-empty">
      <span class="vb-notes-empty-icon">ICO</span>
      <h2 class="vb-notes-empty-heading">Capture your first idea</h2>
      <p class="vb-notes-empty-sub">Sub copy goes here for testing.</p>
      <button class="vb-notes-empty-cta">+ New note</button>
      <p class="vb-notes-empty-footer">Footer hint</p>
    </section>
  </div>
</div>
<div class="canvas-spacer"></div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });

  const info = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const dump = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: el.className,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        display: cs.display,
        flexGrow: cs.flexGrow,
        flexShrink: cs.flexShrink,
        flexBasis: cs.flexBasis,
        flexDirection: cs.flexDirection,
        justifyContent: cs.justifyContent,
        alignItems: cs.alignItems,
        height: cs.height,
        minHeight: cs.minHeight,
      };
    };
    return {
      body: dump(document.body),
      sidebar: dump(q('.sidebar')),
      vault: dump(q('.vb-notes-vault')),
      header: dump(q('.vb-section-header')),
      empty: dump(q('.vb-notes-empty')),
      heading: dump(q('.vb-notes-empty-heading')),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  await page.screenshot({ path: '/tmp/sky-94-debug.png' });
  await browser.close();
})();
