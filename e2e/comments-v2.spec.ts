/**
 * comments-v2.spec.ts — Beta 4 M9 (Comments v2)
 *
 * End-to-end acceptance for manuscript comments on the MythosVault v2 (M5)
 * sidecar format, against the packaged runtime (real IPC, real files):
 *
 *   TC-CM-01  Agent comments seeded in `Story Vault/<Story>/comments.json`
 *             (archive + Writing Coach) render as gutter cards with their
 *             kind-colored anchor underlines.
 *   TC-CM-02  The selection composer (select prose → input + Comment +
 *             Read-aloud) files a user comment that persists into the same
 *             M5 sidecar file.
 *   TC-CM-03  Clicking a gutter card opens the v2 open-comment card: kind
 *             chip, quote, body, the three archive actions, Resolve, and the
 *             `Show in focus` toggle.
 *   TC-CM-04  ACCEPTANCE — agent + user comments ROUND-TRIP THROUGH A VAULT
 *             COPY: copying the whole MythosVault folder and opening the copy
 *             shows every comment intact; Resolve in the copy updates the
 *             copy's sidecar and leaves the original untouched.
 *
 * Run:
 *   npx playwright test e2e/comments-v2.spec.ts --reporter=list
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

const STORY_ID = 'story-cm-1';
const STORY_TITLE = 'The Deep';
const SCENE_1_PROSE = 'The lantern cast a trembling circle of light across the drowned stone.';
const SCENE_2_PROSE = 'By morning the rumor had teeth, and the whole quarter knew her name.';
const ARCHIVE_ANCHOR = 'trembling circle of light';
const ARCHIVE_TEXT = 'Continuity: this lantern is oil-lit in Ch. 1 but crystal-lit later.';
const COACH_ANCHOR = 'across the drowned stone';
const COACH_TEXT = 'Strong image — consider landing it even harder.';
const USER_COMMENT = 'Love this beat, keep the rumor line.';

// ─── Fixture: a minimal hand-written MythosVault v2 bundle ───────────────────

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

/** Write a v2 MythosVault with one story / chapter / two scenes + agent comments. */
function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-cm-1',
      name: 'Comments Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-cm-1', title: 'Chapter One' }] },
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

  const scene = (id: string, title: string, prose: string) =>
    `---\nid: ${id}\ntitle: ${title}\nstatus: draft\nupdatedAt: ${NOW}\n---\n${prose}`;
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 01.md'),
    scene('scene-cm-1', 'The Gate', SCENE_1_PROSE),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 02.md'),
    scene('scene-cm-2', 'The Rumor', SCENE_2_PROSE),
  );

  // Agent comments, exactly as the M23 flags→comments pipeline and the Coach
  // persist them (M5 sidecar envelope, version 1).
  fs.writeFileSync(
    path.join(storyDir, 'comments.json'),
    `${JSON.stringify({
      version: 1,
      comments: [
        {
          id: 'c-cm-archive', storyId: STORY_ID, sceneId: 'scene-cm-1',
          anchor: ARCHIVE_ANCHOR, author: 'Archive Agent', kind: 'archive',
          text: ARCHIVE_TEXT, createdAt: NOW,
        },
        {
          id: 'c-cm-coach', storyId: STORY_ID, sceneId: 'scene-cm-1',
          anchor: COACH_ANCHOR, author: 'Writing Coach', kind: 'writing',
          text: COACH_TEXT, createdAt: NOW,
        },
      ],
    }, null, 2)}\n`,
  );
}

// ─── App plumbing (same pattern as mythos-migration.spec.ts) ─────────────────

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
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
  const sceneRow = pg.getByText('The Gate', { exact: true }).first();
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
  // Scene depth → chapter depth: the manuscript view with the comments gutter.
  const chapterBtn = pg.getByTestId('depth-slider').getByRole('button', { name: /^chapter$/i });
  await chapterBtn.click();
  await expect(pg.locator('.chapter-continuous-view')).toBeVisible({ timeout: 10_000 });
}

