/**
 * paragraph-editing.spec.ts — SKY-8564
 *
 * Two independent M30 acceptance passes (SKY-8172, SKY-8560) found that §14
 * items 1 (editing model: split/merge) and 2 (paragraph grip drag) had no
 * real E2E coverage — only jsdom/component-level tests existed
 * (ManuscriptView.test.tsx, manuscriptModel.test.ts). Per COMPANY-STANDARDS.md
 * §4a, mocked/component-only tests are supplementary, never sufficient proof.
 *
 * This spec drives the real UI -> IPC -> disk path (no `window.api` mock at
 * the seam) against a packaged Electron build:
 *
 *   TC-PE-01  Enter mid-paragraph splits it into two blocks; the split
 *             persists to the on-disk scene `.md` file.
 *   TC-PE-02  Backspace at the start of a paragraph merges it into the
 *             previous one; the merge persists to disk.
 *   TC-PE-03  Dragging a paragraph's grip handle onto another paragraph
 *             reorders it (crossing an intermediate paragraph); the new
 *             order persists to disk.
 *
 * TC-PE-03's fixture is built by chaining Enter-splits rather than
 * type-then-Tab commits. This is deliberate, not a style choice: investigating
 * this ticket surfaced a real bug (fixed in SKY-8587) where
 * `handleManuscriptEditParagraph` (DesktopShell.tsx) never refreshed
 * `selectedStory` after a plain paragraph-text commit, so a LATER grip-drag
 * (which reads sibling content straight from `selectedStory`) could silently
 * overwrite that sibling with its pre-edit placeholder text. Enter-splits were
 * immune (`handleManuscriptSplitParagraph` takes the caret-split halves as
 * fresh parameters and also refreshes `selectedStory`), so this spec's own
 * assertions stayed green even before SKY-8587 landed. Now that
 * `handleManuscriptEditParagraph` also refreshes `selectedStory`, a
 * type-then-Tab fixture would work too — but there's no need to churn this
 * spec to prove it; keep chaining Enter-splits here.
 *
 * Run:
 *   npx playwright test e2e/paragraph-editing.spec.ts --reporter=list
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
const NOW = '2026-07-01T00:00:00.000Z';
const STORY_TITLE = 'Paragraph Editing Story';

// ─── Fixture: a minimal hand-written MythosVault v2 bundle (one story / one
// chapter / one scene with a single seed paragraph) ────────────────────────

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

function seedV2Vault(bundle: string, seedProse: string): { scenePath: string } {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-pe-1',
      name: 'Paragraph Editing Vault',
      createdAt: NOW,
      stories: [
        { id: 'story-pe-1', title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-pe-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      `id: story-pe-1`,
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

  const scenePath = path.join(chapterDir, 'Scene 01.md');
  fs.writeFileSync(
    scenePath,
    `---\nid: scene-pe-1\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${seedProse}`,
  );
  return { scenePath };
}

// ─── App plumbing (same pattern as comments-v2.spec.ts) ───────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  return app;
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/**
 * Activate the Story section without tripping the nav rail v2 Stories popover
 * (see helpers/navGuard.ts — inlined here because the rail button is labeled
 * "Story" or "Story Writer" depending on the shell variant).
 */
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

