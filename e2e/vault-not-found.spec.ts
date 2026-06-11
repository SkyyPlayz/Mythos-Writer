import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedCompletedOnboarding(userData: string, missingStoryVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: missingStoryVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

test('missing Story Vault shows recovery screen after load-time vault check fails', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-missing-vault-'));
  const userData = path.join(tempRoot, 'userData');
  const missingStoryVault = path.join(tempRoot, 'missing-story-vault');
  const notesVault = path.join(tempRoot, 'notes-vault');
  seedCompletedOnboarding(userData, missingStoryVault, notesVault);

  const app = await launchApp(userData);
  try {
    expect(fs.existsSync(missingStoryVault)).toBe(false);

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vault:validate-path');
      ipcMain.handle('vault:validate-path', () => ({ valid: false }));
    });

    const page = await app.firstWindow();
    page.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));

    await expect(page.getByRole('heading', { name: 'Vault not found' })).toBeVisible();
    await expect(page.getByLabel('Missing vault path')).toContainText(missingStoryVault);
    await expect(page.getByRole('button', { name: 'Re-run setup' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quit' })).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
