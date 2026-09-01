/**
 * sky-11151-creation-primitive.spec.ts — QA independent acceptance tests
 *
 * Slice: SKY-11151 "[Vault surface] Creation primitive — template/blank/import
 * option set + Obsidian-parity empty" (parent spec SKY-11141 §3/§3a).
 * Written by QA (SKY-11173) from the spec, not from the implementation.
 * TEST FILE ONLY — no product code touched. Failures are expected and
 * routed to the slice owner; do not "fix" this file to make it pass by
 * loosening assertions.
 *
 * Real E2E across the process boundary: drives the actual first-run wizard
 * UI, which calls the real `onboarding:complete` IPC channel into
 * electron-main, which calls the real `createMythosVault` primitive and
 * writes to a real temp-dir filesystem. No window.api mocking.
 *
 * Run: xvfb-run --auto-servernum npx playwright test e2e/tests/sky-11151-creation-primitive.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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
async function dismissLegacyMigrationDialogIfPresent(page: Page): Promise<void> {
  const migrationDialog = page.getByTestId('gs-migration-dialog');
  if (await migrationDialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.getByTestId('gs-migration-never').click();
    await expect(migrationDialog).not.toBeVisible({ timeout: 5_000 });
  }
}

/**
 * Drives the real "Start blank" first-run path (card-start-blank ->
 * screen-custom-location -> screen-custom-template -> "Skip this — create
 * my vault") to a chosen NON-DEFAULT parent dir + custom name. This is the
 * only route in the current UI that reaches `customTemplate: 'blank'`
 * (SKY-11141 §3 item 2, "Start blank"). Returns the resolved mythos vault
 * root once the app shell has loaded.
 */
