// SKY-11133 fidelity capture — reachability (§4c): at the owner's preferred
// LOW global glass/blur, Settings and popups must read the boosted overlay
// tier (opacity/blur × 1.25) instead of the plain global values, while the
// main app chrome keeps obeying the global sliders exactly.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11133-overlay-tier');
const VIEWPORT = { width: 1920, height: 1080 };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11133-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));

fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  agents: {
    writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
  },
  theme: 'dark', snapshots: { maxPerScene: 100, maxAgeDays: 30 },
}, null, 2));
fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify({ vaultRoot: vaultDir }, null, 2));

const app = await electron.launch({
  args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, MYTHOS_USER_DATA: userData },
});
const page = await app.firstWindow();
await page.setViewportSize(VIEWPORT);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(4000);

const notNow = page.getByRole('button', { name: /not now/i });
if (await notNow.count()) await notNow.first().click().catch(() => {});

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  shot', name);
};

const glassStyle = (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const cs = el ? getComputedStyle(el) : null;
  return {
    backgroundColor: cs ? cs.backgroundColor : null,
    backdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
  };
}, selector);

const rootTokens = () => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    glassFill: cs.getPropertyValue('--glass-fill').trim(),
    blurPanel: cs.getPropertyValue('--blur-panel').trim(),
    glassFillOverlay: cs.getPropertyValue('--glass-fill-overlay').trim(),
    blurPanelOverlay: cs.getPropertyValue('--blur-panel-overlay').trim(),
  };
});

// Open Settings, go to Appearance, drag Glass opacity + Backdrop blur to the
// owner's preferred LOW end of the sliders.
const settingsBtn = page.getByRole('button', { name: /^settings$/i });
if (await settingsBtn.count()) await settingsBtn.first().click();
else await page.keyboard.press('Control+,');
await page.waitForSelector('.settings-overlay', { timeout: 10000 });
await page.waitForTimeout(1500);

const appearanceTab = page.getByRole('tab', { name: /appearance/i }).or(page.getByRole('button', { name: /appearance/i }));
if (await appearanceTab.count()) await appearanceTab.first().click().catch(() => {});
await page.waitForTimeout(500);

const glassSlider = page.locator('input[type="range"][aria-label*="Glass" i], input[type="range"][name*="glass" i]').first();
const blurSlider = page.locator('input[type="range"][aria-label*="blur" i], input[type="range"][name*="blur" i]').first();

if (await glassSlider.count()) {
  await glassSlider.fill('5');
  await glassSlider.dispatchEvent('input');
  await glassSlider.dispatchEvent('change');
}
if (await blurSlider.count()) {
  await blurSlider.fill('2');
  await blurSlider.dispatchEvent('input');
  await blurSlider.dispatchEvent('change');
}
await page.waitForTimeout(800);

await shot('01-settings-at-low-global-glass');
console.log('tokens at low global glass:', await rootTokens());
console.log('.settings-panel computed style:', await glassStyle('.settings-panel'));

// Close Settings, open the app menu dropdown (File/Edit/...) at the same low
// global setting to confirm the overlay tier reads through there too.
const closeBtn = page.getByRole('button', { name: /close settings/i }).or(page.locator('.ln-dialog-close'));
if (await closeBtn.count()) await closeBtn.first().click().catch(() => {});
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(500);

const menuTrigger = page.locator('.app-menu-item-trigger').first();
if (await menuTrigger.count()) {
  await menuTrigger.click().catch(() => {});
  await page.waitForTimeout(400);
  await shot('02-app-menu-dropdown-at-low-global-glass');
  console.log('.app-menu-dropdown computed style:', await glassStyle('.app-menu-dropdown'));
} else {
  console.log('!! app menu trigger not found — see harness rules before adding new selectors');
}

await app.close();
console.log('DONE', OUT);
