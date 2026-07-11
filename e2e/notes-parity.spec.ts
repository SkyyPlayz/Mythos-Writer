// SKY-3204 / SKY-3209 (B6): Notes rich-mode parity with Story via the shared
// <RichTextEditor> core — Underline, entity @-mentions, and wiki-links all work
// in Notes rich mode exactly as in Story, and the lossless source-of-truth
// contract (R1) holds: source mode stays byte-faithful, rich mode is opt-in.
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
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
  );
}

/** Seed an entity file so the @-mention picker has something to offer. */
function seedEntity(vaultDir: string, id: string, name: string): void {
  const dir = path.join(vaultDir, 'entities', 'characters');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    `---\nid: ${id}\nname: ${name}\ntype: character\n---\n\n${name} is a character.\n`,
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openNoteInRichMode(page: Page, noteBaseName: string): Promise<void> {
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await page.locator('[data-testid^="vb-row-"]', { hasText: noteBaseName }).first().click();
  await expect(page.locator('.note-viewer .note-mode-group[aria-label="Editor mode"]')).toBeVisible({ timeout: 8_000 });
  await page.locator('button.note-viewer-mode', { hasText: 'Rich' }).click();
  await expect(page.locator('button.note-viewer-mode', { hasText: 'Rich' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.note-viewer .ProseMirror')).toBeVisible();
}

let tempRoot: string;
let userData: string;
let vaultDir: string;
let notesDir: string;

test.beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-parity-'));
  userData = path.join(tempRoot, 'userData');
  vaultDir = path.join(tempRoot, 'vault');
  notesDir = path.join(tempRoot, 'notes');
  seedUserData(userData, vaultDir, notesDir);
});

test.afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('NP-01: Notes rich mode has the shared format toolbar with a working Underline', async () => {
  const notePath = path.join(notesDir, 'underline-parity.md');
  fs.writeFileSync(notePath, 'Parity body text.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'underline-parity');

    // Shared toolbar present inside the Notes surface (drift fix: was missing Underline).
    const toolbar = page.locator('#app-tabpanel-notes .fmt-toolbar[aria-label="Text formatting"]');
    await expect(toolbar).toBeVisible();

    const editor = page.locator('.note-viewer .ProseMirror');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' plus ');
    const underline = toolbar.locator('button[aria-label="Underline"]');
    await underline.click();
    await expect(underline).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('underlined');
    await expect(editor.locator('u', { hasText: 'underlined' })).toBeVisible();

    // Wait past the 800ms autosave debounce; the note file must round-trip <u>.
    await expect(page.locator('.note-viewer-save-status')).toHaveText(/Saved/, { timeout: 8_000 });
    expect(fs.readFileSync(notePath, 'utf-8')).toContain('<u>underlined</u>');

    // Reopening rich mode must NOT trip the fidelity guard on our own <u> output.
    await page.locator('button.note-viewer-mode', { hasText: 'Source' }).click();
    await page.locator('button.note-viewer-mode', { hasText: 'Rich' }).click();
    await expect(page.locator('.note-fidelity-overlay')).toHaveCount(0);
    await expect(page.locator('.note-viewer .ProseMirror')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-02: entity @-mention picker works in Notes rich mode (parity with Story)', async () => {
  seedEntity(vaultDir, 'char-elara', 'Elara');
  const notePath = path.join(notesDir, 'mention-parity.md');
  fs.writeFileSync(notePath, 'Ask about the harbor.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'mention-parity');

    const editor = page.locator('.note-viewer .ProseMirror');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @Ela');

    const picker = page.locator('.entity-mention-picker[aria-label="Entity suggestions"]');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await expect(picker.locator('.entity-mention-picker-name', { hasText: 'Elara' })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(editor.locator('.entity-mention-chip', { hasText: '@Elara' })).toBeVisible();

    // The mention serializes into the note file through the shared markdown path.
    await expect(page.locator('.note-viewer-save-status')).toHaveText(/Saved/, { timeout: 8_000 });
    expect(fs.readFileSync(notePath, 'utf-8')).toContain('entity://char-elara');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-03: wiki-links render and click-delegate in Notes rich mode', async () => {
  const notePath = path.join(notesDir, 'wiki-parity.md');
  fs.writeFileSync(notePath, 'Linked: [[Character: Elara]] appears here.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'wiki-parity');

    const wikiLink = page.locator('.note-viewer .ProseMirror [data-wiki-link]');
    await expect(wikiLink).toBeVisible();
    await expect(wikiLink).toHaveAttribute('data-wiki-link', 'Character: Elara');

    // Clicking plain body text must NOT activate the link (the Story-only
    // plain-text fallback stays out of Notes) — the note stays open.
    await page.locator('.note-viewer .ProseMirror').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(page.locator('.note-viewer .ProseMirror')).toBeVisible();
    await expect(page.locator('.note-viewer-error')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-04: source mode stays the lossless source of truth (R1) — lossy content guarded, source byte-faithful', async () => {
  const lossyBody = '---\ntitle: Guarded\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nBody.\n';
  const notePath = path.join(notesDir, 'lossless-guard.md');
  fs.writeFileSync(notePath, lossyBody);

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await page.locator('[data-testid^="vb-row-"]', { hasText: 'lossless-guard' }).first().click();
    await expect(page.locator('.note-viewer .note-mode-group[aria-label="Editor mode"]')).toBeVisible({ timeout: 8_000 });

    // Rich is opt-in: switching onto lossy content must raise the fidelity guard.
    // W0.2 (Beta 4): YAML frontmatter is no longer flagged — it is held aside
    // verbatim and never fed to (or rendered by) the Rich editor. The table in
    // the display body still triggers the guard.
    await page.locator('button.note-viewer-mode', { hasText: 'Rich' }).click();
    const guard = page.locator('.note-fidelity-overlay[role="dialog"]');
    await expect(guard).toBeVisible();
    await expect(guard).not.toContainText('YAML frontmatter');
    await expect(guard).toContainText('Markdown tables');

    // Choosing the safe path keeps source mode active and the file untouched.
    await guard.locator('button', { hasText: 'Edit in Source (safe)' }).click();
    await expect(page.locator('button.note-viewer-mode', { hasText: 'Source' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('textarea.note-viewer-editor')).toBeVisible();
    expect(fs.readFileSync(notePath, 'utf-8')).toBe(lossyBody);
  } finally {
    await app.close().catch(() => undefined);
  }
});
