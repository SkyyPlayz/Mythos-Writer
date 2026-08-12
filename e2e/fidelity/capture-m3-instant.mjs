// M3 (SKY-9021) fidelity evidence: create story → instantly writable.
// Captures the app's post-create state (Full Book depth, caret in the empty
// scene, "Start writing…" ghost, row-3 story title) plus the prototype's
// Story Writer at Full Book depth for the P0.3 side-by-side.
// Harness rules: see lib.mjs header (no Close-clicks, dismiss `Not now` first,
// verify nav via --active, never pipe the runner through `head`).
//
// Run (app frames need a display; wrap in `xvfb-run --auto-servernum`):
//   npm run build:electron && node e2e/fidelity/capture-m3-instant.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild, serveProto, chromiumLaunchOptions } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-m3-instant');
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1920, height: 1080 };

// ── App: empty vault, M3 flag ON (the surface under review) ──────────────────
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-m3cap-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-m3cap-'));
const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotesVault-m3cap-'));

const agentCfg = { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 1e5, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 5e5 };
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, onboardingStartMode: 'skip', notesTabUpgradeToastShown: true,
  instantCreateStory: true,
  agents: { writingAssistant: { ...agentCfg, scanIntervalSeconds: 30 }, brainstorm: agentCfg, archive: { ...agentCfg, continuityCheckIntervalSeconds: 60 } },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir, layoutMode: 'blank' }, null, 2));

const app = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'], timeout: 90000 });
const page = await app.firstWindow();
page.on('dialog', d => void d.accept().catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize(VIEWPORT);
try { await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }); } catch {}
await page.waitForTimeout(2500);
for (const l of ['Not now', 'Dismiss', 'Got it']) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.isVisible({ timeout: 500 }).catch(() => false)) await b.click().catch(() => {});
}

await page.screenshot({ path: `${OUT}/1-app-before-create-empty-vault.png` });
console.log('  shot 1-app-before-create-empty-vault');

// The create action — navigator "+" — then the caret lands with zero clicks.
await page.locator('[aria-label="New story"]').click();
await page.waitForFunction(
  () => (document.activeElement?.getAttribute('data-testid') ?? '').startsWith('msv-para-'),
  undefined, { timeout: 20000 },
);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/2-app-instant-writable-fullbook-caret.png` });
console.log('  shot 2-app-instant-writable-fullbook-caret');

// Type without any other interaction — proves the click→caret contract on film.
await page.keyboard.type('The first line lands on disk, no clicks in between.');
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/3-app-typed-without-interposed-clicks.png` });
console.log('  shot 3-app-typed-without-interposed-clicks');

await app.close().catch(() => {});

// ── Prototype: Story Writer at Full Book depth (the M3 landing state) ────────
const proto = await serveProto();
const browser = await chromium.launch(chromiumLaunchOptions());
const ppage = await browser.newPage({ viewport: VIEWPORT });
await ppage.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
await ppage.waitForTimeout(3500);
const pickedZoom = await ppage.evaluate(() => {
  const els = [...document.querySelectorAll('div,span,button,a')];
  const hit = els.filter(e => (e.innerText || '').trim() === 'Full Book' && getComputedStyle(e).cursor === 'pointer');
  hit.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height);
  if (!hit.length) return false;
  hit[0].click();
  return true;
});
if (!pickedZoom) console.log('  MISS prototype "Full Book" zoom option');
await ppage.waitForTimeout(1600);
await ppage.screenshot({ path: `${OUT}/4-proto-story-writer-fullbook.png` });
console.log('  shot 4-proto-story-writer-fullbook');

await browser.close().catch(() => {});
proto.server?.close?.();
console.log('done → ' + OUT);
process.exit(0);