/** Open the seeded scene, then zoom to chapter depth (the ManuscriptView). */
async function openManuscript(pg: Page): Promise<void> {
  await clickStorySection(pg);
  const storyRow = pg.getByRole('button', { name: new RegExp(STORY_TITLE) }).first();
  await expect(storyRow).toBeVisible({ timeout: 20_000 });
  const chapterRow = pg.getByRole('button', { name: /Chapter One/ }).first();
  if (!(await chapterRow.isVisible().catch(() => false))) {
    await storyRow.click();
  }
  await expect(chapterRow).toBeVisible({ timeout: 10_000 });
  // Boot-time reindex re-renders the navigator and can collapse a freshly
  // expanded chapter — retry the expand until the scene row stays visible
  // (same pattern as mythos-migration.spec.ts TC-MV-02).
  const sceneRow = pg.getByRole('button', { name: /The Gate/ }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await chapterRow.click();
    try {
      await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch {
      /* collapsed again — retry */
    }
  }
  await sceneRow.click();
  await expect(pg.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  // Scene depth → chapter depth: the continuous manuscript view with grips.
  const chapterBtn = pg.getByTestId('msv-zoom-chapter');
  await chapterBtn.click();
  await expect(pg.locator('.chapter-continuous-view')).toBeVisible({ timeout: 10_000 });
}

/**
 * Place the caret inside `row`'s contentEditable at a plain-text offset,
 * walking text nodes exactly like the app's own `caretOffsetIn`
 * (ParagraphRow.tsx) does in reverse. A click + Home + ArrowRight×N sequence
 * is NOT reliable here: `Home`/`End` operate on the current *visual* line, so
 * if the seed paragraph wraps across two lines a plain click (which lands
 * wherever its coordinate falls) can put Home/ArrowRight on the wrong line
 * entirely and the caret silently clamps to the end of the text.
 */
async function placeCaret(pg: Page, row: import('@playwright/test').Locator, offset: number): Promise<void> {
  await row.evaluate((el, off) => {
    (el as HTMLElement).focus();
    const sel = window.getSelection();
    if (!sel) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let remaining = off;
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
      node = walker.nextNode();
    }
  }, offset);
}

function readSceneFile(scenePath: string): string {
  return fs.readFileSync(scenePath, 'utf-8');
}

/** Body content after the frontmatter's closing `---`, trimmed of the leading newline. */
function sceneBody(fileContent: string): string {
  const parts = fileContent.split('---\n');
  return (parts[2] ?? '').replace(/^\n/, '');
}

// ─── Suite ──────────────────────────────────────────────────────────────────

test.describe('Paragraph editing model (§14 items 1-2) — real UI → IPC → disk', () => {
  test('TC-PE-01: Enter mid-paragraph splits into two blocks and persists to disk', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-para-split-'));
    const userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'Paragraph Vault');
    const seedProse = 'The lantern flickered once. Then the room went dark.';
    const { scenePath } = seedV2Vault(bundle, seedProse);
    seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await openManuscript(page);

      const row = page.locator('[data-testid^="msv-para-"]').first();
      await expect(row).toHaveText(seedProse);

      // Caret right after "once." (index of the char after the period).
      const splitAt = seedProse.indexOf('once.') + 'once.'.length;
      await placeCaret(page, row, splitAt);
      await page.keyboard.press('Enter');

      // Two separate paragraph rows now render.
      const rows = page.locator('[data-testid^="msv-para-"]');
      await expect(rows).toHaveCount(2, { timeout: 10_000 });
      await expect(rows.nth(0)).toHaveText('The lantern flickered once.');
      await expect(rows.nth(1)).toHaveText('Then the room went dark.');

      // The split persists to the on-disk scene file: two blank-line-
      // separated paragraphs matching the before/after halves exactly.
      await expect
        .poll(() => sceneBody(readSceneFile(scenePath)), { timeout: 10_000 })
        .toBe('The lantern flickered once.\n\nThen the room went dark.\n');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('TC-PE-02: Backspace at paragraph start merges into the previous paragraph and persists to disk', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-para-merge-'));
    const userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'Paragraph Vault');
    // Pre-split via a `\n\n`-separated seed body would collapse into one
    // block on read (MythosVault v2 always scans a scene file into a single
    // prose block — see sceneFiles.ts / v2Manifest.ts), so the two starting
    // paragraphs are built for real through the split UI, exactly like a
    // writer would create them.
    const seedProse = 'The lantern flickered once. Then the room went dark.';
    const { scenePath } = seedV2Vault(bundle, seedProse);
    seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await openManuscript(page);

      const firstRow = page.locator('[data-testid^="msv-para-"]').first();
      const splitAt = seedProse.indexOf('once.') + 'once.'.length;
      await placeCaret(page, firstRow, splitAt);
      await page.keyboard.press('Enter');

      const rows = page.locator('[data-testid^="msv-para-"]');
      await expect(rows).toHaveCount(2, { timeout: 10_000 });
      await expect(rows.nth(0)).toHaveText('The lantern flickered once.');
      await expect(rows.nth(1)).toHaveText('Then the room went dark.');
      await expect
        .poll(() => sceneBody(readSceneFile(scenePath)), { timeout: 10_000 })
        .toBe('The lantern flickered once.\n\nThen the room went dark.\n');

      // Backspace at the start of the second paragraph merges it up.
      await placeCaret(page, rows.nth(1), 0);
      await page.keyboard.press('Backspace');

      await expect(rows).toHaveCount(1, { timeout: 10_000 });
      await expect(rows.nth(0)).toHaveText('The lantern flickered once. Then the room went dark.');

      // The merge persists to disk as a single paragraph again.
      await expect
        .poll(() => sceneBody(readSceneFile(scenePath)), { timeout: 10_000 })
        .toBe('The lantern flickered once. Then the room went dark.\n');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('TC-PE-03: grip-drag reorders a paragraph across a sibling and persists the new order to disk', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-para-drag-'));
    const userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'Paragraph Vault');
    const seedProse = 'Seed paragraph.';
    const { scenePath } = seedV2Vault(bundle, seedProse);
    seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await openManuscript(page);

      // Build three real paragraphs by chaining Enter-splits (see the file
      // header note re: SKY-8587 for why this must not be a type-then-Tab
      // sequence).
      const first = page.locator('[data-testid^="msv-para-"]').first();
      await first.click();
      await page.keyboard.press('End');
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await page.keyboard.type('Alpha paragraph.');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Beta paragraph.');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Gamma paragraph.');
      await page.keyboard.press('Enter');

      const rows = page.locator('[data-testid^="msv-para-"]');
      await expect(rows).toHaveCount(4, { timeout: 10_000 }); // + trailing empty split
      await expect(rows.nth(0)).toHaveText('Alpha paragraph.');
      await expect(rows.nth(1)).toHaveText('Beta paragraph.');
      await expect(rows.nth(2)).toHaveText('Gamma paragraph.');
      await expect
        .poll(() => sceneBody(readSceneFile(scenePath)), { timeout: 10_000 })
        .toBe('Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.\n\n \n');

      // Drag Alpha's grip onto Gamma (crossing Beta) — Alpha lands
      // immediately before Gamma: [Beta, Alpha, Gamma, <empty>].
      const grip0 = page.locator('[data-testid^="msv-grip-"]').nth(0);
      const target = rows.nth(2);
      const gripBox = await grip0.boundingBox();
      const targetBox = await target.boundingBox();
      expect(gripBox).not.toBeNull();
      expect(targetBox).not.toBeNull();
      if (gripBox && targetBox) {
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 });
        await page.waitForTimeout(100);
        await page.mouse.up();
      }

      await expect(page.getByText('Block moved')).toBeVisible({ timeout: 5_000 });

      // The new order persists to disk immediately, with every paragraph's
      // text intact — the sharp, direct proof that the reorder is real and
      // not just an in-memory artifact.
      await expect
        .poll(() => sceneBody(readSceneFile(scenePath)), { timeout: 10_000 })
        .toBe('Beta paragraph.\n\nAlpha paragraph.\n\nGamma paragraph.\n\n \n');

      // SKY-8587 fixed `handleManuscriptMoveParagraph` to call
      // `refreshManuscriptSelection` after the move, so the ManuscriptView
      // DOM should reflect the reordered rows immediately, not just the
      // on-disk file.
      await expect(rows.nth(0)).toHaveText('Beta paragraph.');
      await expect(rows.nth(1)).toHaveText('Alpha paragraph.');
      await expect(rows.nth(2)).toHaveText('Gamma paragraph.');
    } finally {
      await app.close().catch(() => {});
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
