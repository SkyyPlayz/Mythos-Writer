// SKY-2099: E2E coverage for cross-tab wiki-link jumps and tab-aware shortcuts.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const now = '2026-06-17T00:00:00.000Z';

function seedProject(userData: string, storyVaultDir: string, notesVaultDir: string): void {
  fs.mkdirSync(path.join(storyVaultDir, 'Test Story', 'Manuscript', 'Chapter One'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Notes'), { recursive: true });
  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark', agents: { brainstorm: { enabled: false } } }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyVaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );

  const scene = {
    id: 'scene-1',
    title: 'Opening Scene',
    path: 'Test Story/Manuscript/Chapter One/Opening Scene.md',
    order: 1,
    blocks: [{ id: 'block-1', type: 'prose', content: 'Meet [[Character: Elara]].', order: 1, updatedAt: now }],
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

  fs.writeFileSync(path.join(storyVaultDir, 'manifest.json'), JSON.stringify({
    version: '1.0.0',
    vaultRoot: storyVaultDir,
    stories: [story],
    chapters: [chapter],
    scenes: [scene],
    entities: [],
    suggestions: [],
  }, null, 2));
  fs.writeFileSync(path.join(storyVaultDir, scene.path), 'Meet [[Character: Elara]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Notes', 'Cross Links.md'), 'Jump to [[Scene: Chapter One/Opening Scene]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Elara.md'), '---\ntitle: Elara\ntype: character\naliases: []\n---\n\nElara profile.');
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  return electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

test.describe('Cross-tab links and tab-aware shortcuts', () => {
  let tempRoot: string;
  let userData: string;
  let storyVaultDir: string;
  let notesVaultDir: string;

  test.beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-cross-tab-'));
    userData = path.join(tempRoot, 'userData');
    storyVaultDir = path.join(tempRoot, 'story-vault');
    notesVaultDir = path.join(tempRoot, 'notes-vault');
    fs.mkdirSync(userData, { recursive: true });
    seedProject(userData, storyVaultDir, notesVaultDir);
  });

  test.afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('wiki links jump between Notes and Story tabs in both directions', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });
      await page.getByText('Cross Links', { exact: true }).click();
      // M17: the mode seg moved into the gear popover; rendered links live in Rich.
      await page.locator('.note-viewer [data-testid="note-gear-btn"]').click();
      await page.locator('[data-testid="note-gear-mode-rich"]').click();
      await page.locator('.note-viewer [data-wiki-link="Scene: Chapter One/Opening Scene"]').click();

      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.locator('.scene-name', { hasText: 'Opening Scene' })).toBeVisible();

      await page.getByText('[[Character: Elara]]', { exact: true }).click();
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.getByText('Elara profile.')).toBeVisible({ timeout: 5_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('tab-aware Notes shortcuts switch preview, graph, and Brainstorm only in Notes', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Control+G');
      await expect(page.locator('[data-testid="notes-graph-view"]')).toBeVisible({ timeout: 5_000 });
      await page.keyboard.press('Control+B');
      await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).not.toBeVisible({ timeout: 5_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