async function createBlankVaultViaWizard(
  page: Page,
  destParent: string,
  vaultName: string,
): Promise<void> {
  await expect(page.getByTestId('screen-step1')).toBeVisible({ timeout: 15_000 });
  await dismissLegacyMigrationDialogIfPresent(page);
  await page.getByTestId('card-start-blank').click();

  await expect(page.getByTestId('screen-custom-location')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('custom-vault-path-input').fill(destParent);
  // Give the debounced path validator (400-500ms) time to settle before
  // touching the name field / clicking Next (AC-OB-20 territory).
  await page.waitForTimeout(700);
  await page.getByTestId('custom-vault-name-input').fill(vaultName);
  await page.waitForTimeout(700);
  await page.getByTestId('custom-location-next').click();

  await expect(page.getByTestId('screen-custom-template')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('custom-template-blank').click();
  await page.getByTestId('custom-template-finish').click();

  // step3 is a transient scaffolding spinner; the app shell replaces the
  // whole wizard once onboarding:complete resolves.
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
}

function listVisibleEntries(dir: string): string[] {
  return fs.readdirSync(dir).filter((e) => !e.startsWith('.'));
}

test.describe('SKY-11151 creation primitive — Obsidian-parity blank vault (§3a)', () => {
  test('AC-CP-01: "Start blank" creates the vault at the CHOSEN non-default location and name, verified on disk (§4c reachability)', async () => {
    const userData = freshUserData('mythos-cp01-');
    const destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp01-dest-'));
    const vaultName = 'QA Blank Vault One';
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await createBlankVaultViaWizard(page, destParent, vaultName);

      const mythosRoot = path.join(destParent, vaultName);
      expect(fs.existsSync(mythosRoot), `expected vault at chosen non-default path ${mythosRoot}`).toBe(true);
      expect(fs.existsSync(path.join(mythosRoot, 'mythos.json'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  // Gated pending SKY-11151 (blank vaults still scaffold Story/Notes/Agent
  // Vault dirs). Slice owner removes this fixme as part of SKY-11151 done-criteria.
  test.fixme('AC-CP-02: blank vault has ZERO visible folders/files — Obsidian-parity empty (§3a hard requirement) (pending SKY-11151)', async () => {
    const userData = freshUserData('mythos-cp02-');
    const destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp02-dest-'));
    const vaultName = 'QA Blank Vault Two';
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await createBlankVaultViaWizard(page, destParent, vaultName);

      const mythosRoot = path.join(destParent, vaultName);
      const visible = listVisibleEntries(mythosRoot);
      // Spec (SKY-11141 §3a / SKY-11151 "Obsidian-parity empty" AC): "Blank"
      // must create ONLY genuine machinery — nothing the user sees in the
      // tree. No Story Vault/Notes Vault/Agent Vault, no Templates.md, no
      // My First Story. A fresh empty vault should *read* as empty.
      expect(
        visible,
        'blank vault must have no user-visible folders — Story Vault/Notes Vault/Agent Vault are current machinery leaking into the tree',
      ).toEqual([]);
    } finally {
      await app.close();
    }
  });

  // Gated pending SKY-11151 (blank vaults still scaffold Story/Notes/Agent
  // Vault dirs). Slice owner removes this fixme as part of SKY-11151 done-criteria.
  test.fixme('AC-CP-03: the empty choice is PERSISTED — folders stay absent after a relaunch, not re-seeded on next boot (pending SKY-11151)', async () => {
    const userData = freshUserData('mythos-cp03-');
    const destParent = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cp03-dest-'));
    const vaultName = 'QA Blank Vault Three';
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await createBlankVaultViaWizard(page, destParent, vaultName);
    } finally {
      await app.close();
    }

    // Relaunch pointed at the SAME userData (same active vault) — this is
    // the actual failure mode the spec calls out: a later start / index
    // rebuild / health repair re-seeding an already-blank vault.
    const app2 = await launchApp(userData);
    try {
      const page2 = await app2.firstWindow();
      await expect(page2.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

      const mythosRoot = path.join(destParent, vaultName);
      const visible = listVisibleEntries(mythosRoot);
      expect(
        visible,
        'a relaunch must never re-seed a vault that was created blank',
      ).toEqual([]);
    } finally {
      await app2.close();
    }
  });
});

test.describe('SKY-11151 — sample-story path removal (§3)', () => {
  // Gated pending SKY-11151 (card-sample not yet removed). Slice owner
  // removes this fixme as part of SKY-11151 done-criteria.
  test.fixme('AC-CP-04: the first-run card set has exactly 3 options (template/blank/import) — no 4th "sample" card (pending SKY-11151)', async () => {
    const userData = freshUserData('mythos-cp04-');
    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await expect(page.getByTestId('screen-step1')).toBeVisible({ timeout: 15_000 });

      // Spec: "The generated sample-story path is REMOVED (card-sample + its
      // genre picker + the story seeding)." Rewrite target: 3 cards —
      // template (RECOMMENDED default) / blank / import.
      await expect(page.getByTestId('card-sample'), 'card-sample must be removed per SKY-11141 §3').toHaveCount(0);
      await expect(page.getByTestId('card-start-blank')).toBeVisible();
      await expect(page.getByTestId('card-import-obsidian')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11151 — one shared primitive, reused everywhere (§3)', () => {
  // Gated pending SKY-11151 (Settings "New vault…" has no template/blank/import
  // choice yet). Slice owner removes this fixme as part of SKY-11151 done-criteria.
  test.fixme('AC-CP-05: Settings "New vault…" offers the SAME template/blank/import option set as first run (pending SKY-11151)', async () => {
    const storyVault = path.join(os.tmpdir(), `mythos-cp05-story-${Date.now()}`);
    const notesVault = path.join(os.tmpdir(), `mythos-cp05-notes-${Date.now()}`);
    fs.mkdirSync(storyVault, { recursive: true });
    fs.mkdirSync(notesVault, { recursive: true });
    const userData = freshUserData('mythos-cp05-');
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

      const newVaultBtn = page.getByTestId('mvs-new-vault');
      await newVaultBtn.scrollIntoViewIfNeeded();
      await newVaultBtn.click();
      await expect(page.getByTestId('mvs-create-form')).toBeVisible();

      // Spec (SKY-11141 §3): "The same three choices appear at first run, at
      // New Mythos vault…, and in Add vault…. Build the option set ONCE and
      // reuse it." The inline create form must expose template/blank/import,
      // not silently default to seedMode:'default' with no choice at all.
      const optionControls = page.locator(
        '[data-testid="mvs-create-form"] [role="radio"], [data-testid="mvs-create-form"] input[type="radio"], [data-testid="mvs-create-form"] [data-testid*="blank"], [data-testid="mvs-create-form"] [data-testid*="import"], [data-testid="mvs-create-form"] [data-testid*="template"]',
      );
      await expect(
        optionControls.first(),
        'Settings "New vault…" must expose the shared template/blank/import primitive, not create a demo-seeded vault unconditionally',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});
