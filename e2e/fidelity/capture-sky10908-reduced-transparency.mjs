// SKY-10908 fidelity capture — settings overlay must stay glass (BackgroundStack
// visible through it) when the OS reports prefers-reduced-transparency: reduce.
// Only K8 high-contrast should still force the opaque backdrop.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky10908-reduced-transparency');
const VIEWPORT = { width: 1920, height: 1080 };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky10908-'));
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

const settingsBtn = page.getByRole('button', { name: /^settings$/i });
if (await settingsBtn.count()) await settingsBtn.first().click();
else await page.keyboard.press('Control+,');
await page.waitForSelector('.settings-overlay', { timeout: 10000 });
await page.waitForTimeout(1500);

await shot('01-settings-default-glass');

const overlayBg = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el).backgroundColor : null;
}, sel);

console.log('overlay bg (default):', await overlayBg('.settings-overlay'));

// Emulate the OS "reduce transparency" preference via CDP (what Chromium sends
// when Windows Settings > Accessibility > Visual effects > Transparency effects
// is OFF).
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
});
await page.waitForTimeout(800);
await shot('02-settings-reduced-transparency');
console.log('overlay bg (reduced-transparency):', await overlayBg('.settings-overlay'));

// K8 high-contrast must still force the opaque overlay.
await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
await page.waitForTimeout(600);
await shot('03-settings-high-contrast-still-opaque');
console.log('overlay bg (high-contrast):', await overlayBg('.settings-overlay'));

await app.close();
console.log('DONE', OUT);
