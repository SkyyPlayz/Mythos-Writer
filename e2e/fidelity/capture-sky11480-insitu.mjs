// SKY-11480 pass 2 — in-situ evidence.
//   • computed chrome for the Scene Crafter / Boards canvas elements
//   • real dialogs and popovers opened through ordinary UI, screenshotted over
//     live content, so the overlay tier's live opacity is visible rather than
//     inferred from a probe.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11480-fidelity-sweep');
const VIEWPORT = { width: 1600, height: 1000 };

const NOTES = [
  ['Characters/Mira Veynn.md', 'Reluctant heir — resourceful, haunted.'],
  ['Characters/Kael Thorne.md', 'Smuggler — witty, guarded, survivor.'],
  ['Locations/The Sunken Gate.md', 'Ancient floodgate. Opens at low tide.'],
  ['Items & Systems/Drownlight.md', 'Burns underwater. Misbehaves near flame.'],
];

function seedFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11480b-user-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11480b-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-11480b-notes-'));
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
    apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
    gettingStartedDismissed: true, vaultUpgradePromptShown: true,
    ai: { enabled: true }, theme: 'dark',
  }, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2));
  for (const [rel, body] of NOTES) {
    const p = path.join(notesVaultDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return { userData, vaultDir, notesVaultDir };
}
const cleanup = (f) => { for (const d of Object.values(f)) fs.rmSync(d, { recursive: true, force: true }); };

const chromeOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return 'ABSENT';
  const cs = getComputedStyle(el);
  return {
    background: cs.backgroundColor,
    backgroundImage: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 70),
    backdropFilter: cs.backdropFilter,
    border: cs.borderTopWidth + ' ' + cs.borderTopColor,
    radius: cs.borderTopLeftRadius,
    boxShadow: cs.boxShadow.slice(0, 110),
    color: cs.color,
  };
}, sel);

