// SKY-11047 fidelity capture — the Brainstorm chat panel (.brainstorm-page)
// was painting a flat --bg-base fill (never engine-tracked glass/blur), same
// class of bug as SKY-10914's Settings panel. This capture proves the
// Appearance tab's Glass opacity slider now visibly, live changes the
// Brainstorm panel's own background, with no reload.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11047-brainstorm-glass');
const VIEWPORT = { width: 1920, height: 1080 };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11047-'));
const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'MythosVault-'));

fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify({
  apiKey: '', onboardingComplete: true, notesTabUpgradeToastShown: true,
  gettingStartedDismissed: true, vaultUpgradePromptShown: true,
  agents: {
    writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
    brainstorm: { enabled: true, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500000 },
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

const panelStyle = (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const cs = el ? getComputedStyle(el) : null;
  return {
    backgroundColor: cs ? cs.backgroundColor : null,
    backdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
  };
}, selector);

// SKY-3737/SKY-3218: Brainstorm is a top-level panel reached via Ctrl+3
// (see e2e/brainstorm.spec.ts openBrainstormPanel()).
await page.keyboard.press('Control+3');
await page.waitForSelector('#app-tabpanel-brainstorm', { timeout: 10000 });
await page.waitForTimeout(1000);

await shot('01-brainstorm-default-v2-glass');
console.log('brainstorm-page style (default):', await panelStyle('.brainstorm-page'));
console.log('brainstorm-header style (default):', await panelStyle('.brainstorm-header'));

// Open Settings > Appearance and drag Glass opacity to a distinctly
// different value — both the Brainstorm panel AND its header must react
// live, in the same document, with no reload (§4c reachability).
const settingsBtn = page.getByRole('button', { name: /^settings$/i });
if (await settingsBtn.count()) await settingsBtn.first().click();
else await page.keyboard.press('Control+,');
await page.waitForSelector('.settings-overlay', { timeout: 10000 });
await page.waitForTimeout(1000);

const appearanceTab = page.getByRole('tab', { name: /appearance/i }).or(page.getByRole('button', { name: /appearance/i }));
if (await appearanceTab.count()) await appearanceTab.first().click().catch(() => {});
await page.waitForTimeout(500);

const glassSlider = page.locator('input[type="range"][aria-label*="Glass" i], input[type="range"][name*="glass" i]').first();
if (await glassSlider.count()) {
  await glassSlider.fill('85');
  await glassSlider.dispatchEvent('input');
  await glassSlider.dispatchEvent('change');
  await page.waitForTimeout(600);
} else {
  console.log('!! Glass opacity slider not found — see SKY-10914 capture for probe reconnaissance');
}

// Close Settings back to the still-mounted Brainstorm panel underneath.
await page.keyboard.press('Escape');
await page.waitForSelector('.settings-overlay', { state: 'detached', timeout: 5000 }).catch(() => {});
await page.waitForTimeout(600);

await shot('02-brainstorm-glass-opacity-85-live');
console.log('brainstorm-page style (Glass opacity dragged to 85):', await panelStyle('.brainstorm-page'));
console.log('brainstorm-header style (Glass opacity dragged to 85):', await panelStyle('.brainstorm-header'));

await app.close();
console.log('DONE', OUT);
