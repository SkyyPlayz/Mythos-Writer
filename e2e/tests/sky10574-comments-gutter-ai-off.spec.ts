/**
 * sky10574-comments-gutter-ai-off.spec.ts — SKY-10574 (M11c)
 *
 * PLAN.md M11b contract: agent + human comments show when AI is on; only
 * human comments show when AI is off (agent comments hidden, not deleted —
 * they reappear once AI is switched back on). This exercises the real
 * settings → IPC → `useAiEnabled` → ManuscriptView path end to end, toggling
 * the live "AI features" switch in Settings while the gutter is open.
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
const NOW = '2026-08-19T00:00:00.000Z';

const STORY_ID = 'story-10574';
const STORY_TITLE = 'AI-Off Gutter Fixture';
const SCENE_PROSE = 'The lantern cast a trembling circle of light across the drowned stone.';
const ARCHIVE_ANCHOR = 'trembling circle of light';
const ARCHIVE_TEXT = 'Continuity: this lantern is oil-lit in Ch. 1 but crystal-lit later.';
const USER_ANCHOR = 'drowned stone';
const USER_TEXT = 'Great closer image.';

interface Fixture {
  userData: string;
  bundle: string;
}

function createFixture(): Fixture {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-10574-'));
  const userData = path.join(tmpRoot, 'user-data');
  const bundle = path.join(tmpRoot, 'Vault');
  const storyDir = path.join(bundle, 'Story Vault', STORY_TITLE);
  const chapterDir = path.join(storyDir, 'Part 1', 'Chapter 01');
  fs.mkdirSync(chapterDir, { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Notes Vault'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark', ai: { enabled: true } }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({
      vaultRoot: path.join(bundle, 'Story Vault'),
      notesVaultRoot: path.join(bundle, 'Notes Vault'),
    }, null, 2),
  );

  fs.writeFileSync(
    path.join(bundle, 'mythos.json'),
    JSON.stringify({
      formatVersion: 2,
      id: 'vault-10574',
      name: 'SKY-10574 Vault',
      createdAt: NOW,
      stories: [
        { id: STORY_ID, title: STORY_TITLE, folder: STORY_TITLE, createdAt: NOW, updatedAt: NOW },
      ],
      seed: { layout: 'veynn-v2', mode: 'blank', seededAt: NOW },
    }, null, 2),
  );

  const spine = [
    { dir: 'Part 1', chapters: [{ dir: 'Chapter 01', id: 'ch-10574', title: 'Chapter One' }] },
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
    `---\nid: scene-10574\ntitle: The Gate\nstatus: draft\nupdatedAt: ${NOW}\n---\n${SCENE_PROSE}`,
  );
  fs.writeFileSync(
    path.join(storyDir, 'comments.json'),
    `${JSON.stringify({
      version: 1,
      comments: [
        {
          id: 'c-10574-archive', storyId: STORY_ID, sceneId: 'scene-10574',
          anchor: ARCHIVE_ANCHOR, author: 'Archive Agent', kind: 'archive',
          text: ARCHIVE_TEXT, createdAt: NOW,
        },
        {
          id: 'c-10574-user', storyId: STORY_ID, sceneId: 'scene-10574',
          anchor: USER_ANCHOR, author: 'You', kind: 'user',
          text: USER_TEXT, createdAt: NOW,
        },
      ],
    }, null, 2)}\n`,
  );

  return { userData, bundle: tmpRoot };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const pg = await app.firstWindow();
  await pg.waitForLoadState('domcontentloaded');
  return pg;
}

async function openManuscript(pg: Page): Promise<void> {
  const nav = pg.locator('nav[aria-label="Main navigation"]');
  await expect(nav).toBeVisible({ timeout: 15_000 });
  const storyBtn = nav.getByRole('button', { name: /^story( writer)?$/i }).first();
  if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
    await storyBtn.click();
  }
  const backdrop = pg.locator('[data-testid="nav-rail-stories-backdrop"]');
  if (await backdrop.count()) {
    await backdrop.click({ position: { x: 5, y: 5 }, force: true });
    await expect(backdrop).toHaveCount(0);
  }
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
      /* collapsed again — retry */
    }
  }
  await sceneRow.click();
  await expect(pg.locator('.ProseMirror').first()).toBeVisible({ timeout: 15_000 });
  await pg.getByTestId('msv-zoom-chapter').click();
  await expect(pg.locator('.chapter-continuous-view')).toBeVisible({ timeout: 10_000 });
}

async function setAiToggle(pg: Page, next: boolean): Promise<void> {
  const settingsBtn = pg.locator('button[aria-label*="ettings"], button:has-text("Settings")').first();
  await settingsBtn.click();
  const dialog = pg.locator('[role="dialog"][aria-label="Settings"]');
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const agentsTab = dialog.getByTestId('settings-cat-agents');
  if (await agentsTab.count()) await agentsTab.click();
  const toggle = dialog.locator('input[aria-label="AI features"]');
  await expect(toggle).toBeAttached({ timeout: 5_000 });
  if ((await toggle.isChecked()) !== next) {
    // The input itself is visually hidden behind the styled track (native
    // <label> wraps both) — click the visible track to trigger it.
    await dialog.locator('.ai-master-card .settings-toggle-track').click();
  }
  await pg.getByLabel('Close settings').click();
  await expect(dialog).not.toBeVisible();
}

test('SKY-10574: comments gutter hides agent comments with AI off, restores them on toggle-back-on', async () => {
  const fixture = createFixture();
  let app: ElectronApplication | undefined;
  try {
    app = await launchApp(fixture.userData);
    const page = await firstWindow(app);
    await openManuscript(page);

    const gutter = page.getByTestId('msv-gutter');
    await expect(gutter).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('msv-cmt-c-10574-archive')).toBeVisible();
    await expect(page.getByTestId('msv-cmt-c-10574-user')).toBeVisible();
    await expect(page.getByTestId('msv-comments-chip')).toContainText('2');

    // Toggle AI off — the archive comment hides, the user comment stays.
    await setAiToggle(page, false);
    await expect(page.getByTestId('msv-cmt-c-10574-user')).toBeVisible();
    await expect(page.getByTestId('msv-cmt-c-10574-archive')).toHaveCount(0);
    await expect(page.getByTestId('msv-comments-chip')).toContainText('1');

    // Toggle AI back on — the archive comment reappears (never deleted).
    await setAiToggle(page, true);
    await expect(page.getByTestId('msv-cmt-c-10574-archive')).toBeVisible();
    await expect(page.getByTestId('msv-cmt-c-10574-user')).toBeVisible();
    await expect(page.getByTestId('msv-comments-chip')).toContainText('2');
  } finally {
    const proc = app?.process();
    await Promise.race([
      app?.close().catch(() => undefined) ?? Promise.resolve(),
      new Promise<void>((r) => setTimeout(r, 5_000)),
    ]);
    try {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch { /* already exited */ }
    fs.rmSync(fixture.bundle, { recursive: true, force: true });
  }
});
