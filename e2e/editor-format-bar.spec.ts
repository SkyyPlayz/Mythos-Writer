// SKY-3204 / SKY-3209 (B6): Story editor formatting toolbar — shared <RichTextEditor> core.
// SKY-10937: scene depth now composes through ManuscriptView's unified shell —
// BlockEditor mounts chromeless there (its own FormatToolbar is suppressed) and
// ManuscriptView's msv-toolbar drives the live editor instead, so these tests
// exercise msv-toolbar, the toolbar actually in the DOM at scene depth.
// Verifies it applies marks (including Underline, which the shared core
// guarantees on every surface), reflects active state accessibly
// (aria-pressed), and that formatted text round-trips through the Markdown
// save path.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

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

/** Create story through the navigator and open its auto-scaffolded scene.
 * M3 instant-create: one transaction scaffolds the story, "Chapter 1", and
 * an "Untitled Scene" and opens the editor — no prompt, no separate
 * chapter/scene creation step. */
async function openScene(page: Page): Promise<void> {
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await clickStoryNav(page);
  await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 5_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  await page.locator('.lr-nav-add').first().click();
  await page.locator('.nav-scene-row').first().click();

  await expect(page.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible({ timeout: 10_000 });
}

let tempRoot: string;
let userData: string;
let vaultDir: string;
let notesDir: string;

test.beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-fmtbar-'));
  userData = path.join(tempRoot, 'userData');
  vaultDir = path.join(tempRoot, 'vault');
  notesDir = path.join(tempRoot, 'notes');
  seedUserData(userData, vaultDir, notesDir);
});

test.afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('FB-01: manuscript toolbar renders formatting controls with accessible state', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    // SKY-10937: exactly one formatting toolbar at scene depth — BlockEditor's
    // own FormatToolbar is suppressed (chromeless), msv-toolbar is the one.
    const toolbar = page.getByTestId('msv-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(page.locator('.fmt-toolbar')).toHaveCount(0);

    for (const label of ['Bold', 'Italic', 'Underline', 'Strikethrough']) {
      const btn = toolbar.locator(`button[aria-label="${label}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
    }
    await expect(toolbar.getByTestId('msv-style-select')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('FB-02: bold + underline apply, reflect aria-pressed, and persist through the markdown save', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const editor = page.locator('.tiptap-editor-wrap .ProseMirror');
    await editor.click();
    await page.keyboard.type('plain ');

    // Toggle Bold on, type, toggle off — active state must track the toggle.
    const bold = page.getByTestId('msv-fmt-b');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('bolded');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'false');

    // Underline — the shared-core guarantee (SKY-3204 owner decision: underline = yes).
    await page.keyboard.type(' and ');
    const underline = page.getByTestId('msv-fmt-u');
    await underline.click();
    await expect(underline).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('underlined');

    await expect(editor.locator('strong', { hasText: 'bolded' })).toBeVisible();
    await expect(editor.locator('u', { hasText: 'underlined' })).toBeVisible();

    // Wait past the 800ms debounce so the scene file is written, then check disk.
    await page.waitForTimeout(1_600);
    const sceneFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) sceneFiles.push(full);
      }
    };
    walk(vaultDir);
    const sceneBody = sceneFiles.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
    expect(sceneBody).toContain('**bolded**');
    expect(sceneBody).toContain('<u>underlined</u>');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('FB-03: style select applies an H2 and stays in sync with the cursor', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const editor = page.locator('.tiptap-editor-wrap .ProseMirror');
    await editor.click();
    await page.keyboard.type('Section title');

    const styleSelect = page.getByTestId('msv-style-select');
    await styleSelect.selectOption('Heading 2');
    await expect(editor.locator('h2', { hasText: 'Section title' })).toBeVisible();
    await expect(styleSelect).toHaveValue('Heading 2');

    // Back to body resets both the node and the select value.
    await styleSelect.selectOption('Body Text');
    await expect(editor.locator('h2')).toHaveCount(0);
    await expect(styleSelect).toHaveValue('Body Text');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('FB-04: style select offers Body/H1-H3/Quote and each heading level round-trips through the markdown save (SKY-5777, SKY-10937)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const editor = page.locator('.tiptap-editor-wrap .ProseMirror');
    const styleSelect = page.getByTestId('msv-style-select');

    // SKY-10937: the unified manuscript toolbar's style range is Body Text /
    // H1-H3 / Quote (ManuscriptView.tsx STYLE_OPTIONS, matched to the design
    // mockup) — narrower than BlockEditor's own FormatToolbar (H1-H6), which
    // stays reachable on surfaces that still mount it (Notes rich mode, split
    // panes). H4-H6 are not reachable from the story editor's toolbar anymore.
    for (const label of ['Body Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Quote']) {
      await expect(styleSelect.locator('option', { hasText: label })).toHaveCount(1);
    }
    await expect(styleSelect.locator('option')).toHaveCount(5);

    for (let level = 1; level <= 3; level++) {
      await editor.click();
      await page.keyboard.press('Control+End');
      // Ctrl+End moves the native DOM selection synchronously, but Tiptap/ProseMirror
      // resyncs its own internal selection from `selectionchange` on the next frame.
      // Pressing Enter before that resync lands, ProseMirror still has the PREVIOUS
      // selection (the just-created heading's full text) and Enter's default
      // deleteSelection+split wipes that heading's text (SKY-7550).
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.keyboard.press('Enter');
      await page.keyboard.type(`Heading Level ${level}`);
      await styleSelect.selectOption(`Heading ${level}`);
      await expect(editor.locator(`h${level}`, { hasText: `Heading Level ${level}` })).toBeVisible();
      await expect(styleSelect).toHaveValue(`Heading ${level}`);
    }

    // Wait past the debounce so the scene file is written, then verify every
    // level survived the markdown save with the correct number of `#`.
    await page.waitForTimeout(1_600);
    const sceneFiles: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) sceneFiles.push(full);
      }
    };
    walk(vaultDir);
    const sceneBody = sceneFiles.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
    for (let level = 1; level <= 3; level++) {
      expect(sceneBody).toContain(`${'#'.repeat(level)} Heading Level ${level}`);
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});