function readSidecar(bundle: string): { comments: Array<Record<string, unknown>> } {
  return JSON.parse(
    fs.readFileSync(path.join(bundle, 'Story Vault', STORY_TITLE, 'comments.json'), 'utf-8'),
  ) as { comments: Array<Record<string, unknown>> };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe.serial('Comments v2 (M9) — vault sidecar round-trip', () => {
  let tmpRoot: string;
  let userData: string;
  let bundle: string;
  let bundleCopy: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-comments-e2e-'));
    userData = path.join(tmpRoot, 'user-data');
    bundle = path.join(tmpRoot, 'Comments Vault');
    bundleCopy = path.join(tmpRoot, 'Comments Vault Copy');
    seedV2Vault(bundle);
    seedUserData(
      userData,
      path.join(bundle, 'Story Vault'),
      path.join(bundle, 'Notes Vault'),
    );
    app = await launchApp(userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    const proc = app?.process();
    await Promise.race([
      app?.close().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try { if (proc && !proc.killed) proc.kill('SIGKILL'); } catch { /* exited */ }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('TC-CM-01: seeded agent comments render as gutter cards + kind underlines', async () => {
    await openManuscript(page);

    const gutter = page.getByTestId('msv-gutter');
    await expect(gutter).toBeVisible({ timeout: 15_000 });
    await expect(gutter).toContainText('COMMENTS');
    await expect(page.getByTestId('msv-cmt-c-cm-archive')).toContainText('Archive Agent');
    await expect(page.getByTestId('msv-cmt-c-cm-archive')).toContainText(ARCHIVE_TEXT);
    await expect(page.getByTestId('msv-cmt-c-cm-coach')).toContainText('Writing Coach');

    const archiveAnchor = page.getByTestId('msv-anchor-c-cm-archive');
    await expect(archiveAnchor).toHaveText(ARCHIVE_ANCHOR);
    await expect(archiveAnchor).toHaveClass(/msv-anchor--archive/);
    await expect(page.getByTestId('msv-anchor-c-cm-coach')).toHaveClass(/msv-anchor--writing/);

    // The doc-header comments chip shows the live count.
    await expect(page.getByTestId('msv-comments-chip')).toContainText('2');
  });

  test('TC-CM-02: selection composer files a user comment into the M5 sidecar', async () => {
    // Select the whole Scene 02 paragraph (69 chars — inside the 4–219 gate).
    const para = page
      .locator('[data-testid^="msv-para-"]', { hasText: 'rumor had teeth' })
      .first();
    await expect(para).toBeVisible({ timeout: 10_000 });
    await para.click({ clickCount: 3 });

    const selbar = page.getByTestId('msv-selbar');
    await expect(selbar).toBeVisible({ timeout: 5_000 });
    // Composer anatomy: quote + input + Comment + Read-aloud (§5.1).
    await expect(selbar).toContainText('rumor had teeth');
    await expect(page.getByTestId('msv-selbar-read')).toBeEnabled();

    await page.getByTestId('msv-selbar-input').fill(USER_COMMENT);
    await page.getByTestId('msv-selbar-save').click();
    await expect(selbar).not.toBeVisible();

    // Card appears, attributed to the writer, gold kind.
    const gutter = page.getByTestId('msv-gutter');
    await expect(gutter).toContainText(USER_COMMENT);
    await expect(gutter.locator('.msv-cmt--user')).toContainText('You');
    await expect(page.getByTestId('msv-comments-chip')).toContainText('3');

    // …and persists into the v2 sidecar file next to book.md.
    await expect
      .poll(() => readSidecar(bundle).comments.length, { timeout: 10_000 })
      .toBe(3);
    const user = readSidecar(bundle).comments.find((c) => c.kind === 'user');
    expect(user).toMatchObject({
      storyId: STORY_ID,
      sceneId: 'scene-cm-2',
      anchor: SCENE_2_PROSE,
      text: USER_COMMENT,
    });
  });

  test('TC-CM-03: gutter card opens the v2 comment card with actions + focus toggle', async () => {
    await page.getByTestId('msv-cmt-c-cm-archive').click();
    const open = page.getByTestId('msv-copen');
    await expect(open).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('msv-copen-chip')).toHaveText('Archive Agent — continuity');
    await expect(open).toContainText(`on “${ARCHIVE_ANCHOR}`);
    await expect(open).toContainText(ARCHIVE_TEXT);

    // The three archive actions render (disabled affordances here — the seeded
    // flag carries no live suggestion id) plus Resolve + Show in focus.
    await expect(page.getByTestId('msv-copen-act-match_archive')).toHaveText('Edit notes to match');
    await expect(page.getByTestId('msv-copen-act-suggest_story_change')).toHaveText('Suggest story change');
    await expect(page.getByTestId('msv-copen-act-ignore')).toHaveText('Ignore');
    await expect(page.getByTestId('msv-copen-resolve')).toBeVisible();
    await expect(open).toContainText('Show in focus');
    await expect(page.getByTestId('msv-cmt-focus-toggle')).toHaveAttribute('aria-checked', 'false');

    await page.getByTestId('msv-copen-close').click();
    await expect(open).not.toBeVisible();
  });

  test('TC-CM-04: agent + user comments round-trip through a vault copy', async () => {
    // Shut down, copy the WHOLE MythosVault folder, point the app at the copy.
    await app?.close();
    app = undefined;
    fs.cpSync(bundle, bundleCopy, { recursive: true });
    seedUserData(
      userData,
      path.join(bundleCopy, 'Story Vault'),
      path.join(bundleCopy, 'Notes Vault'),
    );
    app = await launchApp(userData);
    page = await firstWindow(app);
    await openManuscript(page);

    // Every comment — the two seeded agent comments AND the user comment
    // created through the composer — survives the copy intact.
    const gutter = page.getByTestId('msv-gutter');
    await expect(gutter).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('msv-cmt-c-cm-archive')).toContainText(ARCHIVE_TEXT);
    await expect(page.getByTestId('msv-cmt-c-cm-coach')).toContainText(COACH_TEXT);
    await expect(gutter).toContainText(USER_COMMENT);
    await expect(gutter.locator('.msv-cmt')).toHaveCount(3);
    await expect(page.getByTestId('msv-anchor-c-cm-archive')).toHaveClass(/msv-anchor--archive/);

    // Resolve is wired in the copy: resolve the user comment from the open card…
    const userCard = gutter.locator('.msv-cmt--user');
    await userCard.click();
    await page.getByTestId('msv-copen-resolve').click();
    await expect(gutter.locator('.msv-cmt')).toHaveCount(2);

    // …the COPY's sidecar updates, and the ORIGINAL vault stays untouched.
    await expect
      .poll(() => readSidecar(bundleCopy).comments.length, { timeout: 10_000 })
      .toBe(2);
    expect(readSidecar(bundle).comments).toHaveLength(3);
  });
});
