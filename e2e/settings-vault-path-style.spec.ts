import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedCompletedOnboarding(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.writeFileSync(
    path.join(storyVault, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, stories: [], scenes: [], entities: [] }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

test('Account Story Vault path uses runtime ellipsis styles in Settings', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-settings-vault-path-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVault = path.join(
    tempRoot,
    'Dropbox',
    'Mythos Writer',
    'Very Long Story Vault Folder Name For Runtime Ellipsis Verification',
  );
  const notesVault = path.join(tempRoot, 'notes-vault');
  seedCompletedOnboarding(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));

    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();

    const pathDisplay = page.locator('.settings-vault-path-display');
    await expect(pathDisplay).toContainText(storyVault);
    await expect(pathDisplay).toHaveAttribute('title', storyVault);

    const styles = await pathDisplay.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        overflow: style.overflow,
        overflowX: style.overflowX,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
      };
    });

    expect(styles).toMatchObject({
      overflow: 'hidden',
      overflowX: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
