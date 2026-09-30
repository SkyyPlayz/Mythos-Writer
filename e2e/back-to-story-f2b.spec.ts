/**
 * F2#7 — "Back to story" (Story Writer rail item): no blank frame + last
 * position restored (selected scene + scroll).
 *
 * Done-when: clicking the top-left Story Writer button returns to the last
 * story-editor stop with story content visible on the first paint after the
 * click (no empty shell flash), and scroll + scene match what was left.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const now = '2026-09-29T00:00:00.000Z';

/** Tall prose so `.msv-page` can scroll past 0. */
function longSceneBody(): string {
  const paras: string[] = [];
  for (let i = 1; i <= 40; i += 1) {
    paras.push(
      `Paragraph ${i}. The lantern light caught the river mist and the old stones of the quay. ` +
        `Elara counted the barges until the numbers blurred into the fog. `.repeat(3),
    );
  }
  return paras.join('\n\n');
}

function seedProject(userData: string, storyVaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Notes'), { recursive: true });

  const body = longSceneBody();
  const scene = {
    id: 'scene-1',
    title: 'Opening Scene',
    path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
    order: 1,
    blocks: [{ id: 'block-1', type: 'prose', content: body, order: 1, updatedAt: now }],
    createdAt: now,
    updatedAt: now,
  };
  const chapter = {
    id: 'chapter-1',
    title: 'Chapter One',
    path: 'Test Story/Manuscript/Chapter One',
    order: 1,
    scenes: [scene],
    createdAt: now,
    updatedAt: now,
  };
  const story = {
    id: 'story-1',
    title: 'Test Story',
    path: 'Test Story',
    chapters: [chapter],
    createdAt: now,
    updatedAt: now,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        onboardingComplete: true,
        theme: 'dark',
        agents: { brainstorm: { enabled: false } },
        lastOpenedScene: {
          sceneId: scene.id,
          scenePath: scene.path,
          scrollTop: 0,
          cursorLine: 0,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
  fs.writeFileSync(
    path.join(storyVaultDir, 'manifest.json'),
    JSON.stringify(
      {
        version: '1.0.0',
        vaultRoot: storyVaultDir,
        stories: [story],
        chapters: [chapter],
        scenes: [scene],
        entities: [],
        suggestions: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(storyVaultDir, scene.path), body);
  fs.writeFileSync(path.join(notesVaultDir, 'Notes', 'Scratch.md'), 'Scratch note body.');
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

test.describe('F2#7 Back to story (Story Writer rail)', () => {
  let tempRoot: string;
  let userData: string;

  test.beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-f2b-back-story-'));
    userData = path.join(tempRoot, 'userData');
    const storyVaultDir = path.join(tempRoot, 'story-vault');
    const notesVaultDir = path.join(tempRoot, 'notes-vault');
    fs.mkdirSync(userData, { recursive: true });
    seedProject(userData, storyVaultDir, notesVaultDir);
  });

  test.afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('Story Writer rail restores scene + scroll with story visible on first paint', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const storyBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      // Boot may already be on Story Writer via lastOpenedScene — do not
      // re-click (that toggles the Stories popover and blocks the rail).
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('nav-rail-stories-backdrop')).toHaveCount(0, { timeout: 3_000 }).catch(() => undefined);
      if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
        await storyBtn.click();
      }
      await expect(storyBtn).toHaveAttribute('aria-current', 'page', { timeout: 8_000 });

      const msv = page.getByTestId('msv-page');
      await expect(msv).toBeVisible({ timeout: 8_000 });
      await expect(msv).toContainText('Paragraph 1', { timeout: 8_000 });
      await expect(msv).toContainText('Opening Scene');

      // Scroll deep into the manuscript and remember the offset.
      const savedScroll = await msv.evaluate((el) => {
        const target = Math.min(1200, Math.max(400, el.scrollHeight - el.clientHeight - 40));
        el.scrollTop = target;
        return el.scrollTop;
      });
      expect(savedScroll).toBeGreaterThan(200);

      // Leave story for Notes so the rail click is a real "Back to story".
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });
      await expect(storyBtn).not.toHaveAttribute('aria-current', 'page');

      // Click Story Writer and sample the first animation frame after the click.
      const firstPaint = await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          'nav[aria-label="Main navigation"] button[aria-label="Story Writer"]',
        );
        if (!btn) throw new Error('Story Writer rail button missing');
        btn.click();
        return new Promise<{
          panelDisplay: string;
          hasMsv: boolean;
          msvVisible: boolean;
          emptyVisible: boolean;
          scrollTop: number;
          hasOpeningScene: boolean;
          hasParagraph: boolean;
        }>((resolve) => {
          requestAnimationFrame(() => {
            const panel = document.getElementById('app-tabpanel-story');
            const msvEl = document.querySelector<HTMLElement>('[data-testid="msv-page"]');
            const empty = document.querySelector<HTMLElement>('.shell-editor-empty');
            const panelDisplay = panel ? getComputedStyle(panel).display : 'none';
            const msvVisible = !!(
              msvEl &&
              panelDisplay !== 'none' &&
              getComputedStyle(msvEl).display !== 'none'
            );
            const emptyVisible = !!(
              empty &&
              panelDisplay !== 'none' &&
              getComputedStyle(empty).display !== 'none' &&
              empty.offsetParent !== null
            );
            const text = msvEl?.textContent ?? '';
            resolve({
              panelDisplay,
              hasMsv: !!msvEl,
              msvVisible,
              emptyVisible,
              scrollTop: msvEl?.scrollTop ?? -1,
              hasOpeningScene: text.includes('Opening Scene'),
              hasParagraph: text.includes('Paragraph'),
            });
          });
        });
      });

      expect(firstPaint.panelDisplay).not.toBe('none');
      expect(firstPaint.hasMsv).toBe(true);
      expect(firstPaint.msvVisible).toBe(true);
      expect(firstPaint.emptyVisible).toBe(false);
      expect(firstPaint.hasOpeningScene).toBe(true);
      expect(firstPaint.hasParagraph).toBe(true);
      // Allow 1px tolerance for subpixel rounding; must not be the blank top.
      expect(Math.abs(firstPaint.scrollTop - savedScroll)).toBeLessThanOrEqual(2);

      await expect(storyBtn).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(msv).toBeVisible();
      await expect(msv).toContainText('Opening Scene');
      const afterScroll = await msv.evaluate((el) => el.scrollTop);
      expect(Math.abs(afterScroll - savedScroll)).toBeLessThanOrEqual(2);
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('Story Writer from Scene Crafter restores editor without empty shell', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      const storyBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]');
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('nav-rail-stories-backdrop')).toHaveCount(0, { timeout: 3_000 }).catch(() => undefined);
      if ((await storyBtn.getAttribute('aria-current')) !== 'page') {
        await storyBtn.click();
      }
      const msv = page.getByTestId('msv-page');
      await expect(msv).toBeVisible({ timeout: 8_000 });
      await expect(msv).toContainText('Paragraph 1', { timeout: 8_000 });

      const savedScroll = await msv.evaluate((el) => {
        el.scrollTop = Math.min(900, Math.max(300, el.scrollHeight - el.clientHeight - 40));
        return el.scrollTop;
      });
      expect(savedScroll).toBeGreaterThan(200);

      const crafterBtn = page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]');
      await crafterBtn.click();
      await expect(crafterBtn).toHaveAttribute('aria-current', 'page', { timeout: 8_000 });
      // Editor keep-alive stays mounted but hidden while Crafter is active.
      await expect(page.getByTestId('shell-panels-story-editor')).toBeAttached();
      await expect(page.getByTestId('shell-panels-story-editor')).toHaveCSS('display', 'none');

      const firstPaint = await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          'nav[aria-label="Main navigation"] button[aria-label="Story Writer"]',
        );
        if (!btn) throw new Error('Story Writer rail button missing');
        btn.click();
        return new Promise<{
          msvVisible: boolean;
          emptyVisible: boolean;
          scrollTop: number;
          hasOpeningScene: boolean;
        }>((resolve) => {
          requestAnimationFrame(() => {
            const msvEl = document.querySelector<HTMLElement>('[data-testid="msv-page"]');
            const panels = document.querySelector<HTMLElement>('[data-testid="shell-panels-story-editor"]');
            const empty = document.querySelector<HTMLElement>('.shell-editor-empty');
            const panelsHidden = panels ? getComputedStyle(panels).display === 'none' : true;
            const msvVisible = !!(msvEl && !panelsHidden && getComputedStyle(msvEl).display !== 'none');
            const emptyVisible = !!(empty && !panelsHidden && empty.offsetParent !== null);
            resolve({
              msvVisible,
              emptyVisible,
              scrollTop: msvEl?.scrollTop ?? -1,
              hasOpeningScene: (msvEl?.textContent ?? '').includes('Opening Scene'),
            });
          });
        });
      });

      expect(firstPaint.msvVisible).toBe(true);
      expect(firstPaint.emptyVisible).toBe(false);
      expect(firstPaint.hasOpeningScene).toBe(true);
      expect(Math.abs(firstPaint.scrollTop - savedScroll)).toBeLessThanOrEqual(2);
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
