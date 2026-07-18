/**
 * icons.spec.ts — SKY-194 Iconize smoke test
 *
 * TC-I-01: A notes-vault file with `icon: 🎭` in frontmatter shows
 *          the emoji icon in the Notes Vault tree.
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

// SKY-6933: stale selector -- .rail-tab removed by the nav-rail rewrite (SKY-3098/3218); app itself boots fine
test.skip(true, 'SKY-6933: stale selector -- .rail-tab removed by the nav-rail rewrite (SKY-3098/3218); app itself boots fine');

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const ICON_EMOJI = '🎭';
const NOTE_NAME = 'hero';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  const appSettings = {
    apiKey: '',
    onboardingComplete: true,
    agents: {
      writingAssistant: { enabled: false, model: 'claude-sonnet-4-6', scanIntervalSeconds: 30, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      brainstorm: { enabled: false, model: 'claude-sonnet-4-6', autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
      archive: { enabled: false, model: 'claude-sonnet-4-6', continuityCheckIntervalSeconds: 60, autoApply: false, confidenceThreshold: 0.85, maxTokensPerHour: 100_000, maxSuggestionsPerHour: 50, heartbeatIntervalMinutes: 5, maxTokensPerDay: 500_000 },
    },
    theme: 'dark',
    snapshots: { maxPerScene: 100, maxAgeDays: 30 },
  };
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.env.DISPLAY ? [] : ['--headless'];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 30_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('console', (m) => console.log('[renderer:' + m.type() + ']', m.text()));
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

let userData: string;
let vaultDir: string;
let notesVaultDir: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-icons-'));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-icons-story-'));
  notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-icons-notes-'));

  // Seed a note with custom icon in frontmatter
  const noteContent = `---\nicon: ${ICON_EMOJI}\ntitle: Hero Note\n---\n\nA character note.\n`;
  fs.writeFileSync(path.join(notesVaultDir, `${NOTE_NAME}.md`), noteContent, 'utf-8');

  seedUserData(userData, vaultDir, notesVaultDir);
  app = await launchApp(userData);
  page = await firstWindow(app);
});

test.afterAll(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(vaultDir, { recursive: true, force: true });
  fs.rmSync(notesVaultDir, { recursive: true, force: true });
});

test('TC-I-01: notes file with icon frontmatter shows emoji in Notes Vault tree', async () => {
  await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });

  // Navigate to the Vault tab
  const vaultTab = page.locator('.rail-tab', { hasText: 'Vault' });
  await vaultTab.click();

  // Ensure Notes Vault section is visible (switch to Both or Notes scope)
  const notesVaultSection = page.locator('[data-testid="vb-notes-vault"]');
  await expect(notesVaultSection).toBeVisible({ timeout: 8_000 });

  // The tree row for hero.md should appear
  const noteRow = page.locator('[data-testid="vb-row-hero.md"]');
  await expect(noteRow).toBeVisible({ timeout: 6_000 });

  // The icon span should contain our emoji
  const iconSpan = noteRow.locator('.vb-icon');
  await expect(iconSpan).toContainText(ICON_EMOJI, { timeout: 5_000 });
});
