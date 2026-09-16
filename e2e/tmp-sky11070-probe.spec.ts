// SKY-11070 scratch probe — NOT for commit. Replays the :184 flow with a
// 120 ms renderer busy-block and dumps the persisted nav-history stack so we
// can see whether the IPC copy double-navigated.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

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
    id: 'scene-1', title: 'Opening Scene', path: 'Test Story/Manuscript/Chapter One/Opening Scene.md', order: 1,
    blocks: [{ id: 'block-1', type: 'prose', content: 'Meet [[Character: Elara]].', order: 1, updatedAt: now }],
    createdAt: now, updatedAt: now,
  };
  const chapter = { id: 'chapter-1', title: 'Chapter One', path: 'Test Story/Manuscript/Chapter One', order: 1, scenes: [scene], createdAt: now, updatedAt: now };
  const story = { id: 'story-1', title: 'Test Story', path: 'Test Story', chapters: [chapter], createdAt: now, updatedAt: now };
  fs.writeFileSync(path.join(storyVaultDir, 'manifest.json'), JSON.stringify({
    version: '1.0.0', vaultRoot: storyVaultDir, stories: [story], chapters: [chapter], scenes: [scene], entities: [], suggestions: [],
  }, null, 2));
  fs.writeFileSync(path.join(storyVaultDir, scene.path), 'Meet [[Character: Elara]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Notes', 'Cross Links.md'), 'Jump to [[Scene: Chapter One/Opening Scene]].');
  fs.writeFileSync(path.join(notesVaultDir, 'Characters', 'Elara.md'), '---\ntitle: Elara\ntype: character\naliases: []\n---\n\nElara profile.');
}

test('SKY-11070 probe: mousedown + delayed IPC back state dump', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-sky11070-probe-'));
  const userData = path.join(tempRoot, 'userData');
  const storyVaultDir = path.join(tempRoot, 'story-vault');
  const notesVaultDir = path.join(tempRoot, 'notes-vault');
  fs.mkdirSync(userData, { recursive: true });
  seedProject(userData, storyVaultDir, notesVaultDir);
  const extraArgs = (process.platform !== 'darwin' && !process.env.DISPLAY) ? ['--headless'] : [];
  const app: ElectronApplication = await electron.launch({ args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs], timeout: 60_000 });
  try {
    const page: Page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('nav[aria-label="Main navigation"]').waitFor({ timeout: 12_000 });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await page.locator('#app-tabpanel-notes').waitFor({ timeout: 5_000 });
    await page.getByText('Cross Links', { exact: true }).click();
    await page.locator('.note-viewer [data-testid="note-gear-btn"]').click();
    await page.locator('[data-testid="note-gear-mode-rich"]').click();
    await page.locator('.note-viewer [data-wiki-link="Scene: Chapter One/Opening Scene"]').click();
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Story Writer"][aria-current="page"]').waitFor({ timeout: 5_000 });

    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true }));
      const until = Date.now() + 120;
      while (Date.now() < until) { /* busy */ }
    });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('nav-history:back');
    });

    // Let the debounced (500 ms) nav-history persistence flush, then dump.
    await page.waitForTimeout(1500);
    const jumpVisible = await page.getByText('Jump to').isVisible().catch(() => false);
    const notesCurrent = await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').getAttribute('aria-current');
    const settings = JSON.parse(fs.readFileSync(path.join(userData, 'app-settings.json'), 'utf8'));
    const nav = settings.navHistory ?? null;
    console.log('PROBE_RESULT ' + JSON.stringify({
      jumpVisible,
      notesCurrent,
      index: nav?.index,
      stack: nav?.stack?.map((l: any) => ({ tab: l.tab, note: l.notePath, scene: l.sceneId, notesDocTab: l.notesDocTabId })),
    }, null, 1));
  } finally {
    await app.close().catch(() => undefined);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
