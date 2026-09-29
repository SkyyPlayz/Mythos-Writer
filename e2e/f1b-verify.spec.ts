/**
 * f1b-verify.spec.ts — real-app VERIFY (Electron). Seed = comments-v2 (known load).
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
const OUT_DIR =
  process.env.F1B_VERIFY_OUT ||
  '/cursor/stores/bc-fb92daf9-4bac-4b89-898c-bb6f10dab5c7/media/beta-f1b';
const NOW = '2026-07-01T00:00:00.000Z';
const STORY_ID = 'story-cm-1';
const STORY_TITLE = 'The Deep';
const SCENE_2_PROSE = 'By morning the rumor had teeth, and the whole quarter knew her name.';

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

/** comments-v2 seed (single titled Part 1 — loads reliably). */
function seedV2Vault(bundle: string): void {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-f1b-1',
      name: 'F1b Verify Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
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
    scene('scene-cm-1', 'The Gate', 'The lantern cast a trembling circle of light across the drowned stone.'),
  );
  fs.writeFileSync(
    path.join(chapterDir, 'Scene 02.md'),
    scene('scene-cm-2', 'The Rumor', SCENE_2_PROSE),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs =
    process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  const app = await electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d: Buffer) => console.log('[main:out]', d.toString().trimEnd()));
  proc.stderr?.on('data', (d: Buffer) => console.log('[main:err]', d.toString().trimEnd()));
  return app;
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

async function openManuscript(pg: Page): Promise<void> {
  await clickStorySection(pg);
  const storyRow = pg.getByRole('button', { name: new RegExp(STORY_TITLE) }).first();
  await expect(storyRow).toBeVisible({ timeout: 20_000 });
  const chapterRow = pg.getByRole('button', { name: /Chapter One/ }).first();
  if (!(await chapterRow.isVisible().catch(() => false))) {
    await storyRow.click();
  }
  await expect(chapterRow).toBeVisible({ timeout: 10_000 });
  const sceneRow = pg.getByRole('button', { name: /The Gate/ }).first();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await chapterRow.click();
    try {
      await sceneRow.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch {
      /* retry */
    }
  }
  await sceneRow.click();
  await expect(pg.getByTestId('msv-root')).toBeVisible({ timeout: 15_000 });
  await pg.getByTestId('msv-zoom-chapter').click();
  await expect(pg.getByTestId('msv-sheet')).toBeVisible({ timeout: 10_000 });
}

test.describe.serial('F1b real-app VERIFY', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let tmpRoot: string;

  test.beforeAll(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f1b-verify-'));
    const userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'F1b Vault');
    seedV2Vault(bundle);
    seedUserData(
      userData,
      path.join(bundle, 'Story Vault'),
      path.join(bundle, 'Notes Vault'),
    );
    app = await launchApp(userData);
    page = await app.firstWindow();
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1440, height: 900 });
    await openManuscript(page);
  });

  test.afterAll(async () => {
    const proc = app?.process();
    await Promise.race([
      app?.close().catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch {
      /* exited */
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('F4#6: StructuralBreadcrumb live in msv-crumbs', async () => {
    const crumbs = page.getByTestId('msv-crumbs');
    await expect(crumbs).toBeVisible();
    await expect(crumbs.getByTestId('struct-breadcrumb')).toBeVisible();
    await expect(crumbs.getByTestId('struct-breadcrumb-root')).toContainText(STORY_TITLE);
    // Chapter depth should show chapter crumb; part crumb if Part 1 is a real titled part.
    await expect(crumbs).toContainText(/Ch\.\s*\d+|Chapter One/);
    const crumbText = (await crumbs.textContent()) || '';
    // Record whether part crumb is present for the verify report (not a hard fail —
    // simple-single-part stories intentionally omit it; multi-part covered by unit).
    fs.writeFileSync(
      path.join(OUT_DIR, 'f1b-crumb-text.txt'),
      crumbText,
      'utf8',
    );
    await page.screenshot({
      path: path.join(OUT_DIR, 'f1b-real-crumbs-1440x900.png'),
      fullPage: false,
    });
  });

  test('F2#5: sheet editables contain no nav/chrome nodes', async () => {
    const leak = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="msv-sheet"]');
      if (!sheet) return { ok: false, reason: 'no sheet' };
      const editables = sheet.querySelectorAll('[contenteditable="true"], .ProseMirror');
      const offenders: string[] = [];
      editables.forEach((el) => {
        if (
          el.querySelector(
            '[data-msv-chrome], .msv-crumbs, .msv-zoombar, .msv-toolbar, .struct-breadcrumb',
          )
        ) {
          offenders.push(el.getAttribute('data-testid') || el.className || el.tagName);
        }
        if (el.closest('[data-msv-chrome]')) offenders.push('editable-inside-chrome');
      });
      const crumbs = document.querySelector('[data-testid="msv-crumbs"]');
      const chromeOutside =
        !!document.querySelector('.msv-zoombar[data-msv-chrome="true"]') &&
        !!document.querySelector('.msv-toolbar[data-msv-chrome="true"]') &&
        !!crumbs &&
        !sheet.contains(crumbs);
      return {
        ok: offenders.length === 0 && chromeOutside && editables.length > 0,
        offenders,
        chromeOutside,
        editableCount: editables.length,
      };
    });
    expect(leak.ok, JSON.stringify(leak)).toBe(true);
    await page.screenshot({
      path: path.join(OUT_DIR, 'f1b-real-chrome-1440x900.png'),
      fullPage: false,
    });
  });

  test('F4#16: selection alone does not open composer; Comment arm required', async () => {
    const para = page
      .locator('[data-testid^="msv-para-"]', { hasText: 'rumor had teeth' })
      .first();
    await expect(para).toBeVisible({ timeout: 10_000 });
    await para.click({ clickCount: 3 });
    await expect(page.getByTestId('msv-selbar')).toHaveCount(0);
    await expect(page.getByTestId('msv-comment-arm')).toBeVisible({ timeout: 5_000 });
    await page.screenshot({
      path: path.join(OUT_DIR, 'f1b-real-comment-arm-1440x900.png'),
      fullPage: false,
    });
    await page.getByTestId('msv-comment-arm').click();
    await expect(page.getByTestId('msv-selbar')).toBeVisible({ timeout: 5_000 });
    await page.screenshot({
      path: path.join(OUT_DIR, 'f1b-real-composer-1440x900.png'),
      fullPage: false,
    });
  });
});
