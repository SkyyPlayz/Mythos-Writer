// SKY-11480 / SKY-11496 fidelity capture — in-situ keyboard shortcuts dialog.
// Verifies OT-1 fix: overlay tier is floored at the mockup recipe
// (rgba(15,19,33,.97) / blur(24px)) regardless of glass slider position.
// Captures the shortcuts dialog at shipped defaults and at minimum-glass to
// prove the body is opaque and page content is not legible through it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _electron as electron } from 'playwright';
import { mainJs as MAIN_JS, outDir, requireBuild } from './lib.mjs';

requireBuild();
const OUT = outDir('capture-sky11480-insitu');
const VIEWPORT = { width: 1920, height: 1080 };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11480-'));
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
await page.waitForTimeout(500);

const shot = async (name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('  shot', name);
};

const overlayTokens = () => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    glassFillOverlay: cs.getPropertyValue('--glass-fill-overlay').trim(),
    blurPanelOverlay: cs.getPropertyValue('--blur-panel-overlay').trim(),
  };
});

const overlayStyle = () => page.evaluate(() => {
  const el = document.querySelector('.ln-overlay-surface');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    backgroundColor: cs.backgroundColor,
    backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
  };
});

// Open keyboard shortcuts dialog at shipped defaults (glassA=20, blur=1 → floor applies).
await page.keyboard.press('?');
await page.waitForTimeout(1500);

const dialog = page.locator('.ln-overlay-surface, [role="dialog"]').first();
if (await dialog.count()) {
  await shot('01-shortcuts-dialog-shipped-defaults');
  console.log('overlay tokens (shipped defaults):', await overlayTokens());
  console.log('.ln-overlay-surface computed style:', await overlayStyle());
} else {
  console.log('!! keyboard shortcuts dialog not found via ?; trying menu...');
  await page.keyboard.press('Escape');
}

// Dismiss and reopen at minimum-glass to prove floor holds.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Open Settings → Appearance, drag glass to minimum.
const settingsBtn = page.getByRole('button', { name: /^settings$/i });
if (await settingsBtn.count()) await settingsBtn.first().click();
else await page.keyboard.press('Control+,');
await page.waitForSelector('.settings-overlay, [data-testid="settings-dialog"]', { timeout: 10000 }).catch(() => {});
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
  await blurSlider.fill('1');
  await blurSlider.dispatchEvent('input');
  await blurSlider.dispatchEvent('change');
}
await page.waitForTimeout(800);

// Close settings without using the close button (harness rule #1).
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Reopen shortcuts dialog at minimum glass.
await page.keyboard.press('?');
await page.waitForTimeout(1500);

if (await page.locator('.ln-overlay-surface, [role="dialog"]').first().count()) {
  await shot('02-shortcuts-dialog-minimum-glass');
  console.log('overlay tokens (minimum glass):', await overlayTokens());
  console.log('.ln-overlay-surface computed style:', await overlayStyle());
}

await page.keyboard.press('Escape');
await app.close();
console.log('DONE', OUT);
