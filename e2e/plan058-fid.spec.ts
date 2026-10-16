/**
 * PLAN-058 Fid — FD-8 Scene Crafter setup zoom and FD-9 #15 status bar.
 *
 * Fresh profile. Story is created by clicking (reachability). Widths
 * 900 / 936 / 962 / 1024 in one run, with a screenshot at each.
 * FD-9 #10 rail width is not asserted: 44px at 900 breaks notes
 * content-width pins outside this tip's allowlist.
 * FD-9 #15 page-hint margin is not asserted: the margin number is only
 * in DesktopShell pagePrefs, which this allowlist cannot edit.
 * The status chip is dropped: BottomBar cannot see the real save pipeline
 * (scene:saved is manual-snapshot only; autosave and its errors stay in
 * DesktopShell). Layout pins below keep the word count readable.
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
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';
import { createStoryFromNavAdd } from './helpers/newStoryModal';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const WIDTHS = [900, 936, 962, 1024] as const;
const SHOT_DIR = '/opt/cursor/artifacts/screenshots';

function seedUserData(userData: string, vaultDir: string, notesVaultDir: string): void {
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: '',
        onboardingComplete: true,
        theme: 'dark',
        agents: {
          writingAssistant: { enabled: false },
          brainstorm: { enabled: false },
          archive: { enabled: false },
        },
        snapshots: { maxPerScene: 100, maxAgeDays: 30 },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );
}

async function setContentSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow');
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(size.w, size.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 250));
}

test.describe('PLAN-058 Fid-a', () => {
  let app: ElectronApplication | undefined;
  let page: Page;
  let userData = '';
  let vaultDir = '';
  let notesVaultDir = '';

  test.beforeAll(async () => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-ud-'));
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-vault-'));
    notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan058-fid-notes-'));
    seedUserData(userData, vaultDir, notesVaultDir);
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
    app = await electron.launch({
      args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
      timeout: 60_000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
    await setContentSize(app, 1024, 900);
    await clickStoryNav(page);
    await createStoryFromNavAdd(page, 'Fid Story');
    await expect(page.locator('.nav-story-row').first()).toBeVisible({ timeout: 8_000 });
    await page.locator('.nav-story-title').first().click();
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Scene Crafter"]').click();
    await expect(page.locator('.sc-columns')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.scene-crafter-header')).toBeVisible();
    await expect(page.locator('.sc-board-list')).toBeVisible();
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(userData, vaultDir, notesVaultDir);
  });

  test('FD-8 setup column zoom is .9 and header plus board picker stay at 100%', async () => {
    const readZoom = () => page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const z = getComputedStyle(el).zoom;
        return z === 'normal' ? 1 : Number(z);
      };
      return {
        setup: read('.sc-col-setup'),
        header: read('.scene-crafter-header'),
        board: read('.sc-board-list'),
      };
    });

    for (const w of WIDTHS) {
      await setContentSize(app!, w, 900);
      const zoom = await readZoom();
      expect(zoom.setup, `FD-8 setup zoom @${w}`).toBeCloseTo(0.9, 2);
      expect(zoom.header, `FD-8 header stays 100% @${w}`).toBeCloseTo(1, 2);
      expect((zoom.setup ?? 0) * (zoom.board ?? 0), `FD-8 board picker stays 100% @${w}`).toBeCloseTo(1, 2);
      const shot = path.join(SHOT_DIR, `plan058-fid-a-${w}.png`);
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    }
  });

  test('FD-9 #15 word count stays readable and clear of the daily-goal chip', async () => {
    // The status bar mounts only in the editor (shell-panels), not on Scene Crafter.
    await clickStoryNav(page);
    const sceneRow = page.locator('.nav-scene-row').first();
    await sceneRow.click();
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 8_000 });
    // A long scene title is what crowds the bar. The word-count lead must stay
    // fully visible anyway; the title is the piece that ellipsizes.
    await sceneRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename scene…' }).click();
    const prompt = page.locator('.prompt-modal-input');
    await expect(prompt).toBeVisible({ timeout: 8_000 });
    const longTitle = 'Midnight market of the drowned lanterns and the cartographer who would not leave';
    await prompt.fill(longTitle);
    await page.locator('.prompt-modal-ok').click();
    await expect(page.locator('.bottom-scene-name')).toHaveText(longTitle, { timeout: 8_000 });

    const measure = () => page.evaluate(() => {
      const lead = document.querySelector('[data-testid="bottom-stats-lead"]');
      const bar = document.querySelector('.bottom-bar');
      const goal = document.querySelector('[data-testid="bottom-daily-goal"]');
      const voice = document.querySelector('.bottom-voice');
      if (!lead || !bar) return null;
      const range = document.createRange();
      range.selectNodeContents(lead);
      const leadRect = range.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const goalRect = goal?.getBoundingClientRect() ?? null;
      const voiceRect = voice?.getBoundingClientRect() ?? null;
      let clipLeft = -1e9;
      let clipRight = 1e9;
      let clipTop = -1e9;
      let clipBottom = 1e9;
      let p: HTMLElement | null = lead.parentElement;
      while (p) {
        const cs = getComputedStyle(p);
        const clips = (v: string) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
        if (clips(cs.overflowX) || clips(cs.overflowY) || clips(cs.overflow)) {
          const r = p.getBoundingClientRect();
          clipLeft = Math.max(clipLeft, r.left);
          clipRight = Math.min(clipRight, r.right);
          clipTop = Math.max(clipTop, r.top);
          clipBottom = Math.min(clipBottom, r.bottom);
        }
        p = p.parentElement;
      }
      const visibleLeft = Math.max(leadRect.left, clipLeft);
      const visibleRight = Math.min(leadRect.right, clipRight);
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.right > b.left + 0.5 && a.left < b.right - 0.5
        && a.bottom > b.top + 0.5 && a.top < b.bottom - 0.5;
      const inside = (rect: DOMRect, host: DOMRect) =>
        rect.width > 0
        && rect.left >= host.left - 0.5
        && rect.right <= host.right + 0.5
        && rect.top >= host.top - 0.5
        && rect.bottom <= host.bottom + 0.5;
      return {
        text: lead.textContent,
        leadWidth: leadRect.width,
        visibleWidth: Math.max(0, visibleRight - visibleLeft),
        fullyVisible: leadRect.width > 0 && (visibleRight - visibleLeft) >= leadRect.width - 0.5,
        overlapsGoal: goalRect ? overlaps(leadRect, goalRect) : false,
        goalPresent: goalRect !== null,
        voicePresent: voiceRect !== null,
        voiceInsideBar: voiceRect ? inside(voiceRect, barRect) : true,
        voiceOverflowsWindow: voiceRect ? voiceRect.right > window.innerWidth + 0.5 : false,
      };
    });

    for (const w of [900, 1280] as const) {
      await setContentSize(app!, w, 900);
      const box = await measure();
      expect(box, `status bar measured @${w}`).not.toBeNull();
      expect(box!.text, `word count copy @${w}`).toMatch(/^\d[\d,]* words · \d[\d,]* characters$/);
      expect(box!.fullyVisible, `word count truncated @${w} (visible ${box!.visibleWidth} of ${box!.leadWidth})`).toBe(true);
      expect(box!.overlapsGoal, `word count under the daily-goal chip @${w}`).toBe(false);
      expect(box!.voiceInsideBar, `voice indicator outside the bar @${w}`).toBe(true);
      expect(box!.voiceOverflowsWindow, `voice indicator overflows the window @${w}`).toBe(false);
      const shot = path.join(SHOT_DIR, `plan058-fid-b-${w}.png`);
      await page.screenshot({ path: shot });
      expect(fs.existsSync(shot)).toBe(true);
    }
  });

  test('FD-9 #15 word count still updates', async () => {
    await clickStoryNav(page);
    await page.locator('.nav-scene-row').first().click();
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible({ timeout: 8_000 });
    await editor.click();
    await editor.type('alpha beta');
    await expect(page.getByTestId('bottom-live-stats')).toContainText('2 words', { timeout: 3_000 });
  });
});
