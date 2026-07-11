/**
 * note-templates.spec.ts — SKY-190
 *
 * E2E test: create a note from a template with prompted fields.
 *
 * Acceptance criteria:
 *   TC-NT-01  Template dialog opens — clicking "+" in Notes Vault shows the
 *             NoteTemplateDialog (template select + fields visible).
 *   TC-NT-02  Prompt field resolves — filling the "Scene Title" prompt field and
 *             submitting writes a .md file whose title frontmatter matches the input.
 *   TC-NT-03  Blank note fallback — selecting "Blank note" and providing a name
 *             creates a plain note with title frontmatter.
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
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

  const vaultSettings = {
    vaultRoot: vaultDir,
    notesVaultRoot: notesVaultDir,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(appSettings, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify(vaultSettings, null, 2),
  );
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

async function openVaultTab(pg: Page): Promise<void> {
  const vaultTab = pg.locator('.rail-tab', { hasText: 'Vault' });
  await expect(vaultTab).toBeVisible({ timeout: 8_000 });
  await vaultTab.click();
  await expect(pg.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });
}

function findMdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

// ─── Suite-level state ────────────────────────────────────────────────────────

let appInst: ElectronApplication;
let pg: Page;
let tmpBase: string;
let vaultDir: string;
let notesVaultDir: string;
let userData: string;

test.beforeAll(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-note-tpl-'));
  vaultDir = path.join(tmpBase, 'story-vault');
  notesVaultDir = path.join(tmpBase, 'notes-vault');
  userData = path.join(tmpBase, 'userdata');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });

  seedUserData(userData, vaultDir, notesVaultDir);
  appInst = await launchApp(userData);
  pg = await firstWindow(appInst);
});

test.afterAll(async () => {
  await appInst.close().catch(() => {});
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test('TC-NT-01: clicking + in Notes Vault opens the template dialog', async () => {
  await openVaultTab(pg);

  // Switch to Notes scope so the "+" button is accessible
  const notesBtn = pg.locator('[data-testid="vb-scope-notes"]');
  await expect(notesBtn).toBeVisible({ timeout: 6_000 });
  await notesBtn.click();

  // Click the "New note" toolbar button
  const addBtn = pg.locator('[data-testid="vb-btn-new-note"]').first();
  await expect(addBtn).toBeVisible({ timeout: 6_000 });
  await addBtn.click();

  // Dialog should appear
  await expect(pg.locator('[data-testid="ntd-template-select"]')).toBeVisible({ timeout: 6_000 });
});

test('TC-NT-02: filling prompt fields and submitting creates a note on disk', async () => {
  // Dialog is still open from TC-NT-01; if not, reopen it
  const templateSelect = pg.locator('[data-testid="ntd-template-select"]');
  if (!(await templateSelect.isVisible())) {
    const addBtn = pg.locator('[data-testid="vb-btn-new-note"]').first();
    await addBtn.click();
    await expect(templateSelect).toBeVisible({ timeout: 6_000 });
  }

  // Select "Default Scene" template
  await templateSelect.selectOption({ label: 'Default Scene' });

  // Fill the "Scene Title" prompt field (key: title)
  const titleField = pg.locator('[data-testid="ntd-field-title"]');
  await expect(titleField).toBeVisible({ timeout: 4_000 });
  await titleField.fill('The Opening');

  // Fill the "Time of Day" prompt field (key: time_of_day)
  const todField = pg.locator('[data-testid="ntd-field-time_of_day"]');
  await expect(todField).toBeVisible({ timeout: 4_000 });
  await todField.fill('Dawn');

  // Submit
  await pg.locator('[data-testid="ntd-submit"]').click();

  // Dialog should close
  await expect(pg.locator('[data-testid="ntd-template-select"]')).not.toBeVisible({ timeout: 6_000 });

  // A .md file should now exist in the notes vault
  const files = findMdFiles(notesVaultDir);
  expect(files.length).toBeGreaterThan(0);

  // Find the one with "the-opening" in its path
  const noteFile = files.find((f) => f.includes('the-opening'));
  expect(noteFile).toBeDefined();

  // Verify it contains the resolved title
  const content = fs.readFileSync(noteFile!, 'utf-8');
  expect(content).toContain('The Opening');
  expect(content).toContain('Dawn');
});

test('TC-NT-03: blank note fallback creates a plain note', async () => {
  // Open the dialog again
  const addBtn = pg.locator('[data-testid="vb-btn-new-note"]').first();
  await addBtn.click();
  await expect(pg.locator('[data-testid="ntd-template-select"]')).toBeVisible({ timeout: 6_000 });

  // Select "Blank note"
  const templateSelect = pg.locator('[data-testid="ntd-template-select"]');
  await templateSelect.selectOption({ value: '__blank__' });

  // Fill the blank title
  const blankTitle = pg.locator('[data-testid="ntd-blank-title"]');
  await expect(blankTitle).toBeVisible({ timeout: 4_000 });
  await blankTitle.fill('My Research Notes');

  const before = findMdFiles(notesVaultDir).length;

  await pg.locator('[data-testid="ntd-submit"]').click();
  await expect(pg.locator('[data-testid="ntd-template-select"]')).not.toBeVisible({ timeout: 6_000 });

  const after = findMdFiles(notesVaultDir);
  expect(after.length).toBeGreaterThan(before);

  const newFile = after.find((f) => !f.includes('the-opening'));
  expect(newFile).toBeDefined();
  const content = fs.readFileSync(newFile!, 'utf-8');
  expect(content).toContain('title:');
});
