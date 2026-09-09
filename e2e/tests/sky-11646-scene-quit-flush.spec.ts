/**
 * sky-11646-scene-quit-flush.spec.ts — SKY-11646
 *
 * QA found this on the v0.5.0-beta.4 Windows packaged build during SKY-11363's
 * AC5 pass: type in the scene editor, click the title bar X inside the 800ms
 * autosave debounce, and the app exits cleanly in ~355ms with the text nowhere
 * on disk. No prompt, no flush, no watchdog — silent data loss in a writing app.
 *
 * SKY-9973 and SKY-11363 built the machinery this needed (main asks the
 * renderer to flush, renderer drains every registered debounced writer, then
 * acks). The scene editor simply never registered: its debounce lives in
 * <RichTextEditor>, and closing the window tears the renderer down without
 * unmounting React, so the flush-on-unmount path never ran either.
 *
 * Component tests cannot prove this — the whole failure is the main-process
 * close handshake racing a renderer debounce across the process boundary
 * (COMPANY-STANDARDS.md §4a). So this drives the real X button on a live
 * Electron process and reads the scene `.md` back off disk after the process
 * has exited.
 *
 *   TC-QF-01  Typing then immediately closing the window persists the text.
 *   TC-QF-02  Opening a scene and closing without typing leaves it byte-identical.
 *
 * Fixture/plumbing follow paragraph-editing.spec.ts (same v2 bundle shape).
 *
 * Run:
 *   npx playwright test e2e/tests/sky-11646-scene-quit-flush.spec.ts --reporter=list
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
const NOW = '2026-07-01T00:00:00.000Z';
const STORY_TITLE = 'Quit Flush Story';
const SCENE_TITLE = 'The Gate';
const SEED_PROSE = 'The lantern flickered once.';

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

function seedV2Vault(bundle: string): { scenePath: string } {
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-qf-1',
      name: 'Quit Flush Vault',
      createdAt: NOW,
      stories: [
        { id: 'story-qf-1', title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      // Seed marker present → the demo-content seeder must never run here.
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-qf-1', title: 'Chapter One' }] },
  ];
  fs.writeFileSync(
    path.join(storyDir, 'book.md'),
    [
      '---',
      'id: story-qf-1',
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
    `---\nid: scene-qf-1\ntitle: ${SCENE_TITLE}\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SEED_PROSE}\n`,
  );
  return { scenePath };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY)
    ? ['--headless']
    : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  pg.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

/** Activate the Story section without tripping the nav rail Stories popover. */
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

/** Open the seeded scene and wait for its ProseMirror surface. */
async function openScene(pg: Page): Promise<void> {
  await clickStorySection(pg);
  const storyRow = pg.getByRole('button', { name: new RegExp(STORY_TITLE) }).first();
  await expect(storyRow).toBeVisible({ timeout: 20_000 });
  const chapterRow = pg.getByRole('button', { name: /Chapter One/ }).first();
  if (!(await chapterRow.isVisible().catch(() => false))) {
    await storyRow.click();
  }
  await expect(chapterRow).toBeVisible({ timeout: 10_000 });
  // Boot-time reindex re-renders the navigator and can collapse a freshly
  // expanded chapter — retry the expand until the scene row stays visible.
  const sceneRow = pg.getByRole('button', { name: new RegExp(SCENE_TITLE) }).first();
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
  const surface = pg.locator('.ProseMirror').first();
  await expect(surface).toBeVisible({ timeout: 15_000 });
  await expect(surface).toContainText(SEED_PROSE, { timeout: 15_000 });
}

/** Body content after the frontmatter's closing `---`. */
function sceneBody(scenePath: string): string {
  const parts = fs.readFileSync(scenePath, 'utf-8').split('---\n');
  return (parts[2] ?? '').replace(/^\n/, '');
}

test.describe('SKY-11646 — scene editor flushes on window close', () => {
  test('TC-QF-01: typing then immediately clicking X persists the text to disk', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-quit-flush-'));
    const userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'Quit Flush Vault');
    const { scenePath } = seedV2Vault(bundle);
    seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));

    const app = await launchApp(userData);
    const page = await firstWindow(app);
    await openScene(page);

    const surface = page.locator('.ProseMirror').first();
    await surface.click();
    await page.keyboard.press('End');
    // insertText lands the whole edit in ONE input event, so the 800ms
    // debounce is armed exactly once and the close below is comfortably
    // inside it — the reported repro, minus the per-keystroke timing noise.
    const typed = ' Then the room went dark.';
    await page.keyboard.insertText(typed);
    await expect(surface).toContainText(typed);

    // No settle, no wait: straight to the X button, exactly as the user did.
    await page.getByRole('button', { name: 'Close window' }).click();

    // The process must exit on its own — a hung close is the SKY-11363 bug.
    await app.waitForEvent('close', { timeout: 20_000 });

    // Read AFTER the process is gone, so nothing can still be in flight.
    expect(sceneBody(scenePath)).toContain(typed.trim());
    expect(sceneBody(scenePath)).toContain(SEED_PROSE);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('TC-QF-02: opening a scene and closing without typing rewrites nothing', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-quit-noflush-'));
    const userData = path.join(tmpRoot, 'user-data');
    const bundle = path.join(tmpRoot, 'Quit Flush Vault');
    const { scenePath } = seedV2Vault(bundle);
    seedUserData(userData, path.join(bundle, 'Story Vault'), path.join(bundle, 'Notes Vault'));
    const before = fs.readFileSync(scenePath, 'utf-8');

    const app = await launchApp(userData);
    const page = await firstWindow(app);
    await openScene(page);

    await page.getByRole('button', { name: 'Close window' }).click();
    await app.waitForEvent('close', { timeout: 20_000 });

    // Tiptap's initial content-normalization arms a pending flush of its own.
    // Quitting must not mistake that for an edit and rewrite an untouched
    // scene (which would also churn its "last edited" stamp).
    expect(fs.readFileSync(scenePath, 'utf-8')).toBe(before);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
