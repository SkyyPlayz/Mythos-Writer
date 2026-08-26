// SKY-11058 — PR screenshots for the Notes tab multi-vault picker (FULL-SPEC
// §119): the vault dropdown with the active vault checked plus a second vault,
// and the pre-swap link-resolution confirmation dialog (N resolve / M no
// longer resolve). Seeds a MythosVault v2 bundle (same fixture shape as
// comments-v2.spec.ts) and drives the real "+ New notes vault…" flow through
// the picker — the registry file notes-vaults.json is never hand-written.
// Not part of CI: run manually to refresh the images (rebuild first so
// out/main + out/renderer carry the picker).
//   xvfb-run --auto-servernum npx playwright test e2e/capture-sky11058-notes-vault-picker.spec.ts
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../docs/screenshots/sky-11058-notes-vault-picker');

const NOW = '2026-08-01T00:00:00.000Z';
const STORY_ID = 'story-nvp-1';
const STORY_TITLE = 'The Deep';
const SECOND_VAULT_NAME = 'Research';

// Scene prose carries three [[wikilinks]]. All three resolve in the seeded
// "Notes Vault"; only [[Eira]] gets a matching note in the second vault, so
// the switch dialog reports a mixed N resolve / M no longer resolve outcome.
// (book.md's spine list contributes a fourth stem, "chapter 01" — the test
// drops a matching note into the second vault so it never shows up as an
// unresolved distraction in the capture.)
const SCENE_PROSE = [
  'The lantern found [[Eira]] first, hunched over the ledgers of',
  '[[The Drowned Archive]], mouthing the old verses of the [[Lantern Rites]].',
].join(' ');

function seedUserData(userData: string, storyVaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

/** Minimal MythosVault v2 bundle: one story / chapter / scene + a Notes Vault
 *  whose notes resolve every wikilink in the manuscript. Mirrors the
 *  hand-written fixture in comments-v2.spec.ts. */
function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  const notesDir = path.join(bundle, 'Notes Vault');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-nvp-1',
      name: 'Picker Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-nvp-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: ${STORY_ID}`,
      `title: ${STORY_TITLE}`,
      `createdAt: ${NOW}`,
      `updatedAt: ${NOW}`,
      '---',
      `# ${STORY_TITLE}`,
      '',
      '## Part 1',
      '',
      '- [[Part 1/Chapter 01|Chapter One]]',
      '',
      '<!-- mythos:spine',
      JSON.stringify(spine),
      '-->',
      '',
    ].join('\n'),
  );

  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    `---\nid: scene-nvp-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SCENE_PROSE}`,
  );

  // Original notes vault — every manuscript wikilink resolves here.
  for (const stem of ['Eira', 'The Drowned Archive', 'Lantern Rites']) {
    fs.writeFileSync(path.join(notesDir, `${stem}.md`), `# ${stem}\n\nSeed note.\n`);
  }
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

test('capture SKY-11058 notes-vault picker screenshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-capture-nvp-'));
  const userData = path.join(tempRoot, 'userData');
  const bundle = path.join(tempRoot, 'Picker Vault');
  seedV2Vault(bundle);
  seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 12_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Notes tab — the picker lives in the Notes toolbar.
    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible({ timeout: 12_000 });
    await nav.locator('button[aria-label="Notes Editor"]').click();
    const pickerBtn = page.getByTestId('notes-vault-picker-btn');
    await expect(pickerBtn).toBeVisible({ timeout: 15_000 });

    // Create the second vault through the real "+ New notes vault…" flow
    // (useTextPrompt modal — Electron has no window.prompt).
    await pickerBtn.click();
    await page.getByTestId('menu-item-create').click();
    const promptOverlay = page.locator('.prompt-modal-overlay');
    await expect(promptOverlay).toBeVisible({ timeout: 5_000 });
    await promptOverlay.locator('.prompt-modal-input').fill(SECOND_VAULT_NAME);
    await promptOverlay.locator('.prompt-modal-ok').click();
    await expect(promptOverlay).toHaveCount(0);

    // The registry slugs "Research" to a same-named dir inside the bundle.
    const secondVaultDir = path.join(bundle, SECOND_VAULT_NAME);
    await expect.poll(() => fs.existsSync(secondVaultDir), { timeout: 10_000 }).toBe(true);
    // Only [[Eira]] resolves in the new vault; "Chapter 01" satisfies the
    // book.md spine stem so it stays out of the unresolved list.
    fs.writeFileSync(path.join(secondVaultDir, 'Eira.md'), '# Eira\n\nMoved note.\n');
    fs.writeFileSync(path.join(secondVaultDir, 'Chapter 01.md'), '# Chapter 01\n');

    // 1 — picker menu open: active vault checked, second vault, both actions.
    await pickerBtn.click();
    const menu = page.getByTestId('notes-vault-picker-menu');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu.getByRole('menuitem', { name: '✓ Notes' })).toBeVisible({ timeout: 10_000 });
    await expect(menu.getByRole('menuitem', { name: SECOND_VAULT_NAME, exact: true })).toBeVisible();
    await expect(menu.getByTestId('menu-item-create')).toContainText('New notes vault');
    await expect(menu.getByTestId('menu-item-import')).toContainText('Import a vault');
    await page.waitForTimeout(300); // let the menu settle before capture
    await page.screenshot({ path: path.join(OUT_DIR, 'picker-menu-open.png') });

    // 2 — click the other vault → pre-swap link-resolution confirm dialog.
    await menu.getByRole('menuitem', { name: SECOND_VAULT_NAME, exact: true }).click();
    const dialog = page.getByTestId('notes-vault-switch-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(`Switch to “${SECOND_VAULT_NAME}”?`);
    await expect(dialog).toContainText('linked notes resolve in this vault');
    // The two notes left behind in the original vault show as unresolved
    // (stems are lowercased by the report builder).
    await expect(dialog).toContainText('[[the drowned archive]]');
    await expect(dialog).toContainText('[[lantern rites]]');
    await expect(page.getByTestId('notes-vault-switch-confirm')).toBeVisible();
    await page.waitForTimeout(300); // let the dialog settle before capture
    await page.screenshot({ path: path.join(OUT_DIR, 'link-report-dialog.png') });
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
