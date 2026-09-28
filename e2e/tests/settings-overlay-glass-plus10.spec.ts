/**
 * settings-overlay-glass-plus10.spec.ts — A1 / 09 §2.1 glass tiers
 *
 * At default glassA=20:
 *   --glass-fill-overlay / --glass2 → clamp(.50,.97, glassA/100+.16) = .50
 *   --pop                          → clamp(.86,.99, glassA/100+.10) = .86
 *   --glass-settings               → glassA+10 = .30
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/settings-overlay-glass-plus10.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

function makeTemp(glassA = 20): { tempRoot: string; userData: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-overlay-plus10-'));
  const userData = path.join(tempRoot, 'userData');
  const storyDir = path.join(tempRoot, 'story-vault');
  const notesDir = path.join(tempRoot, 'notes-vault');
  for (const d of [userData, storyDir, notesDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      liquidNeonV2: { glassA, blur: 1 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
  return { tempRoot, userData };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

function parseAlpha(rgba: string): number {
  const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/.exec(rgba);
  if (!m) throw new Error(`parseAlpha: not a color: ${rgba}`);
  return m[1] === undefined ? 1 : Number(m[1]);
}

test('glassA=20 → overlay .50, --pop .86, Settings glassA+10', async () => {
  const { tempRoot, userData } = makeTemp(20);
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(userData);
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });

    const tokenFill = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--glass-fill-overlay').trim(),
    );
    const popFill = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pop').trim(),
    );
    const settingsFill = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--glass-settings').trim(),
    );

    // Overlay / glass2 floor (.50) — denser than panel glass, thinner than --pop.
    expect(parseAlpha(tokenFill)).toBeGreaterThanOrEqual(0.5);
    expect(parseAlpha(tokenFill)).toBeLessThanOrEqual(0.501);
    // A1 --pop floor (.86) — menus/toasts stay opaque at low glassA.
    expect(parseAlpha(popFill)).toBeGreaterThanOrEqual(0.86);
    expect(parseAlpha(popFill)).toBeLessThanOrEqual(0.861);
    expect(parseAlpha(popFill)).toBeGreaterThan(parseAlpha(tokenFill));
    // Settings view glass = glassA + 10 → .30 at default.
    expect(parseAlpha(settingsFill)).toBeGreaterThanOrEqual(0.3);
    expect(parseAlpha(settingsFill)).toBeLessThanOrEqual(0.301);

    const panelToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--glass-fill').trim(),
    );
    expect(parseAlpha(panelToken)).toBeLessThan(parseAlpha(tokenFill));

    await page.getByRole('button', { name: 'Open settings' }).first().click();
    const panel = page.locator('.settings-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const panelBg = await panel.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Settings paints --glass-settings (glassA+10), not the denser overlay tier.
    expect(parseAlpha(panelBg)).toBeGreaterThanOrEqual(0.3);
    expect(parseAlpha(panelBg)).toBeLessThanOrEqual(0.31);
  } finally {
    await app?.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
