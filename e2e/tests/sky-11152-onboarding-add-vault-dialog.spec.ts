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
// (same guard pattern used elsewhere for this dialog).
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
  // SKY-11152 done: the wizard's own testids are screen-welcome/card-start-blank
  // /screen-name/step3-* (not the guessed screen-step1/screen-custom-location/
  // custom-vault-*-input — those belonged to the OLD pre-SKY-11152 wizard).
  // The AC's INTENT — a live "WILL BE CREATED AT" full-path preview on every
  // path — is what's asserted; retargeted to the real implementation.
  test('AC-OB3-01: name+destination step shows a live "WILL BE CREATED AT" full-path preview', async () => {
    const userData = freshUserData('mythos-ob01-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-start-blank').click();
      await expect(page.getByTestId('screen-name')).toBeVisible({ timeout: 10_000 });

      const destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-ob01-dest-'));
      await page.getByTestId('step3-path-path').fill(destParent);
      await page.getByTestId('step3-vault-name').fill('QA Preview Vault');

      // Spec (SKY-11141 §3b step 3): "Name your vault": VAULT NAME, CREATE IT
      // IN (Default folder / Browse…), a live WILL BE CREATED AT full-path
      // preview. This step exists on EVERY path, not just import.
      const preview = page.getByText(/will be created at/i);
      await expect(
        preview,
        'the name/destination step must show a live "WILL BE CREATED AT" full-path preview per SKY-11141 §3b',
      ).toBeVisible({ timeout: 3_000 });
      await expect(page.getByTestId('step3-full-path')).toHaveText(path.join(destParent, 'QA Preview Vault'));
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11152 first-run step 2 — import (§3b step 2)', () => {
  test('AC-OB3-02: import screen has SEPARATE Notes and Story rows, each with its own Browse control', async () => {
    const userData = freshUserData('mythos-ob02-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-import-obsidian').click();
      await expect(page.getByTestId('screen-import')).toBeVisible({ timeout: 10_000 });

      await expect(page.getByTestId('step2-notes-path')).toBeVisible();
      await expect(page.getByTestId('step2-notes-browse')).toBeVisible();
      await expect(page.getByTestId('step2-story-path')).toBeVisible();
      await expect(page.getByTestId('step2-story-browse')).toBeVisible();
    } finally {
      await app.close();
    }
  });

  // SKY-11152 done: real copy check, no shortcuts — the wizard's own
  // screen-welcome/screen-import testids replace the guessed screen-step1/
  // screen-step-import.
  test('AC-OB3-03: import screen states "One is enough — leave the other empty and it starts blank"', async () => {
    const userData = freshUserData('mythos-ob03-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-import-obsidian').click();
      await expect(page.getByTestId('screen-import')).toBeVisible({ timeout: 10_000 });

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
      await expect(page.getByTestId('screen-welcome')).toBeVisible({ timeout: 15_000 });
      await dismissLegacyMigrationDialogIfPresent(page);
      await page.getByTestId('card-import-obsidian').click();
      await expect(page.getByTestId('screen-import')).toBeVisible({ timeout: 10_000 });

      await page.getByTestId('step2-notes-browse').click();
      await expect(page.getByTestId('step2-notes-path')).toHaveValue(sourceDir, { timeout: 5_000 });

      // SKY-11152: the old guessed "import-action-btn" is this wizard's
      // step2-continue — clicking it runs a real (no-write) dry-run scan and
      // renders the report sub-view before anything is created.
      const continueBtn = page.getByTestId('step2-continue');
      await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
      await continueBtn.click();

      const dryRunConfirm = page.getByTestId('step2-report-confirm');
      await dryRunConfirm.waitFor({ state: 'visible', timeout: 15_000 });
      await dryRunConfirm.click();

      // SKY-11152 (§3b): confirming the dry-run report lands on the shared
      // mandatory "Name your vault" step for EVERY path (not a separate
      // finish path) — complete it for real: accept the default name and
      // click the create/finish action. This is the step that actually calls
      // createVaultFromOptions and writes the new vault to disk.
      await expect(page.getByTestId('screen-name')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('step3-vault-name').fill('AC-OB3-04 Vault');
      await page.getByTestId('step3-open-vault').click();

      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 30_000 });

      const sourceFilesAfter = listAllFiles(sourceDir).sort();
      expect(sourceFilesAfter, 'the source folder must be untouched by import (never adopted/written into)').toEqual(sourceFilesBefore);
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11152 settings-side add-vault dialogs (§3c)', () => {
  // SKY-11152 done: "+ Add Notes Vault" / "+ Add Story Vault" are real, wired
  // into the Vault & Files tab (frontend/src/SettingsPanel.tsx via
  // AddVaultButtonsSection -> AddVaultDialog), no location picker.
  test('AC-OB3-05: Settings exposes "+ Add Notes Vault" / "+ Add Story Vault" dialogs reusing the creation primitive, with NO location picker', async () => {
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
      // Vault" mockup — no location picker (destination is always computed,
      // never chosen).
      const addNotesVaultBtn = page.getByRole('button', { name: /add notes vault/i });
      await expect(
        addNotesVaultBtn,
        '"+ Add Notes Vault" dialog trigger not found on the Vault & Files settings page (SKY-11141 §3c)',
      ).toBeVisible({ timeout: 3_000 });
      const addStoryVaultBtn = page.getByRole('button', { name: /add story vault/i });
      await expect(addStoryVaultBtn, '"+ Add Story Vault" dialog trigger not found').toBeVisible({ timeout: 3_000 });

      await addNotesVaultBtn.click();
      const dialog = page.getByTestId('avd-dialog-notes');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(dialog.getByText('Add a Notes Vault')).toBeVisible();
      // The 3 "HOW TO START" options, reusing the SKY-11151 creation
      // primitive's modes — this is the substance of "reusing the creation
      // primitive" from the AC title.
      await expect(page.getByTestId('avd-mode-notes-template')).toBeVisible();
      await expect(page.getByTestId('avd-mode-notes-blank')).toBeVisible();
      await expect(page.getByTestId('avd-mode-notes-import')).toBeVisible();
      // NO location picker anywhere in the dialog: none of the stale design
      // draft's nvLocs chips (This PC / Dropbox / Custom folder) or any
      // Cloud/Dropbox wording (hard exclusion, spec §5).
      await expect(dialog.getByText('This PC')).toHaveCount(0);
      await expect(dialog.getByText('Dropbox')).toHaveCount(0);
      await expect(dialog.getByText(/cloud/i)).toHaveCount(0);
      await expect(dialog.getByTestId(/browse/i)).toHaveCount(0);

      await page.getByTestId('avd-cancel-notes').click();
      await expect(dialog).toBeHidden({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});
