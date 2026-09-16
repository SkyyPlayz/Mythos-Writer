// SKY-11448 fidelity capture — Scene Crafter Setup view against the owner's
// Liquid Neon mockup (Scene Crafter section, dc.html ~line 1427).
// Fresh profile, story created through the real File → New story flow, real
// rail click into Scene Crafter (§4c — nothing under test is pre-seeded; the
// vault notes only stock the reference columns, exactly as SKY-11072 did).
//   MW_MAIN_JS=<sibling out/main/main.js>  → "before" shots from another build
//   MW_PROTO=1                              → also capture the prototype side
//   MW_PROTO_HTML=<path to a dc.html>       → serve that mockup instead of the
//                                             repo prototype (same directory
//                                             must hold its assets/ + support.js)
// Harness rules: see lib.mjs header.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { chromium, _electron as electron } from 'playwright';
import { mainJs, outDir, repoRoot, requireBuild, serveProto, chromiumLaunchOptions } from './lib.mjs';

const MAIN_JS = process.env.MW_MAIN_JS || mainJs;
const TAG = process.env.MW_MAIN_JS ? 'before' : 'after';
if (!process.env.MW_MAIN_JS) requireBuild();
const OUT = outDir('capture-sky11448-scene-crafter-glass');
const VIEWPORT = { width: 1600, height: 1000 };

// The prototype's crafterVaultCols sample notes (stocks CHARACTERS / LOCATIONS /
// ITEMS & SYSTEMS so the reference cards render beside the mockup's).
const NOTES = [
  ['Characters/Mira Veynn.md', 'Reluctant heir — resourceful, haunted.'],
  ['Characters/Kael Thorne.md', 'Smuggler — witty, guarded, survivor.'],
  ['Characters/The Broker.md', 'Antagonist — elusive, always watching.'],
  ['Locations/The Undercity.md', 'Drowned streets, stacked walkways.'],
  ['Locations/The Sunken Gate.md', 'Ancient floodgate. Opens at low tide.'],
  ['Items & Systems/Map Fragment.md', 'Redraws itself at low tide.'],
  ['Items & Systems/Drownlight.md', 'Burns underwater. Misbehaves near flame.'],
];

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11448-cap-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11448-cap-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11448-cap-notes-'));
  const agentCfg = (extra = {}) => ({
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85,
    maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500000, ...extra,
  });
  // Appearance is left at the shipped defaults on purpose — a fresh profile is
  // exactly what the owner sees, and the default wallpaper is what the glass
  // has to read through.
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: true },
    agents: { writingAssistant: agentCfg(), brainstorm: agentCfg({ enabled: true }), archive: agentCfg() },
    theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
  for (const [rel, body] of NOTES) {
    const p = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { userData, vaultDir, notesVaultDir };
}

function cleanup(fixture) {
  for (const dir of Object.values(fixture)) fs.rmSync(dir, { recursive: true, force: true });
}

async function clipOf(page, selector, pad = 12) {
  const box = await page.locator(selector).first().boundingBox().catch(() => null);
  if (!box) return undefined;
  return {
    x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
    width: Math.min(box.width + pad * 2, VIEWPORT.width - Math.max(0, box.x - pad)),
    height: Math.min(box.height + pad * 2, VIEWPORT.height - Math.max(0, box.y - pad)),
  };
}

