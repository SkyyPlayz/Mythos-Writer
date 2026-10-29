// User path: a fresh profile, a note created from the Notes UI, then the file
// replaced with a symlink. Saving must toast the shortcut refusal and leave
// the link target untouched.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, '.notes-vault'), '');
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: {
        enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      brainstorm: {
        enabled: false, model: 'claude-sonnet-4-6', autoApply: false,
        confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
      archive: {
        enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60,
        autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000,
        maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000,
      },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
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

test('saving a symlinked note toasts the shortcut refusal and does not write outside', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-symlink-e2e-'));
  const userData = path.join(tempRoot, 'userData');
  const vaultDir = path.join(tempRoot, 'vault');
  const notesDir = path.join(tempRoot, 'notes');
  const outside = path.join(tempRoot, 'outside-note.md');
  fs.writeFileSync(outside, 'OUTSIDE-SENTINEL');
  seedUserData(userData, vaultDir, notesDir);

  const app = await launchApp(userData);
  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => localStorage.setItem('mythos:notes:defaultRich', '0'));

    await page.locator('button.nav-rail__item[aria-label="Notes Editor"]').click();
    const panel = page.locator('[data-testid="notes-tab-panel"]');
    await expect(panel).toBeVisible({ timeout: 12_000 });

    const before = new Set(walkMd(notesDir));
    const newNote = panel.locator('button[aria-label="New note"]').first();
    await expect(newNote).toBeVisible({ timeout: 8_000 });
    await newNote.click();

    const dialog = page.getByRole('dialog', { name: 'New Note from Template' });
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.locator('[data-testid="ntd-template-select"]').selectOption('__blank__');
    await dialog.locator('[data-testid="ntd-blank-title"]').fill('Sym Probe');
    await dialog.locator('[data-testid="ntd-submit"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    const created = await waitForNewMd(notesDir, before);
    expect(created).toBeTruthy();
    const notePath = created as string;

    fs.rmSync(notePath);
    fs.symlinkSync(outside, notePath);
    expect(fs.lstatSync(notePath).isSymbolicLink()).toBe(true);

    const textarea = panel.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 8_000 });
    await textarea.fill('this must not follow the link');
    await page.evaluate(() => window.dispatchEvent(new Event('mythos:save-note')));

    const toast = page.locator('[data-testid="app-toast"].app-toast--error');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toContainText("it's a shortcut (symbolic link)");
    await expect(toast).toContainText('Sym Probe.md');

    expect(fs.readFileSync(outside, 'utf8')).toBe('OUTSIDE-SENTINEL');
    expect(fs.lstatSync(notePath).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(notePath)).toBe(outside);

    await page.screenshot({ path: test.info().outputPath('vault-symlink-toast.png') });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function walkMd(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

async function waitForNewMd(dir: string, before: Set<string>): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const found = walkMd(dir).find((file) => !before.has(file));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}
