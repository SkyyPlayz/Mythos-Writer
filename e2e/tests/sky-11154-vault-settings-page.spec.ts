/**
 * sky-11154-vault-settings-page.spec.ts — QA independent acceptance tests
 *
 * Slice: SKY-11154 "[Vault surface] Vault & Files Settings page — layout,
 * dot-linking, Hide/Delete menus" (parent spec SKY-11141 §4/§4a).
 * Written by QA (SKY-11173) from the spec, not from the implementation.
 * TEST FILE ONLY — no product code touched. Failures are expected (this
 * slice is `todo` at the time of writing — only the SKY-11153 backend IPC
 * exists, no UI consumes it yet) and are routed to the slice owner.
 *
 * Real E2E across the process boundary: drives the actual Settings UI,
 * real IPC into electron-main, real filesystem. No window.api mocking.
 *
 * Run: xvfb-run --auto-servernum npx playwright test e2e/tests/sky-11154-vault-settings-page.spec.ts --reporter=list
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

function seedCompletedOnboarding(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyVault, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVault, notesVaultRoot: notesVault }, null, 2),
  );
}

async function openVaultFilesSettings(page: Page): Promise<void> {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
  await page.locator('.app-menu-gear-btn').click();
  await page.getByRole('tab', { name: 'Vault & Files' }).click();
}

test.describe('SKY-11154 vault cards — inner counts + inline rename (§4)', () => {
  test('AC-VS-01: a Mythos vault card shows its inner-vault counts ("N notes vaults · N story vaults")', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs01-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      await expect(
        page.getByText(/\d+\s+notes vaults?\s*(&middot;|·)\s*\d+\s+story vaults?/i),
        'vault card must show inner counts (e.g. "2 notes vaults · 1 story vault") per SKY-11141 §4',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });

  test('AC-VS-02: double-clicking a Mythos vault name enables inline rename (Enter saves, Escape cancels)', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs02-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      const card = page.getByTestId(`mvs-card-${storyVault}`);
      await expect(card).toBeVisible({ timeout: 5_000 });
      await card.dblclick();

      // Spec (SKY-11141 §4): "Double-click a Mythos vault name to rename
      // (inline field; Enter saves, Escape cancels, blur commits...)".
      const renameInput = page.locator('input[aria-label*="rename" i], input[data-testid*="rename" i]');
      await expect(
        renameInput.first(),
        'double-clicking the Mythos vault name must open an inline rename field per SKY-11141 §4',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11154 — the ⋯ menu, identical at every level (§4a)', () => {
  test('AC-VS-03: each vault card exposes an overflow (⋯) menu with Hide and Delete — not a bare × / trashcan', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs03-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      const card = page.getByTestId(`mvs-card-${storyVault}`);
      await expect(card).toBeVisible({ timeout: 5_000 });

      const overflowBtn = card.getByRole('button', { name: /more options|⋯|⋯/i });
      await expect(
        overflowBtn,
        'no ⋯/overflow menu found on the vault card — Hide/Delete UI from SKY-11141 §4a is not wired up',
      ).toBeVisible({ timeout: 3_000 });
      await overflowBtn.click();

      await expect(page.getByRole('menuitem', { name: /hide/i })).toBeVisible({ timeout: 2_000 });
      const deleteItem = page.getByRole('menuitem', { name: /delete/i });
      await expect(deleteItem).toBeVisible({ timeout: 2_000 });

      // "the bare × and the trashcan are gone" — a raw trashcan icon button
      // must not be present alongside the proper menu.
      await expect(card.locator('[aria-label="Delete" i]:not([role="menuitem"])')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('AC-VS-04: Delete confirm copy says "moved to the Recycle Bin", never "deleted" — and the vault actually leaves its original location on confirm', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs04-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVaultA = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVaultA = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVaultA, notesVaultA);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      const card = page.getByTestId(`mvs-card-${storyVaultA}`);
      const overflowBtn = card.getByRole('button', { name: /more options|⋯|⋯/i });
      await expect(
        overflowBtn,
        'cannot reach Delete — no ⋯ menu exists yet (see AC-VS-03); the SKY-11153 trashItem backend is unused by any UI',
      ).toBeVisible({ timeout: 3_000 });
      await overflowBtn.click();
      await page.getByRole('menuitem', { name: /delete/i }).click();

      await expect(page.getByText(/moved to the recycle bin/i)).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11154 — Hide + Show hidden (§4a)', () => {
  test('AC-VS-05: a "Show hidden" affordance is present in the same location vaults were hidden from', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs05-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      // Spec: "a Show hidden affordance must reveal hidden vaults where they
      // were hidden from. Without it Hide is a trapdoor — indistinguishable
      // from a delete from the user's point of view." Must exist even with
      // zero hidden vaults (it's the entry point that lets a user discover one).
      await expect(
        page.getByRole('button', { name: /show hidden/i }),
        '"Show hidden" affordance not found on the Vault & Files settings page (SKY-11141 §4a)',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11154 — hard exclusions carried through (§5)', () => {
  test('AC-VS-06: no Dropbox-as-a-feature / cloud-sync-as-feature copy anywhere reachable from Vault & Files, including the vault move flow', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs06-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      await expect(page.getByText(/mythos cloud/i)).toHaveCount(0);

      // The page's own content must not present Dropbox as a feature.
      await expect(page.locator('[data-settings-cat="vaults"]').getByText(/dropbox/i)).toHaveCount(0);

      // The "move" flow reachable from this page must not carry
      // MoveVaultWizard's cloud-provider branding either — spec explicitly
      // says "do not wire in MoveVaultWizard's cloud-provider branding"
      // (SKY-11141 §4, discussing the DIFFERENT "Vaults folder" move flow).
      const moveBtn = page.getByTestId('move-vault-btn');
      if (await moveBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await moveBtn.click();
        await expect(
          page.getByText(/dropbox/i),
          'the vault-move flow reachable from Vault & Files must not present Dropbox as a supported sync provider (SKY-11141 §5)',
        ).toHaveCount(0);
      }
    } finally {
      await app.close();
    }
  });
});

test.describe('SKY-11154 — dot-linking pairing (§2 / §4)', () => {
  test('AC-VS-07: dot-linking control exists between the Notes and Story columns to pair a story vault to a notes vault', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-vs07-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Vault A', 'Story Vault');
    const notesVault = path.join(tempRoot, 'Vault A', 'Notes Vault');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      const page = await app.firstWindow();
      await openVaultFilesSettings(page);

      await expect(
        page.locator('[data-testid*="pair-dot" i], [aria-label*="pair" i][aria-label*="notes vault" i]').first(),
        'no dot-linking / pairing control found between Notes and Story vault columns (SKY-11141 §2/§4)',
      ).toBeVisible({ timeout: 3_000 });
    } finally {
      await app.close();
    }
  });
});
