/**
 * Probe C6 — NotesVaultPicker "Import a vault…" opens create-vault import
 * flow with dry-run first; nothing written before confirm.
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

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const NOW = '2026-08-01T00:00:00.000Z';

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
  const bundle = path.dirname(storyVault);
  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-c6',
      name: 'C6 Vault',
      createdAt: NOW,
      stories: [],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );
}

/** Snapshot destinations that createVaultFromOptions / import would touch. */
function diskFingerprint(tempRoot: string, notesVault: string, userData: string): string {
  const walk = (root: string): string[] => {
    if (!fs.existsSync(root)) return [];
    const out: string[] = [];
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const full = path.join(cur, ent.name);
        const rel = path.relative(tempRoot, full);
        if (ent.isDirectory()) {
          out.push(`D:${rel}`);
          stack.push(full);
        } else {
          const st = fs.statSync(full);
          out.push(`F:${rel}:${st.size}:${st.mtimeMs}`);
        }
      }
    }
    return out.sort();
  };
  return JSON.stringify([
    ...walk(notesVault),
    ...walk(path.join(tempRoot, 'vaults')),
    ...walk(path.join(userData, 'vaults')),
    fs.existsSync(path.join(userData, 'vault-settings.json'))
      ? fs.readFileSync(path.join(userData, 'vault-settings.json'), 'utf-8')
      : '',
  ]);
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, ...extraArgs],
    env: { ...process.env, HOME: userData, MYTHOS_E2E: '1' },
    timeout: 60_000,
  });
}

async function patchOpenDialog(app: ElectronApplication, srcDir: string): Promise<void> {
  await app.evaluate(({ dialog }, { dir }: { dir: string }) => {
    (dialog as unknown as Record<string, unknown>).showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dir],
    });
  }, { dir: srcDir });
}

async function openNotesTab(pg: Page): Promise<void> {
  const nav = pg.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await nav.locator('button[aria-label="Notes Editor"]').click();
  await expect(pg.locator('[data-testid="notes-tab-panel"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('C6 NotesVaultPicker import dry-run', () => {
  test('Import a vault… opens dry-run first; cancel writes nothing', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-c6-import-'));
    const userData = path.join(tempRoot, 'userData');
    const storyVault = path.join(tempRoot, 'Story Vault');
    const notesVault = path.join(tempRoot, 'Notes Vault');
    const fixture = path.join(tempRoot, 'ImportSrc');
    fs.mkdirSync(path.join(fixture, 'Characters'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'Characters', 'Marcus.md'), '# Marcus\n');
    fs.writeFileSync(path.join(fixture, 'Prologue.md'), '# Prologue\n');
    seedCompletedOnboarding(userData, storyVault, notesVault);

    const app = await launchApp(userData);
    try {
      await patchOpenDialog(app, fixture);
      const page = await app.firstWindow({ timeout: 60_000 });
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar, .desktop-shell').first()).toBeVisible({ timeout: 60_000 });

      await openNotesTab(page);
      await page.locator('[data-testid="notes-vault-picker-btn"]').click();
      await expect(page.locator('[data-testid="notes-vault-picker-menu"]')).toBeVisible({ timeout: 6_000 });
      await page.locator('[data-testid="notes-vault-picker-menu"] [data-testid="menu-item-import"]').click();

      await expect(page.getByRole('dialog', { name: /Create a Mythos vault/i })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('rail-vault-mode-import')).toHaveAttribute('aria-checked', 'true');

      const before = diskFingerprint(tempRoot, notesVault, userData);
      const notesBrowse = page
        .locator('[data-testid="create-vault-import-path"]')
        .locator('..')
        .getByRole('button', { name: /Browse/i });
      await notesBrowse.click();
      await expect(page.getByTestId('create-vault-dryrun-notes')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('create-vault-dryrun-notes-md')).toContainText(/markdown/i);
      // Nothing written under notes vault / vault destinations before confirm.
      expect(diskFingerprint(tempRoot, notesVault, userData)).toBe(before);
      // Fixture source untouched.
      expect(fs.readFileSync(path.join(fixture, 'Prologue.md'), 'utf-8')).toBe('# Prologue\n');

      await page.getByTestId('create-vault-cancel').click();
      if (await page.getByTestId('gs-cancel-confirm').count()) {
        await page.getByTestId('create-vault-cancel-discard').click();
      }
      await expect(page.getByRole('dialog', { name: /Create a Mythos vault/i })).toHaveCount(0);
      expect(diskFingerprint(tempRoot, notesVault, userData)).toBe(before);
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
