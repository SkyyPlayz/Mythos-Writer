/**
 * F1 beta real-app screenshots @ 1440×900 → Agent Store media/beta-f1/
 * Pattern: e2e/fidelity/lib.mjs (requireBuild, electron launch, dismiss modals).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, requireBuild, outDir } from './lib.mjs';

requireBuild();

// Shield residual: never hardcode /cursor/stores/… — harness outDir (gitignored)
// or F1_PROOF_OUT for Agent Store captures when the coordinator sets it.
const OUT = process.env.F1_PROOF_OUT ?? outDir('beta-f1');
fs.mkdirSync(OUT, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f1cap-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-f1cap-'));
const notesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosNotes-f1cap-'));
fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  onboardingComplete: true, theme: 'dark', notesTabUpgradeToastShown: true,
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({
  vaultRoot: vaultDir, notesVaultRoot: notesDir,
}, null, 2));

const app = await electron.launch({
  args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
  timeout: 90_000,
});
const page = await app.firstWindow();
page.on('dialog', (d) => void d.accept('Chapter').catch(() => {}));
await page.waitForLoadState('domcontentloaded');
await page.setViewportSize({ width: 1440, height: 900 });
try {
  await page.locator('.app-menu-bar').first().waitFor({ state: 'visible', timeout: 25_000 });
} catch { /* boot race */ }
await page.waitForTimeout(2000);
for (const l of ['Not now', 'Dismiss', 'Got it', 'Skip']) {
  const b = page.locator(`button:has-text("${l}")`).first();
  if (await b.isVisible({ timeout: 400 }).catch(() => false)) await b.click().catch(() => {});
}
await page.keyboard.press('Escape').catch(() => {});

await page.locator('.wc-menu', { hasText: 'File' }).click();
await page.locator('.wc-menu-item', { hasText: 'New story' }).click();
await page.waitForTimeout(800);
await page.locator('.nav-story-title').first().click().catch(() => {});
await page.waitForTimeout(600);

async function shot(name) {
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, fullPage: false });
  console.log('wrote', dest);
}

// Toolbar / Full Book
await shot('f1-toolbar-1440x900.png');
await shot('f1-fullbook-1440x900.png');

// Structure
const structBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Structure"], button:has-text("Structure")').first();
if (await structBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
  await structBtn.click();
  await page.waitForTimeout(800);
}
await shot('f1-structure-1440x900.png');

// Boards
const boardsBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Boards"], button:has-text("Boards")').first();
if (await boardsBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
  await boardsBtn.click();
  await page.waitForTimeout(1000);
}
await shot('f1-boards-1440x900.png');

// Scene Crafter
const crafterBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').first();
if (await crafterBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
  await crafterBtn.click();
  await page.waitForTimeout(1000);
}
await shot('f1-crafter-1440x900.png');

// Toolbar height probe
const tbH = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="msv-toolbar"]');
  return el ? Math.round(el.getBoundingClientRect().height) : -1;
});
console.log('msv-toolbar height px:', tbH);

await app.close();
console.log('F1 real-app capture done →', OUT);