async function captureApp() {
  const fixture = seedFixture();
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${fixture.userData}`, '--no-sandbox'],
    env: { ...process.env, MYTHOS_DISABLE_BOOT_MIGRATION: '1' },
    timeout: 90000,
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Real flow: File → New story, select it, click the Scene Crafter rail entry.
  const before = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(before).waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.nav-story-title').nth(before).click();
  await page.waitForTimeout(500);
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(900);

  await page.screenshot({ path: `${OUT}/app-setup-view-${TAG}.png` });
  console.log(`  shot app-setup-view-${TAG}`);
  await page.screenshot({ path: `${OUT}/app-setup-crop-${TAG}.png`, clip: await clipOf(page, '.scene-crafter-page') });
  console.log(`  shot app-setup-crop-${TAG}`);

  // Computed-style evidence: is the page root actually frosted, and what are
  // the panel borders? Printed so the PR can cite numbers, not adjectives.
  const styles = await page.evaluate(() => {
    const pick = (sel, pseudo) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el, pseudo);
      return { background: cs.backgroundColor, backgroundImage: cs.backgroundImage.slice(0, 60), backdropFilter: cs.backdropFilter, border: cs.borderColor, boxShadow: cs.boxShadow.slice(0, 80) };
    };
    return { page: pick('.scene-crafter-page'), pageGlass: pick('.scene-crafter-page', '::before'), header: pick('.scene-crafter-header'), panel: pick('.sc-panel'), rail: pick('.sc-suggest'), suggCard: pick('.sc-sugg-card'), refCard: pick('.sc-ref-card') };
  });
  console.log('  computed:', JSON.stringify(styles, null, 2));

  // Overlay tier: POV character dropdown (opens on focus when cast cards exist).
  const pov = page.locator('.sc-pov-field input').first();
  await pov.click();
  await page.waitForTimeout(300);
  if (await page.locator('.sc-pov-dropdown').count()) {
    await page.screenshot({ path: `${OUT}/app-pov-dropdown-${TAG}.png`, clip: await clipOf(page, '.sc-col-setup', 8) });
    console.log(`  shot app-pov-dropdown-${TAG}`);
  } else {
    console.log('  MISS pov dropdown');
  }
  await page.keyboard.press('Escape');
  await page.locator('.sc-suggest-title').click();
  await page.waitForTimeout(200);

  // Overlay tier: the reference-column + picker.
  await page.getByRole('button', { name: 'Add a note to CHARACTERS' }).click();
  await page.locator('.sc-ref-picker').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/app-ref-picker-${TAG}.png`, clip: await clipOf(page, '.sc-ref-col--characters', 8) });
  console.log(`  shot app-ref-picker-${TAG}`);

  await app.close().catch(() => {});
  cleanup(fixture);
}

/** Stage an out-of-repo dc.html next to the repo prototype's runtime
 *  (support.js, babel, react, assets/) — the owner-report copies ship the
 *  html alone, and the dc runtime resolves those files relative to it. */
function stageExternalProto(htmlPath) {
  const protoDir = path.join(repoRoot, 'plans', 'design-handoff', 'v2', 'prototype');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11448-proto-'));
  for (const entry of fs.readdirSync(protoDir)) {
    if (!entry.endsWith('.html')) fs.symlinkSync(path.join(protoDir, entry), path.join(stage, entry));
  }
  fs.copyFileSync(path.resolve(htmlPath), path.join(stage, 'mockup.dc.html'));
  return { url: 'file://' + path.join(stage, 'mockup.dc.html'), close: () => fs.rmSync(stage, { recursive: true, force: true }) };
}

async function captureProto() {
  const proto = process.env.MW_PROTO_HTML ? stageExternalProto(process.env.MW_PROTO_HTML) : await serveProto();
  const browser = await chromium.launch(chromiumLaunchOptions(['--force-device-scale-factor=1', '--allow-file-access-from-files']));
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(proto.url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4500);
  // Rail entries carry title tooltips; fall back to a visible-text match.
  let clicked = false;
  const byTitle = page.locator('[title="Scene Crafter"]').first();
  if (await byTitle.count()) { await byTitle.click(); clicked = 'title'; }
  else {
    clicked = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div,span,button,a')].filter((e) => {
        if ((e.innerText || '').trim() !== 'Scene Crafter') return false;
        const r = e.getBoundingClientRect();
        return r.left < 110 && r.width > 8 && r.height > 8;
      });
      if (!els.length) return false;
      els.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
      els[0].click();
      return 'text';
    });
  }
  console.log('  proto rail click: ' + clicked);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/proto-crafter-view.png` });
  console.log('  shot proto-crafter-view');
  const crop = await page.locator('[data-screen-label="Scene Crafter"]').last().boundingBox().catch(() => null);
  if (crop) {
    await page.screenshot({ path: `${OUT}/proto-crafter-crop.png`, clip: { x: Math.max(0, crop.x - 12), y: Math.max(0, crop.y - 12), width: Math.min(crop.width + 24, VIEWPORT.width), height: Math.min(crop.height + 24, VIEWPORT.height) } });
    console.log('  shot proto-crafter-crop');
  }
  await browser.close();
  proto.close();
}

if (!process.env.MW_SKIP_APP) await captureApp();
if (process.env.MW_PROTO) await captureProto();
console.log('DONE');