async function shot(page, name, sel, pad = 14) {
  let clip;
  if (sel) {
    const box = await page.locator(sel).first().boundingBox().catch(() => null);
    if (!box) { console.log(`  MISS ${name}`); return false; }
    clip = {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: Math.min(box.width + pad * 2, VIEWPORT.width - Math.max(0, box.x - pad)),
      height: Math.min(box.height + pad * 2, VIEWPORT.height - Math.max(0, box.y - pad)),
    };
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(`  shot ${name}`);
  return true;
}

async function main() {
  const fixture = seedFixture();
  const app = await electron.launch({
    args: [mainJs, `--user-data-dir=${fixture.userData}`, '--no-sandbox'],
    env: { ...process.env, MYTHOS_DISABLE_BOOT_MIGRATION: '1' },
    timeout: 90000,
  });
  const page = await app.firstWindow();
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.setViewportSize(VIEWPORT);
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const report = { theme: null, boards: {}, sceneCrafter: {}, insitu: {} };

  report.theme = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return {
      '--glass-fill': g('--glass-fill'), '--glass-fill-overlay': g('--glass-fill-overlay'),
      '--glass-fill-fallback': g('--glass-fill-fallback'), '--blur-panel': g('--blur-panel'),
      '--blur-panel-overlay': g('--blur-panel-overlay'), '--glass2': g('--glass2'),
      '--b1': g('--b1'), '--g1': g('--g1'), '--gr': g('--gr'), '--bw': g('--bw'),
      '--bg-elevated': g('--bg-elevated'), '--border-default': g('--border-default'),
    };
  });
  console.log('theme:', JSON.stringify(report.theme));

  // ── in-situ overlay tier: an .ln-overlay-surface dialog over live content ──
  console.log('\n── in-situ dialogs ──');
  await page.locator('.wc-menu', { hasText: 'Help' }).click().catch(() => {});
  await page.waitForTimeout(350);
  await shot(page, 'insitu-wc-popover-help-menu', null);
  report.insitu['.wc-popover'] = await chromeOf(page, '.wc-popover');
  const ks = page.locator('.wc-menu-item', { hasText: 'Keyboard shortcuts' }).first();
  if (await ks.count()) {
    await ks.click();
    await page.waitForTimeout(700);
    await shot(page, 'insitu-keyboard-shortcuts-dialog', null);
    report.insitu['.ln-overlay-surface (KeyboardShortcutsDialog)'] =
      await chromeOf(page, '.ln-overlay-surface');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else { console.log('  MISS Keyboard shortcuts item'); await page.keyboard.press('Escape'); }

  // App-menu dropdown (half-migrated: opaque fallback fill, neutral rim).
  await page.locator('.app-menu-trigger, .app-menu-bar button').first().click().catch(() => {});
  await page.waitForTimeout(350);
  if (await page.locator('.app-menu-dropdown').count()) {
    await shot(page, 'insitu-app-menu-dropdown', null);
    report.insitu['.app-menu-dropdown'] = await chromeOf(page, '.app-menu-dropdown');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── Boards canvas ──
  console.log('\n── boards ──');
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"]').click();
  await page.locator('.board-canvas__root').waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(900);
  for (const sel of ['.boards-tab-panel', '.board-canvas__root', '.board-canvas__zoom-controls',
                     '.board-canvas__item', '.board-canvas__item--folder', '.board-canvas__item-title',
                     '.boards-tab-panel__breadcrumb', '.board-canvas__item-meta']) {
    report.boards[sel] = await chromeOf(page, sel);
  }
  await shot(page, 'boards-zoom-toolbar', '.board-canvas__zoom-controls', 18);
  await shot(page, 'boards-item-tiles', '.board-canvas__item', 26);
  // Right-click a tile — the Boards context menu is a floating surface too.
  await page.locator('.board-canvas__item').first().click({ button: 'right' }).catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, 'boards-context-menu', null);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── Scene Crafter ──
  console.log('\n── scene crafter ──');
  const before = await page.locator('.nav-story-row').count();
  await page.locator('.wc-menu', { hasText: 'File' }).click();
  await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
  await page.locator('.nav-story-row').nth(before).waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.nav-story-title').nth(before).click();
  await page.waitForTimeout(600);
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
  await page.locator('.sc-columns').waitFor({ state: 'visible', timeout: 12000 });
  await page.waitForTimeout(900);
  for (const sel of ['.scene-crafter-page', '.scene-crafter-header', '.sc-suggest', '.sc-panel',
                     '.sc-ref-col--characters', '.sc-ref-card', '.sc-ref-band', '.sc-ref-title',
                     '.sc-board-row', '.sc-board-row--new', '.sc-col-head', '.sc-sugg-card']) {
    report.sceneCrafter[sel] = await chromeOf(page, sel);
  }
  await shot(page, 'crafter-ref-card-detail', '.sc-ref-card', 18);
  await shot(page, 'crafter-suggest-rail', '.sc-suggest', 10);

  // POV dropdown + ref picker in situ (the two Scene Crafter overlay surfaces).
  await page.locator('.sc-pov-field input').first().click().catch(() => {});
  await page.waitForTimeout(350);
  if (await page.locator('.sc-pov-dropdown').count()) {
    await shot(page, 'insitu-sc-pov-dropdown', '.sc-col-setup', 8);
    report.insitu['.sc-pov-dropdown'] = await chromeOf(page, '.sc-pov-dropdown');
  }
  await page.keyboard.press('Escape');
  await page.locator('.sc-suggest-title').click().catch(() => {});
  await page.waitForTimeout(250);
  const addBtn = page.getByRole('button', { name: 'Add a note to CHARACTERS' });
  if (await addBtn.count()) {
    await addBtn.click();
    await page.locator('.sc-ref-picker').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(350);
    await shot(page, 'insitu-sc-ref-picker', '.sc-ref-col--characters', 8);
    report.insitu['.sc-ref-picker'] = await chromeOf(page, '.sc-ref-picker');
  }

  fs.writeFileSync(`${OUT}/report-insitu.json`, JSON.stringify(report, null, 2));
  console.log(`\nreport → ${OUT}/report-insitu.json`);
  await app.close().catch(() => {});
  cleanup(fixture);
}

main().catch((e) => { console.error(e); process.exit(1); });
