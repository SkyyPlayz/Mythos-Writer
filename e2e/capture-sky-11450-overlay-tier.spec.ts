/**
 * capture-sky-11450-overlay-tier.spec.ts — SKY-11450 PR evidence (NOT part of CI)
 *
 * Shoots the overlay tier from a fresh profile (§4c), on both sides of the
 * change, so the before/after can be compared 1:1:
 *
 *   1-settings              Settings panel — the SKY-11133 control, already on
 *                           the overlay tier before this PR. Must look the same
 *                           in both runs.
 *   2-account-modal         AccountModal — a `.ln-dialog` consumer, i.e. the
 *                           shared primitive.
 *   3-keyboard-shortcuts    KeyboardShortcutsDialog — a standalone-token dialog.
 *   4-page-setup-popover    PageSetupPopover — the light-theme-token popover.
 *   5-account-modal-hc      AccountModal at [data-contrast="high"] — proves the
 *                           high-contrast degrade still flattens to opaque.
 *
 * Modeled on e2e/capture-sky-11239-screenshot.spec.ts (same seed/launch shape).
 *
 * Output: pr-screenshots/sky-11450-overlay-tier/<SHOT_PREFIX><name>.png
 *
 * Run (after `npm run build:electron`):
 *   SHOT_PREFIX=after- xvfb-run -a npx playwright test \
 *     e2e/capture-sky-11450-overlay-tier.spec.ts --reporter=list
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const OUT_DIR = path.resolve(__dirname, '../pr-screenshots/sky-11450-overlay-tier');
const PREFIX = process.env.SHOT_PREFIX ?? '';
const NOW = '2026-09-08T00:00:00.000Z';
const STORY_TITLE = 'Overlay Tier Story';
const SEED_PROSE = 'The lantern flickered once, casting long shadows across the stone floor.';

test.setTimeout(180_000);

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `${PREFIX}${name}.png`) });
  console.log(`  wrote ${PREFIX}${name}.png`);
}

async function applyTheme(page: Page) {
  await page
    .evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const bgApp = root.getPropertyValue('--bg-app').trim() || '#0e1116';
      const textBody = root.getPropertyValue('--text-body').trim() || '#bfd6e8';
      document.documentElement.style.backgroundColor = bgApp;
      document.body.style.backgroundColor = bgApp;
      document.body.style.color = textBody;
    })
    .catch(() => undefined);
  await page.waitForTimeout(300);
}

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  const spine = {
    parts: [
      {
        id: 'part-1',
        title: 'Part 1',
        chapters: [{ id: 'ch-1', title: 'Chapter One', scenes: [{ id: 'scene-ot-1', title: 'The Gate' }] }],
      },
    ],
  };

  fs.writeFileSync(
    path.join(storyDir, 'Story.md'),
    [
      `---\nid: story-ot\ntitle: ${STORY_TITLE}\nupdatedAt: ${NOW}\n---`,
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
    `---\nid: scene-ot-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SEED_PROSE}`,
  );
}

async function clickStorySection(pg: Page): Promise<void> {
  const nav = pg.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  await expect(storyBtn).toBeVisible({ timeout: 10_000 });
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = pg.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
}

/**
 * Reach the manuscript toolbar (which owns the Page Setup popover) the way a
 * user does: the StoryNavigator empty-state CTA scaffolds story + chapter +
 * scene in one transaction and auto-opens the editor (SKY-9021 / SKY-316).
 * Nothing is pre-seeded for the surface under test (§4c).
 */
async function openManuscript(pg: Page): Promise<void> {
  await clickStorySection(pg);
  const cta = pg.locator('[data-testid="nav-empty-cta"]');
  if (await cta.isVisible().catch(() => false)) {
    await cta.click();
  }
  await expect(pg.locator('.nav-scene-row').first()).toBeVisible({ timeout: 20_000 });
  await pg.locator('.nav-scene-row').first().click();
  await expect(pg.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });

  // Page Setup lives on the ManuscriptView toolbar; the scene editor may open
  // in scene zoom, which doesn't render it. Fall back to chapter zoom.
  const pageSetup = pg.getByTestId('msv-page-setup-btn');
  if (!(await pageSetup.isVisible().catch(() => false))) {
    await pg.getByTestId('msv-zoom-chapter').click();
    await expect(pg.locator('.chapter-continuous-view')).toBeVisible({ timeout: 10_000 });
  }
  await expect(pageSetup).toBeVisible({ timeout: 10_000 });
}

test('capture SKY-11450 overlay tier screenshots', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-overlay-tier-shots-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Overlay Tier Vault');
  seedV2Vault(bundle);
  seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });

  try {
    const page: Page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await applyTheme(page);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 30_000 });

    // 1. Settings — the SKY-11133 control surface. Identical in both runs.
    await page.locator('.app-menu-gear-btn').click();
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.settings-cat-nav__tab').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '1-settings');
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"][aria-label="Settings"]')).toHaveCount(0);

    // 2. AccountModal — a `.ln-dialog` consumer, i.e. the shared primitive.
    await page.getByRole('button', { name: 'Open account' }).click();
    const account = page.locator('.ln-dialog');
    await expect(account).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot(page, '2-account-modal');

    // 5. Same dialog under the app high-contrast toggle — opaque, no glow.
    await page.evaluate(() => document.documentElement.setAttribute('data-contrast', 'high'));
    await page.waitForTimeout(400);
    await shot(page, '5-account-modal-high-contrast');
    await page.evaluate(() => document.documentElement.removeAttribute('data-contrast'));
    await page.keyboard.press('Escape');
    await expect(account).toHaveCount(0);

    // 3. KeyboardShortcutsDialog — a standalone-token dialog.
    await page.getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: /keyboard shortcuts/i }).click();
    await expect(page.locator('.ksd-dialog')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot(page, '3-keyboard-shortcuts');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ksd-dialog')).toHaveCount(0);

    // 4. PageSetupPopover — the light-theme-token popover.
    await openManuscript(page);
    const hideSidebar = page.getByRole('button', { name: /hide right sidebar/i });
    if (await hideSidebar.isVisible().catch(() => false)) {
      await hideSidebar.click();
    }
    // `.msv-toolbar { overflow: hidden }` predates this PR (commit 4ec97aca6)
    // and clips the popover at paint time. Capture-only override so the
    // evidence shot isn't blank; not part of the shipped diff.
    await page.addStyleTag({ content: '.msv-toolbar { overflow: visible !important; }' });
    await page.getByTestId('msv-page-setup-btn').click();
    await expect(page.locator('.page-setup-popover')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot(page, '4-page-setup-popover');
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
