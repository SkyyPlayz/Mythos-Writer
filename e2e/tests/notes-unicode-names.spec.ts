/**
 * notes-unicode-names.spec.ts — SKY-9027
 *
 * R3: note/folder names accept full Unicode including emoji; the only
 * forbidden characters are the OS-reserved set (`\ / : * ? " < > |`). This
 * suite is the native-Windows-CI-gating coverage for that root-cause fix
 * (sanitizeVaultName in shared/vaultNameSanitizer.ts) across every
 * filename-derivation path it touches: create, rename, open, wikilink-to,
 * and display (tree row + note-viewer header — this app has no separate
 * breadcrumb trail or per-note workspace tab for the Notes surface; the
 * note-viewer's filename header is the only "is this note's name displayed
 * correctly" surface it has) for both a note and a folder. Also re-asserts
 * the SKY-8881 POSIX-listing-path contract while in this code, since a
 * regression there would only surface on Windows.
 *
 * Run (after `npm run build:electron`):
 *   npx playwright test e2e/tests/notes-unicode-names.spec.ts --reporter=list
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

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');

const EMOJI_NOTE = '🔥 Note';
const EMOJI_FOLDER = '🌊 Folder';
const EMOJI_WIKILINK_TARGET = '🌙 Moonfall';

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
  const vaultSettings = { vaultRoot: vaultDir, notesVaultRoot: notesVaultDir };

  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesVaultDir, { recursive: true });
  fs.writeFileSync(path.join(userData, 'app-settings.json'), JSON.stringify(appSettings, null, 2));
  fs.writeFileSync(path.join(userData, 'vault-settings.json'), JSON.stringify(vaultSettings, null, 2));
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
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
  // The Notes Editor section hosts the same <VaultBrowser> component as
  // Story Writer's dockable "vault" panel (no chrome fork, per the M8
  // standing rule) but as the section's main content — it's where a
  // clicked row's content actually renders in <NoteViewer>, unlike opening
  // a note from Story Writer's side panel.
  await expect(pg.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await pg.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(pg.locator('[data-testid="vault-browser"]')).toBeVisible({ timeout: 8_000 });
  const notesBtn = pg.locator('[data-testid="vb-scope-notes"]');
  if (await notesBtn.isVisible().catch(() => false)) await notesBtn.click();
}

async function waitUntil(fn: () => boolean, timeoutMs = 8_000, stepMs = 100): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return fn();
}

async function ensureExpanded(pg: Page, rowTestId: string): Promise<void> {
  const row = pg.locator(`[data-testid="${rowTestId}"]`);
  const expanded = await row.getAttribute('aria-expanded');
  if (expanded !== 'true') await row.click();
}

let appInst: ElectronApplication;
let pg: Page;
let tmpBase: string;
let vaultDir: string;
let notesVaultDir: string;
let userData: string;

test.beforeAll(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-unicode-names-'));
  vaultDir = path.join(tmpBase, 'story-vault');
  notesVaultDir = path.join(tmpBase, 'notes-vault');
  userData = path.join(tmpBase, 'userdata');
  seedUserData(userData, vaultDir, notesVaultDir);
  appInst = await launchApp(userData);
  pg = await firstWindow(appInst);
});

test.afterAll(async () => {
  await appInst.close().catch(() => {});
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test('UN-01: creating a note named with an emoji preserves the name end-to-end', async () => {
  await openVaultTab(pg);

  const addBtn = pg.locator('[data-testid="vb-btn-new-note"]').first();
  await expect(addBtn).toBeVisible({ timeout: 6_000 });
  await addBtn.click();

  const dialog = pg.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 6_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill(EMOJI_NOTE);
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });

  // On disk: filename is the emoji title verbatim, not collapsed to "untitled".
  const onDisk = await waitUntil(() => fs.existsSync(path.join(notesVaultDir, `${EMOJI_NOTE}.md`)));
  expect(onDisk, `${EMOJI_NOTE}.md was not created on disk`).toBe(true);

  // Visible in the tree.
  await expect(pg.locator(`[data-testid="vb-row-${EMOJI_NOTE}.md"]`)).toBeVisible({ timeout: 8_000 });
});

test('UN-02: creating and renaming a folder to an emoji name preserves it end-to-end', async () => {
  await pg.locator('[data-testid="vb-btn-new-folder"]').click();
  const renameInput = pg.locator('.vb-rename-input');
  await expect(renameInput).toBeVisible({ timeout: 6_000 });
  await renameInput.fill(EMOJI_FOLDER);
  await renameInput.press('Enter');
  await expect(renameInput).not.toBeVisible({ timeout: 6_000 });

  const onDisk = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, EMOJI_FOLDER)) &&
    fs.statSync(path.join(notesVaultDir, EMOJI_FOLDER)).isDirectory(),
  );
  expect(onDisk, `${EMOJI_FOLDER}/ was not created on disk`).toBe(true);
  await expect(pg.locator(`[data-testid="vb-row-${EMOJI_FOLDER}"]`)).toBeVisible({ timeout: 8_000 });
});

test('UN-03: a note nested inside the emoji folder opens and displays its emoji name in the tree and note viewer', async () => {
  await pg.locator(`[data-testid="vb-row-${EMOJI_FOLDER}"]`).click({ button: 'right' });
  await pg.locator('[data-testid="vb-context-menu"] [data-testid="menu-item-new-note"]').click();
  const dialog = pg.locator('.ntd-dialog');
  await expect(dialog).toBeVisible({ timeout: 6_000 });
  await dialog.locator('[data-testid="ntd-blank-title"]').fill(EMOJI_NOTE);
  await dialog.locator('[data-testid="ntd-submit"]').click();
  await expect(dialog).not.toBeVisible({ timeout: 6_000 });

  // SKY-8881 regression guard: the listing's relative path must be POSIX
  // (forward slash) even on Windows — this locator only matches if the
  // backend joined `${folder}/${note}` rather than emitting a backslash.
  const nestedPath = `${EMOJI_FOLDER}/${EMOJI_NOTE}.md`;
  const onDisk = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, EMOJI_FOLDER, `${EMOJI_NOTE}.md`)),
  );
  expect(onDisk, `${nestedPath} was not created on disk`).toBe(true);

  await ensureExpanded(pg, `vb-row-${EMOJI_FOLDER}`);
  const row = pg.locator(`[data-testid="vb-row-${nestedPath}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Open it — M8d replaced .note-viewer-filename with a breadcrumb nav;
  // the last breadcrumb item shows the note title (without .md extension).
  await row.click();
  await expect(
    pg.locator('[data-testid="note-breadcrumb"] .note-breadcrumb-item--current', { hasText: EMOJI_NOTE }),
  ).toBeVisible({ timeout: 8_000 });
});

test('UN-04: renaming an existing note to an emoji name renames it on disk and in the tree', async () => {
  const originalPath = `${EMOJI_FOLDER}/${EMOJI_NOTE}.md`;
  const renamedTarget = '🎉 Celebration';

  await pg.locator(`[data-testid="vb-row-${originalPath}"]`).dblclick();
  const input = pg.locator('.vb-rename-input');
  await expect(input).toBeVisible({ timeout: 6_000 });
  await input.fill(renamedTarget);
  await input.press('Enter');
  await expect(input).not.toBeVisible({ timeout: 6_000 });

  const onDisk = await waitUntil(() =>
    fs.existsSync(path.join(notesVaultDir, EMOJI_FOLDER, `${renamedTarget}.md`)) &&
    !fs.existsSync(path.join(notesVaultDir, EMOJI_FOLDER, `${EMOJI_NOTE}.md`)),
  );
  expect(onDisk, `note was not renamed to ${renamedTarget}.md on disk`).toBe(true);
  await expect(
    pg.locator(`[data-testid="vb-row-${EMOJI_FOLDER}/${renamedTarget}.md"]`),
  ).toBeVisible({ timeout: 8_000 });
});

// ─── UN-05: wikilink-to-create, standalone app instance ──────────────────────
//
// A fresh instance (fixture written before launch) rather than reusing the
// sequential `pg` above — the running app's in-memory vault index would not
// pick up a file dropped onto disk by a direct fs.writeFileSync mid-session.

test.describe('UN-05: wikilink-to-create with an emoji target', () => {
  let wlApp: ElectronApplication;
  let wlTmpBase: string;
  let wlNotesVaultDir: string;

  test.beforeAll(async () => {
    wlTmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-unicode-wikilink-'));
    const wlVaultDir = path.join(wlTmpBase, 'story-vault');
    wlNotesVaultDir = path.join(wlTmpBase, 'notes-vault');
    const wlUserData = path.join(wlTmpBase, 'userdata');
    seedUserData(wlUserData, wlVaultDir, wlNotesVaultDir);
    fs.writeFileSync(
      path.join(wlNotesVaultDir, 'Hub.md'),
      `Unresolved: [[${EMOJI_WIKILINK_TARGET}]].\n`,
    );
    wlApp = await launchApp(wlUserData);
  });

  test.afterAll(async () => {
    await wlApp.close().catch(() => {});
    fs.rmSync(wlTmpBase, { recursive: true, force: true });
  });

  test('clicking an unresolved emoji wikilink creates and opens the emoji-named note', async () => {
    const wlPage = await firstWindow(wlApp);
    await openVaultTab(wlPage);

    await wlPage.locator('[data-testid="vb-row-Hub.md"]').click();
    await expect(wlPage.locator('.note-viewer [data-testid="note-gear-btn"]')).toBeVisible({ timeout: 8_000 });
    await wlPage.locator('.note-viewer [data-testid="note-gear-btn"]').click();
    await expect(wlPage.locator('[data-testid="note-gear-menu"]')).toBeVisible();
    await wlPage.locator('[data-testid="note-gear-mode-rich"]').click();
    await expect(wlPage.locator('.note-viewer .ProseMirror')).toBeVisible();

    const unresolved = wlPage.locator(`.note-viewer [data-wiki-link="${EMOJI_WIKILINK_TARGET}"]`);
    await expect(unresolved).toHaveClass(/wiki-link-unresolved/);
    await unresolved.click();

    // M8d replaced .note-viewer-filename with a breadcrumb nav.
    await expect(
      wlPage.locator('[data-testid="note-breadcrumb"] .note-breadcrumb-item--current', { hasText: EMOJI_WIKILINK_TARGET }),
    ).toBeVisible({ timeout: 8_000 });
    expect(fs.existsSync(path.join(wlNotesVaultDir, `${EMOJI_WIKILINK_TARGET}.md`))).toBe(true);
    expect(fs.readFileSync(path.join(wlNotesVaultDir, `${EMOJI_WIKILINK_TARGET}.md`), 'utf-8')).toContain(
      `# ${EMOJI_WIKILINK_TARGET}`,
    );
  });
});
