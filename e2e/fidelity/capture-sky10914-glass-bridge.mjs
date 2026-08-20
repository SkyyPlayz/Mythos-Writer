// SKY-10914 fidelity capture — the Appearance tab's Glass opacity/Backdrop
// blur sliders (v2 engine) must visibly, live change the Settings panel's own
// background, and every accessibility override (K8 high-contrast,
// prefers-reduced-transparency) must still force its state regardless.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky10914-glass-bridge');
const VIEWPORT = { width: 1920, height: 1080 };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10914-'));
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

const panelStyle = () => page.evaluate(() => {
  const panel = document.querySelector('.settings-panel');
  const cs = panel ? getComputedStyle(panel) : null;
  return {
    backgroundColor: cs ? cs.backgroundColor : null,
    backdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
  };
});

const settingsBtn = page.getByRole('button', { name: /^settings$/i });
if (await settingsBtn.count()) await settingsBtn.first().click();
else await page.keyboard.press('Control+,');
await page.waitForSelector('.settings-overlay', { timeout: 10000 });
await page.waitForTimeout(1500);

await shot('01-settings-default-v2-glass');
console.log('panel style (default, v2 glassA:20/blur:1):', await panelStyle());

// Open the Appearance tab and drag Glass opacity to a distinctly different
// value — the panel background must react live, in the same document, with
// no reload. This is the exact symptom Skyy reported (sliders as no-ops).
const appearanceTab = page.getByRole('tab', { name: /appearance/i }).or(page.getByRole('button', { name: /appearance/i }));
if (await appearanceTab.count()) await appearanceTab.first().click().catch(() => {});
await page.waitForTimeout(500);

const glassSlider = page.locator('input[type="range"][aria-label*="Glass" i], input[type="range"][name*="glass" i]').first();
if (await glassSlider.count()) {
  await glassSlider.fill('85');
  await glassSlider.dispatchEvent('input');
  await glassSlider.dispatchEvent('change');
  await page.waitForTimeout(600);
  await shot('02-settings-glass-opacity-85-live');
  console.log('panel style (Glass opacity dragged to 85):', await panelStyle());
} else {
  console.log('!! Glass opacity slider not found — see probe reconnaissance if this regresses');
}

// K8 high-contrast must still force the opaque, no-blur panel regardless of
// slider position (regression guard for the earlier SKY-10908 fix).
await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
await page.waitForTimeout(600);
await shot('03-settings-high-contrast-still-opaque');
console.log('panel style (K8 high-contrast):', await panelStyle());
await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
await page.waitForTimeout(400);

// prefers-reduced-transparency must still leave the panel glass (SKY-10908).
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
});
await page.waitForTimeout(600);
await shot('04-settings-reduced-transparency-stays-glass');
console.log('panel style (prefers-reduced-transparency):', await panelStyle());

await app.close();
console.log('DONE', OUT);
