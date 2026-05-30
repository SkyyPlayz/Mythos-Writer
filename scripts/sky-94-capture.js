/*
 * SKY-94 — Visual-truth gate capture for NotesVaultEmptyState (SKY-89 §G).
 *
 * Renders the empty-state markup in a standalone Chromium page using the same
 * VaultBrowser.css + tokens.css that ship with the app. Captures the 1440×900
 * sidebar viewport across:
 *   • sidebar widths   180 / 240 / 320
 *   • themes           default + [data-contrast="high"]
 *   • CTA states       baseline / hover / focus-visible
 * = 18 PNGs in e2e-visual-artifacts/sky-94-empty-state/.
 *
 * Run from repo root:
 *   node scripts/sky-94-capture.js
 *
 * Uses Playwright with the system /usr/bin/google-chrome because Playwright's
 * own Chromium download does not support Ubuntu 26.04.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('@playwright/test');

const REPO = path.resolve(__dirname, '..');
const ART = path.join(REPO, 'e2e-visual-artifacts/sky-94-empty-state');

// Read CSS/tokens from the SKY-89 implementation ref so the script is
// independent of whichever branch happens to be checked out when it runs.
// The harness has been swapping branches between heartbeats.
const REF = process.env.SKY94_REF || 'origin/feat/sky-89-notes-vault-empty-state';
function showFile(p) {
  return execSync(`git show ${REF}:${p}`, { cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
const TOKENS_CSS = showFile('frontend/src/tokens.css');
const VB_CSS = showFile('frontend/src/components/VaultBrowser/VaultBrowser.css');

fs.mkdirSync(ART, { recursive: true });

const EMPTY_STATE_HTML = `
<section
  class="vb-notes-empty"
  role="region"
  aria-labelledby="vb-notes-empty-heading"
  data-testid="vb-notes-empty"
>
  <span class="vb-notes-empty-icon" aria-hidden="true">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true" focusable="false">
      <rect x="4" y="3" width="14" height="18" rx="2" />
      <line x1="7" y1="8" x2="14" y2="8" />
      <line x1="7" y1="12" x2="14" y2="12" />
      <line x1="7" y1="16" x2="11" y2="16" />
      <path d="M16.5 14.5 L20 18 L18 20 L14.5 16.5 Z" />
    </svg>
  </span>
  <h2 id="vb-notes-empty-heading" class="vb-notes-empty-heading">
    Capture your first idea
  </h2>
  <p class="vb-notes-empty-sub">
    Notes are for ideas, characters, places, and lore — anything that supports your scenes but isn&apos;t part of them.
  </p>
  <button
    class="vb-notes-empty-cta"
    type="button"
    data-testid="vb-notes-empty-cta"
  >
    + New note
  </button>
  <p class="vb-notes-empty-footer">
    Or chat with Brainstorm — it&apos;ll file notes for you.
  </p>
</section>
`;

function makePage(width) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SKY-94 empty-state fixture</title>
<style>
/* ---- repo tokens.css (verbatim) ---- */
${TOKENS_CSS}

/* ---- repo VaultBrowser.css (verbatim) ---- */
${VB_CSS}

/* ---- fixture shell ---- */
html, body { margin: 0; padding: 0; background: var(--bg-canvas); color: var(--text-body); font-family: var(--font-sans); }
body { display: flex; height: 100vh; align-items: stretch; }
.sidebar {
  width: ${width}px;
  height: 100%;
  border-right: 1px solid var(--glass-border, rgba(255,255,255,0.08));
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
}
/* Mimic the scope-bar + section header so the empty state sits in the same
   visual context as the real Notes Vault panel. */
.vb-scope-bar { display: flex; gap: 2px; padding: 6px 8px 4px; flex-shrink: 0;
  border-bottom: 1px solid var(--glass-border, rgba(255,255,255,0.08)); }
.vb-scope-btn { flex: 1; background: none; border: 1px solid transparent;
  border-radius: var(--radius-xs, 3px); color: var(--text-muted);
  font-size: var(--text-xs, 0.7rem); font-weight: 500; padding: 3px 6px; }
.vb-scope-btn.vb-scope-active { color: var(--neon-cyan); border-color: var(--neon-cyan); background: rgba(0,240,255,0.06); }
.vb-notes-vault { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.canvas-spacer { flex: 1; background: var(--bg-app); }

/* Disable mount fade so screenshots capture the final opacity-1 state */
.vb-notes-empty { animation: none !important; opacity: 1 !important; }
</style>
</head>
<body>
  <div class="sidebar">
    <div class="vb-scope-bar" role="group" aria-label="Vault scope">
      <button class="vb-scope-btn">Story</button>
      <button class="vb-scope-btn">Notes</button>
      <button class="vb-scope-btn vb-scope-active" aria-pressed="true">Both</button>
    </div>
    <div class="vb-notes-vault" data-testid="vb-notes-vault">
      <div class="vb-section-header">
        <span class="vb-section-label">Notes Vault</span>
        <button class="vb-section-add" aria-label="New Note">+</button>
      </div>
      ${EMPTY_STATE_HTML}
    </div>
  </div>
  <div class="canvas-spacer"></div>
</body>
</html>`;
}

const WIDTHS = [180, 240, 320];
const THEMES = ['default', 'high'];
const STATES = ['baseline', 'hover', 'focus'];

async function main() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();

  let n = 0;
  for (const width of WIDTHS) {
    await page.setContent(makePage(width), { waitUntil: 'networkidle' });

    for (const theme of THEMES) {
      await page.evaluate((t) => {
        const root = document.documentElement;
        if (t === 'high') root.setAttribute('data-contrast', 'high');
        else root.removeAttribute('data-contrast');
      }, theme);
      await page.waitForTimeout(100);

      for (const state of STATES) {
        // Reset focus/hover between captures
        await page.evaluate(() => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        });
        await page.mouse.move(2000, 2000);
        await page.waitForTimeout(40);

        if (state === 'hover') {
          await page.locator('[data-testid="vb-notes-empty-cta"]').hover();
        } else if (state === 'focus') {
          // Chromium 119+ supports element.focus({focusVisible:true}) — this
          // forces :focus-visible regardless of input modality. Fall back to
          // a Tab walk if the explicit option is unavailable.
          await page.evaluate(() => {
            const btn = document.querySelector('[data-testid="vb-notes-empty-cta"]');
            if (btn instanceof HTMLElement) {
              try { btn.focus({ focusVisible: true }); }
              catch { btn.focus(); }
            }
          });
        }
        await page.waitForTimeout(220); // settle hover/focus transition (≥ --dur-hover-in)

        const name = `width-${width}_theme-${theme}_state-${state}.png`;
        await page.locator('.sidebar').screenshot({ path: path.join(ART, name) });
        n += 1;
        console.log(`  [${String(n).padStart(2, '0')}/18] ${name}`);
      }
    }
  }

  await browser.close();
  console.log(`\nWrote ${n} screenshots to ${path.relative(REPO, ART)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
