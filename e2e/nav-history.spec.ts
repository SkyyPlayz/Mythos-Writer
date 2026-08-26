// SKY-10916: E2E coverage for the app-wide navigation history (Back/Forward).
// Follows a wikilink chain across Notes -> Story -> Notes, then verifies
// Alt+Left/Alt+Right (and, as a smoke check, the mouse X1/X2 side buttons)
// retrace the exact chain in reverse and back again.
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

test.describe('App-wide navigation history (Back/Forward)', () => {
  let tempRoot: string;
  let userData: string;
  let storyVaultDir: string;
  let notesVaultDir: string;

  test.beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-nav-history-'));
    userData = path.join(tempRoot, 'userData');
    storyVaultDir = path.join(tempRoot, 'story-vault');
    notesVaultDir = path.join(tempRoot, 'notes-vault');
    fs.mkdirSync(userData, { recursive: true });
    seedProject(userData, storyVaultDir, notesVaultDir);
  });

  test.afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('Alt+Left/Alt+Right retrace a wikilink chain across Notes and Story tabs', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      // A: open "Cross Links" note in Notes.
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });
      await page.getByText('Cross Links', { exact: true }).click();
      await page.locator('.note-viewer [data-testid="note-gear-btn"]').click();
      await page.locator('[data-testid="note-gear-mode-rich"]').click();
      await expect(page.locator('.note-viewer [data-wiki-link="Scene: Chapter One/Opening Scene"]')).toBeVisible({ timeout: 5_000 });

      // A -> B: follow the wikilink into the Story tab's Opening Scene.
      await page.locator('.note-viewer [data-wiki-link="Scene: Chapter One/Opening Scene"]').click();
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.locator('.msv-crumb--current', { hasText: 'Opening Scene' })).toBeVisible();

      // B -> C: follow a second wikilink back into Notes (Elara's profile).
      await page.getByText('[[Character: Elara]]', { exact: true }).click();
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.getByText('Elara profile.')).toBeVisible({ timeout: 5_000 });

      // Back once: C -> B (Story tab, Opening Scene).
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.locator('.msv-crumb--current', { hasText: 'Opening Scene' })).toBeVisible();

      // Back again: B -> A (Notes tab, Cross Links note).
      await page.keyboard.press('Alt+ArrowLeft');
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.getByText('Jump to')).toBeVisible({ timeout: 5_000 });

      // Forward twice: A -> B -> C.
      await page.keyboard.press('Alt+ArrowRight');
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.locator('.msv-crumb--current', { hasText: 'Opening Scene' })).toBeVisible();

      await page.keyboard.press('Alt+ArrowRight');
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.getByText('Elara profile.')).toBeVisible({ timeout: 5_000 });
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  test('mouse X1/X2 side buttons drive Back/Forward the same as Alt+Left/Alt+Right', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });
      await page.getByText('Cross Links', { exact: true }).click();
      await page.locator('.note-viewer [data-testid="note-gear-btn"]').click();
      await page.locator('[data-testid="note-gear-mode-rich"]').click();
      await page.locator('.note-viewer [data-wiki-link="Scene: Chapter One/Opening Scene"]').click();
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });

      // Real hardware X1/X2 side buttons aren't reachable via Playwright's
      // mouse API (only left/middle/right) — dispatch the same synthetic
      // `mousedown` (button 3 = back / X1) the OS would deliver, to exercise
      // the app's DOM-level listener wiring end-to-end.
      await page.evaluate(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true }));
      });
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.getByText('Jump to')).toBeVisible({ timeout: 5_000 });

      await page.evaluate(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { button: 4, bubbles: true, cancelable: true }));
      });
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.locator('.msv-crumb--current', { hasText: 'Opening Scene' })).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });

  // SKY-11042: Windows side-button can fire both a DOM mousedown (button 3/4)
  // AND an Electron app-command IPC event for the same physical click. Without
  // the 50 ms coalescing guard the nav history would step twice — landing two
  // entries back instead of one. Simulate both paths firing in rapid succession
  // and assert exactly one back-navigation occurred.
  test('simultaneous mousedown + IPC back does not double-navigate (SKY-11042)', async () => {
    const app = await launchApp(userData);
    try {
      const page = await firstWindow(app);
      await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });

      // Build a two-step history: Home → Notes → Story (via wikilink)
      await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible({ timeout: 5_000 });
      await page.getByText('Cross Links', { exact: true }).click();
      await page.locator('.note-viewer [data-testid="note-gear-btn"]').click();
      await page.locator('[data-testid="note-gear-mode-rich"]').click();
      await page.locator('.note-viewer [data-wiki-link="Scene: Chapter One/Opening Scene"]').click();
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });

      // Fire the DOM mousedown (button 3 = X1 back) first, then immediately
      // fire the IPC `nav-history:back` channel from the main process — this
      // simulates the Windows double-delivery within the 50 ms coalescing window.
      // The guard must suppress the IPC copy, leaving exactly one step back.
      await page.evaluate(() => {
        window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true }));
      });
      // Send the IPC back event from main — arrives async but well within 50 ms
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('nav-history:back');
      });

      // Should have gone back exactly once: we're on the Notes tab showing "Cross Links"
      await expect(page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]')).toHaveAttribute('aria-current', 'page', { timeout: 5_000 });
      await expect(page.getByText('Jump to')).toBeVisible({ timeout: 5_000 });
      // We should NOT have gone all the way back past Notes (double-fire would)
      await expect(page.locator('#app-tabpanel-notes')).toBeVisible();
    } finally {
      await app.close().catch(() => undefined);
    }
  });
});
