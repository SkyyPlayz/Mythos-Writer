/**
 * sky-11152-onboarding-add-vault-dialog.spec.ts — QA independent acceptance tests
 *
 * Slice: SKY-11152 "[Vault surface] Onboarding + Add-vault dialog UI — build
 * to design, rewrite four-path ACs" (parent spec SKY-11141 §3b/§3c).
 * Written by QA (SKY-11173) from the spec, not from the implementation.
 * TEST FILE ONLY — no product code touched, and this file does NOT modify
 * the existing e2e/onboarding-four-paths.spec.ts (owned by the SKY-11151/
 * SKY-11152 engineers, mid-rewrite). Failures here are expected for
 * not-yet-built UI and are routed to the slice owner.
 *
 * Real E2E across the process boundary: drives the actual wizard/Settings
 * UI, real IPC into electron-main, real filesystem. No window.api mocking.
 *
 * Run: xvfb-run --auto-servernum npx playwright test e2e/tests/sky-11152-onboarding-add-vault-dialog.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

function freshUserData(prefix: string): string {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempRoot, 'userData');
}

// SKY-8211: detectLegacyVaults() scans the real OS home dir (not the test's
// isolated --user-data-dir), so on a machine with a stray legacy vault this
// dialog can appear over the wizard and intercept clicks. Dismiss it if present
// (same guard as e2e/custom-template-lifecycle.spec.ts).
async function dismissLegacyMigrationDialogIfPresent(page: import('@playwright/test').Page): Promise<void> {
  const migrationDialog = page.getByTestId('gs-migration-dialog');
  if (await migrationDialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.getByTestId('gs-migration-never').click();
    await expect(migrationDialog).not.toBeVisible({ timeout: 5_000 });
  }
}

function listAllFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listAllFiles(full));
    else out.push(full);
  }
  return out;
}

test.describe('SKY-11152 first-run step 3 — name + destination on EVERY path (§3b step 3)', () => {
  // Gated pending SKY-11152 (name+destination step not yet built). Slice
  // owner removes this fixme as part of SKY-11152 done-criteria.
  test.fixme('AC-OB3-01: name+destination step shows a live "WILL BE CREATED AT" full-path preview (pending SKY-11152)', async () => {
    const userData = freshUserData('mythos-ob01-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-step1')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-start-blank').click();
      await expect(page.getByTestId('screen-custom-location')).toBeVisible({ timeout: 10_000 });

      const destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob01-dest-'));
      await page.getByTestId('custom-vault-path-input').fill(destParent);
      await page.waitForTimeout(700);
      await page.getByTestId('custom-vault-name-input').fill('QA Preview Vault');
      await page.waitForTimeout(700);

      // Spec (SKY-11141 §3b step 3): "Name your vault": VAULT NAME, CREATE IT
      // IN (Default folder / Browse…), a live WILL BE CREATED AT full-path
      // preview. This step exists on EVERY path, not just import.
      const preview = page.getByText(/will be created at/i);
      await expect(
        preview,
        'the name/destination step must show a live "WILL BE CREATED AT" full-path preview per SKY-11141 §3b',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11152 first-run step 2 — import/restore (§3b step 2)', () => {
  test('AC-OB3-02: import screen has SEPARATE Notes and Story rows, each with its own Browse control', async () => {
    const userData = freshUserData('mythos-ob02-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-step1')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-import-obsidian').click();
      await expect(page.getByTestId('screen-step-import')).toBeVisible({ timeout: 10_000 });

      await expect(page.getByTestId('import-obs-notes-path')).toBeVisible();
      await expect(page.getByTestId('import-obs-notes-browse')).toBeVisible();
      await expect(page.getByTestId('import-obs-story-path')).toBeVisible();
      await expect(page.getByTestId('import-obs-story-browse')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  // Gated pending SKY-11152 (import screen copy not yet added). Slice owner
  // removes this fixme as part of SKY-11152 done-criteria.
  test.fixme('AC-OB3-03: import screen states "One is enough — leave the other empty and it starts blank" (pending SKY-11152)', async () => {
    const userData = freshUserData('mythos-ob03-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-step1')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-import-obsidian').click();
      await expect(page.getByTestId('screen-step-import')).toBeVisible({ timeout: 10_000 });

      await expect(
        page.getByText(/one is enough.*leave the other empty.*starts blank/i),
        'spec-mandated copy for the Notes/Story import rows is missing (SKY-11141 §3b step 2)',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });

  test('AC-OB3-04: importing from a source folder creates a NEW Mythos vault — never adopts/writes into the source (SKY-11132 class)', async () => {
    const userData = freshUserData('mythos-ob04-');
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob04-source-'));
    fs.writeFileSync(path.join(sourceDir, 'Character - Kael.md'), '# Kael\n\nA note.');
    fs.writeFileSync(path.join(sourceDir, 'Location - The Sunken Gate.md'), '# The Sunken Gate\n');
    const sourceFilesBefore = listAllFiles(sourceDir).sort();

    const app = await launchApp(userData);
    try {
      // Patch ONLY dialog.showOpenDialog (native OS picker — Playwright
      // cannot drive it); the real Browse handler + IPC + disk writes still
      // run (same accepted pattern as e2e/obsidian-import-fidelity.spec.ts).
      await app.evaluate(({ dialog }, { dir }: { dir: string }) => {
        (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
        });
      }, { dir: sourceDir });

      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-step1')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-import-obsidian').click();
      await expect(page.getByTestId('screen-step-import')).toBeVisible({ timeout: 10_000 });

      await page.getByTestId('import-obs-notes-browse').click();
      await expect(page.getByTestId('import-obs-notes-path')).toHaveValue(sourceDir, { timeout: 5_000 });

      const importBtn = page.getByTestId('import-action-btn');
      await expect(importBtn).toBeEnabled({ timeout: 5_000 });
      await importBtn.click();

      // The dry-run report render is async (real filesystem scan) — wait for
      // it, then confirm.
      const dryRunConfirm = page.getByTestId('obs-report-confirm');
      await dryRunConfirm.waitFor({ state: 'visible', timeout: 15_000 });
      await dryRunConfirm.click();

      // A successful import still routes through the shared guided-setup
      // theme + AI-provider steps before the shell mounts — finish each as
      // it appears (bounded loop, not this ticket's concern to assert on).
      const postImportSteps = [
        page.getByTestId('custom-theme-continue'),
        page.getByTestId('wiz-provider-finish'),
      ];
      for (let i = 0; i < postImportSteps.length; i++) {
        const stepBtn = postImportSteps[i];
        const appeared = await stepBtn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
        if (appeared) await stepBtn.click();
      }
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 30_000 });

      const sourceFilesAfter = listAllFiles(sourceDir).sort();
      expect(sourceFilesAfter, 'the source folder must be untouched by import (never adopted/written into)').toEqual(sourceFilesBefore);
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11152 settings-side add-vault dialogs (§3c)', () => {
  // Gated pending SKY-11152 (settings-side add-vault dialogs not yet built).
  // Slice owner removes this fixme as part of SKY-11152 done-criteria.
  test.fixme('AC-OB3-05: Settings exposes "+ Add Notes Vault" / "+ Add Story Vault" dialogs reusing the creation primitive, with NO location picker (pending SKY-11152)', async () => {
    const storyVault = path.join(os.tmpdir(), `mythos-ob05-story-${Date.now()}`);
    const notesVault = path.join(os.tmpdir(), `mythos-ob05-notes-${Date.now()}`);
    fs.mkdirSync(storyVault, { recursive: true });
    fs.mkdirSync(notesVault, { recursive: true });
    const userData = freshUserData('mythos-ob05-');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(
      path.join(userData, 'app-settings.json'),
      JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
    );
    fs.writeFileSync(
      path.join(userData, 'vault-settings.json'),
      JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
    );

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
      await page.locator('.app-menu-gear-btn').click();
      await page.getByRole('tab', { name: 'Vault & Files' }).click();

      // Spec (SKY-11141 §3c): "+ Add Notes Vault" / "+ Add Story Vault" on
      // the Vault & Files settings page, adopting design's "Add a Notes
      // Vault" mockup — no location picker (destination is already
      // Notes/<name> or Stories/<name> inside the current Mythos vault).
      const addNotesVaultBtn = page.getByRole('button', { name: /add notes vault/i });
      await expect(
        addNotesVaultBtn,
        '"+ Add Notes Vault" dialog trigger not found on the Vault & Files settings page (SKY-11141 §3c)',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});
