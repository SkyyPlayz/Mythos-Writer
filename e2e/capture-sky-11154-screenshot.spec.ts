/**
 * capture-sky-11154-screenshot.spec.ts — SKY-11154 (not part of CI)
 *
 * One-off Playwright script to capture PR evidence screenshots for the
 * "Vault & Files" Settings page (parent spec SKY-11141 §2/§4/§4a):
 *   1. vault-files-page — the "Vaults folder" row at the top plus a Mythos
 *      vault card showing its inner-vault counts ("N notes vaults · N story
 *      vaults") and the Notes/Story dot-linking columns (VaultLinkingColumns)
 *      with the single pair already linked (dots filled cyan).
 *   2. overflow-menu-open — the shared "..." overflow menu (VaultOverflowMenu)
 *      open on the Mythos vault card, showing Hide / Delete only.
 *
 * Seeds a real MythosVault v2 bundle (mythos.json + Story Vault + Notes
 * Vault, same fixture shape as comments-v2.spec.ts / the SKY-11058 capture
 * spec) registered in vault-settings.json's recentProjects — NOT the
 * seedCompletedOnboarding() fixture from sky-11154-vault-settings-page.spec.ts,
 * which writes no mythos.json and produces a legacy v0.4 vault where
 * VaultLinkingColumns renders nothing (notesVaultRegistryList returns
 * vaults: null for that shape).
 *
 * Output: pr-screenshots/sky-11154-vault-settings-page/*.png
 *
 * Run (after `npm run build:electron`):
 *   xvfb-run -a npx playwright test e2e/capture-sky-11154-screenshot.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11154-vault-settings-page');

const NOW = '2026-09-02T00:00:00.000Z';
const STORY_ID = 'story-sky11154-1';
const STORY_TITLE = 'The Deep';
const MYTHOS_NAME = 'Anwen Cycle';

function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

async function shot(page: Page, name: string) {
  ensureDir(OUT_DIR);
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`  wrote ${name}.png`);
}

async function applyTheme(page: Page) {
  await page.evaluate(() => {
    const bgApp = getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim() || '#0e1116';
    const textBody = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim() || '#bfd6e8';
    document.documentElement.style.backgroundColor = bgApp;
    document.body.style.backgroundColor = bgApp;
    document.body.style.color = textBody;
  }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Minimal MythosVault v2 bundle: mythos.json + one Story Vault (one story /
 *  chapter / scene) + one Notes Vault — mirrors comments-v2.spec.ts /
 *  capture-sky11058-notes-vault-picker.spec.ts. Registering it directly (no
 *  notes-vaults.json / story-vaults.json hand-written) exercises the real
 *  "auto-create registry from existing folders on first read" path
 *  (ensureNotesVaultRegistry / ensureStoryVaultRegistry) that ships in this PR. */
function seedV2Vault(bundle: string): { storyVault: string; notesVault: string } {
  const storyVault = path.join(bundle, 'Story Vault');
  const notesVault = path.join(bundle, 'Notes Vault');
  const storyDir = path.join(storyVault, STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(notesVault, { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-sky11154-1',
      name: MYTHOS_NAME,
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-sky11154-1', title: 'Chapter One' }] },
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
    `---\nid: scene-sky11154-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\nThe lantern found her first.\n`,
  );

  for (const stem of ['Eira', 'The Drowned Archive']) {
    fs.writeFileSync(path.join(notesVault, `${stem}.md`), `# ${stem}\n\nSeed note.\n`);
  }

  return { storyVault, notesVault };
}

function seedUserData(userData: string, storyVault: string, notesVault: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: storyVault,
      notesVaultRoot: notesVault,
      recentProjects: [
        { name: MYTHOS_NAME, vaultRoot: storyVault, notesVaultRoot: notesVault, openedAt: NOW },
      ],
    }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

test('capture SKY-11154 Vault & Files settings page screenshots', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11154-'));
  const userData = path.join(tempRoot, 'userData');
  const bundle = path.join(tempRoot, MYTHOS_NAME);
  const { storyVault, notesVault } = seedV2Vault(bundle);
  seedUserData(userData, storyVault, notesVault);

  const app = await launchApp(userData);
  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 940 });
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 15_000 });
    await applyTheme(page);

    // Open Settings > Vault & Files (matches the QA spec's openVaultFilesSettings helper).
    await page.locator('.app-menu-gear-btn').click();
    await page.getByRole('tab', { name: 'Vault & Files' }).click();

    // Vaults folder row + Mythos vault card with inner counts.
    await expect(page.getByTestId('vaults-folder-path')).toBeVisible({ timeout: 8_000 });
    const card = page.getByTestId(`mvs-card-${storyVault}`);
    await expect(card).toBeVisible({ timeout: 8_000 });
    await expect(
      page.getByText(/\d+\s+notes vaults?\s*(&middot;|·)\s*\d+\s+story vaults?/i),
    ).toBeVisible({ timeout: 5_000 });

    // Dot-linking columns for the real v2 bundle — pair the (only) notes
    // vault to the (only) story vault via the real click-dot-then-dot flow
    // so both dots render filled/linked instead of an unpaired empty state.
    const notesCard = page.locator('[data-testid^="notes-vault-card-"]').first();
    const storyCard = page.locator('[data-testid^="story-vault-card-"]').first();
    await expect(notesCard).toBeVisible({ timeout: 8_000 });
    await expect(storyCard).toBeVisible({ timeout: 8_000 });
    await notesCard.locator('[data-testid^="pair-dot-notes-"]').click();
    await storyCard.locator('[data-testid^="pair-dot-story-"]').click();
    await expect(notesCard.getByText(/Linked to:/)).toBeVisible({ timeout: 5_000 });
    await expect(storyCard.getByText(/Linked to:/)).toBeVisible({ timeout: 5_000 });

    await page.waitForTimeout(300); // let the pairing settle before capture
    await shot(page, '1-vault-files-page');

    // Shared "..." overflow menu on the Mythos vault card — Hide / Delete only.
    const overflowBtn = card.getByTestId(`vault-overflow-btn-${storyVault}`);
    await expect(overflowBtn).toBeVisible({ timeout: 5_000 });
    await overflowBtn.click();
    const menu = page.getByTestId(`vault-overflow-menu-${storyVault}`);
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu.getByRole('menuitem', { name: /^hide$/i })).toBeVisible({ timeout: 3_000 });
    await expect(menu.getByRole('menuitem', { name: /^delete$/i })).toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(200);
    await shot(page, '2-overflow-menu-open');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
