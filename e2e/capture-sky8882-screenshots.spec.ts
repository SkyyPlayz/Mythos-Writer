/**
 * capture-sky8882-screenshots.spec.ts — one-off screenshot capture for
 * PR #1155 (SKY-8882 screenshot-check evidence). Not registered in CI.
 * Precedent: e2e/capture-folder-ops-screenshots.spec.ts (SKY-7995).
 *
 * Captures the new "Clear all data" PARTIAL-FAILURE state: fs.rmSync is
 * patched in the main process to swallow the vaults delete (the Windows
 * locked-handle failure mode), so the verify-after-rm path reports the
 * error and the Settings UI renders the failure headline.
 *
 *   xvfb-run -a npx playwright test e2e/capture-sky8882-screenshots.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../screenshots-sky8882');

test('capture: Clear all data partial-failure headline', async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-8882-shot-'));
  const userData = path.join(tmp, 'user-data');
  const bundle = path.join(userData, 'vaults', 'Mythos Vault');
  const vaultDir = path.join(bundle, 'Story Vault');
  const notesVaultDir = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  const agent = {
    enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
    confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
  };
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      apiKey: '',
      onboardingComplete: true,
      agents: {
        writingAssistant: { ...agent, scanIntervalSeconds: 30 },
        brainstorm: agent,
        archive: { ...agent, continuityCheckIntervalSeconds: 60 },
      },
      theme: 'dark',
      snapshots: { maxPerScene: 100, maxAgeDays: 30 },
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );

  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // Auto-answer the native keep-vs-delete MessageBox with "Delete
    // Everything", and simulate the Windows locked-handle failure: rmSync
    // silently leaves the vaults dir behind, exactly what force:true does
    // when a handle survives — the new verify path must catch it.
    await app.evaluate(({ dialog }) => {
      (dialog as unknown as Record<string, unknown>).showMessageBox =
        async () => ({ response: 1, checkboxChecked: false });
      const nodeFs = (process as unknown as {
        getBuiltinModule: (id: string) => typeof import('node:fs');
      }).getBuiltinModule('node:fs');
      const origRm = nodeFs.rmSync.bind(nodeFs);
      (nodeFs as { rmSync: unknown }).rmSync = (p: string, opts?: object) => {
        if (String(p).includes('vaults')) return;
        return origRm(p, opts as never);
      };
    });

    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();
    const dangerZone = page.locator('[data-testid="clear-data-danger-zone"]');
    await dangerZone.scrollIntoViewIfNeeded();
    await page.locator('[data-testid="clear-data-btn"]').click();
    await page.locator('[data-testid="clear-data-confirm-btn"]').click();

    await expect(page.locator('[data-testid="clear-data-partial"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="clear-data-errors"]')).toBeVisible();
    await dangerZone.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, 'clear-data-partial-failure.png') });
  } finally {
    const proc = app.process();
    await Promise.race([
      app.close().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try { if (!proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
