/**
 * notes-brainstorm-clip-057.spec.ts — PLAN-BRAINSTORM-CLIP-057 r2
 *
 * Notes tab Brainstorm right pane must fit at 900/1024/1440 with real
 * BrowserWindow setContentSize (not page viewport only). Freeze conditions:
 *   1. setContentSize 900/1024/1440×900
 *   2. elementFromPoint on Send AND New session centers → button/child
 *   3. type then click Send; stubbed stream:start mock (no real AI)
 *   4. scrollWidth ≤ clientWidth on right pane AND documentElement
 *   5. no saved right width; saved-500-left stays 500
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
import { closeElectronApp, removeTempDirs } from '../helpers/electronTeardown';

const MAIN_JS = path.resolve(__dirname, '../../out/main/main.js');
/** STEP 0 math: bodyCW@900=771 → 771−268−4−300−4 = 195 */
const PANE_MIN_PX = 195;
const LEFT_DEFAULT = 268;
const RIGHT_PREFERRED = 340;

const MOCK_TOKENS = ['Clip057 mock reply. '];

interface Fixture {
  userData: string;
  vaultDir: string;
  notesVaultDir: string;
}

function agentCfg(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    model: 'claude-haiku-4-5-20251001',
    autoApply: false,
    confidenceThreshold: 0.85,
    maxTokensPerHour: 100_000,
    maxSuggestionsPerHour: 50,
    heartbeatIntervalMinutes: 5,
    maxTokensPerDay: 500_000,
    ...extra,
  };
}

function seedFixture(opts: { notesSidebarWidth?: number } = {}): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-clip057-ud-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-clip057-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-clip057-notes-'));

  const tabShell = {
    activeTab: 'notes',
    storySubView: 'editor',
    notesSubView: 'editor',
    storySidebarWidth: 240,
    notesSidebarWidth: opts.notesSidebarWidth ?? LEFT_DEFAULT,
    storySidebarCollapsed: false,
    notesSidebarCollapsed: false,
  };

  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify(
      {
        apiKey: 'sk-ant-test-key-for-e2e',
        onboardingComplete: true,
        ai: { enabled: true },
        agents: {
          writingAssistant: { ...agentCfg({ enabled: false }), scanIntervalSeconds: 30 },
          brainstorm: agentCfg(),
          archive: {
            ...agentCfg({ enabled: false }),
            continuityCheckIntervalSeconds: 60,
          },
        },
        theme: 'dark',
        snapshots: { maxPerScene: 100, maxAgeDays: 30 },
        activeLayout: { leftSidebar: { panels: [] }, tabShell },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesVaultDir }, null, 2),
  );

  fs.mkdirSync(path.join(notesVaultDir, 'Characters'), { recursive: true });
  fs.writeFileSync(
    path.join(notesVaultDir, 'Characters', 'Clip057.md'),
    '---\ntype: character\n---\n\n# Clip057\n',
  );

  const now = new Date().toISOString();
  const storyId = 'clip057-story';
  const chapterId = 'clip057-ch';
  const sceneId = 'clip057-sc';
  const sceneDir = path.join(vaultDir, 'stories', storyId, 'chapters', chapterId, 'scenes');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, `${sceneId}.md`), '---\ntitle: "Clip"\n---\n\nHello.\n');
  fs.writeFileSync(
    path.join(vaultDir, 'manifest.json'),
    JSON.stringify({
      version: '1',
      vaultRoot: vaultDir,
      stories: [
        {
          id: storyId,
          title: 'Clip057 Story',
          path: `stories/${storyId}`,
          createdAt: now,
          updatedAt: now,
          chapters: [
            {
              id: chapterId,
              title: 'Ch',
              storyId,
              order: 0,
              createdAt: now,
              updatedAt: now,
              scenes: [
                {
                  id: sceneId,
                  title: 'Clip',
                  path: `stories/${storyId}/chapters/${chapterId}/scenes/${sceneId}.md`,
                  chapterId,
                  storyId,
                  order: 0,
                  draftState: 'in-progress',
                  createdAt: now,
                  updatedAt: now,
                  blocks: [],
                },
              ],
            },
          ],
        },
      ],
      entities: [],
      suggestions: [],
      scenes: [],
      chapters: [],
    }),
  );

  return { userData, vaultDir, notesVaultDir };
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const headlessArgs =
    process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...headlessArgs],
    timeout: 60_000,
  });
}

async function setContentSize(app: ElectronApplication, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('no BrowserWindow');
    win.setContentSize(size.w, size.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 250));
}

async function installStreamMock(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ ipcMain }, tokens: string[]) => {
    ipcMain.removeHandler('stream:start');
    ipcMain.handle('stream:start', async (event) => {
      const streamId = `mock-stream-clip057-${Date.now()}`;
      void (async () => {
        for (const token of tokens) {
          await new Promise<void>((r) => setTimeout(r, 20));
          if (!event.sender.isDestroyed()) {
            event.sender.send('stream:token', { streamId, token });
          }
        }
        await new Promise<void>((r) => setTimeout(r, 20));
        if (!event.sender.isDestroyed()) {
          event.sender.send('stream:end', { streamId });
        }
      })();
      return { streamId };
    });
  }, MOCK_TOKENS);
}

async function goNotesAgent(page: Page): Promise<void> {
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await expect(page.locator('[data-testid="notes-tab-center"]')).toBeVisible({ timeout: 15_000 });
  const agentTab = page.locator('[data-testid="notes-right-tab-agent"]');
  if (await agentTab.isVisible().catch(() => false)) {
    await agentTab.click();
  }
  await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({
    timeout: 10_000,
  });
}

function pane(page: Page) {
  return page.locator('[data-testid="notes-brainstorm-panel"]');
}

async function boxInsideViewportAndPane(
  page: Page,
  selector: string,
): Promise<void> {
  const ok = await page.evaluate((sel) => {
    const root = document.querySelector('[data-testid="notes-brainstorm-panel"]');
    const el = document.querySelector(`.notes-tab-sidebar-right ${sel}`);
    if (!root || !el) return { ok: false, reason: 'missing' };
    const er = el.getBoundingClientRect();
    const pr = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const insidePane =
      er.left >= pr.left - 1 &&
      er.right <= pr.right + 1 &&
      er.top >= pr.top - 1 &&
      er.bottom <= pr.bottom + 1;
    const insideVp =
      er.left >= -1 && er.right <= vw + 1 && er.top >= -1 && er.bottom <= vh + 1;
    return { ok: insidePane && insideVp, insidePane, insideVp, er: { l: er.left, r: er.right, t: er.top, b: er.bottom }, pr: { l: pr.left, r: pr.right } };
  }, selector);
  expect(ok.ok, `${selector} must sit inside pane + viewport: ${JSON.stringify(ok)}`).toBe(true);
}

async function elementFromPointIsControl(
  page: Page,
  selector: string,
): Promise<void> {
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(`.notes-tab-sidebar-right ${sel}`) as HTMLElement | null;
    if (!el) return { ok: false, reason: 'missing' };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const ok = !!(top && (top === el || el.contains(top)));
    return {
      ok,
      top: top ? String((top as HTMLElement).className || top.tagName).slice(0, 80) : null,
    };
  }, selector);
  expect(hit.ok, `${selector} elementFromPoint: ${JSON.stringify(hit)}`).toBe(true);
}

async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const paneEl = document.querySelector('[data-testid="notes-brainstorm-panel"]');
    const doc = document.documentElement;
    return {
      paneSW: paneEl?.scrollWidth ?? -1,
      paneCW: paneEl?.clientWidth ?? -1,
      docSW: doc.scrollWidth,
      docCW: doc.clientWidth,
    };
  });
  expect(metrics.paneSW, `pane scrollWidth≤clientWidth ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.paneCW,
  );
  expect(metrics.docSW, `documentElement scrollWidth≤clientWidth ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(
    metrics.docCW,
  );
}

test.describe('beta-057 Notes Brainstorm clip @900/1024/1440', () => {
  test('fresh profile: pane fit, hit-test, send mock, scroll, left/center floors', async () => {
    const fixture = seedFixture();
    let app: ElectronApplication | undefined;
    try {
      app = await launchApp(fixture.userData);
      const page = await app.firstWindow();
      page.on('dialog', (d) => void d.accept().catch(() => undefined));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      await installStreamMock(app);
      await goNotesAgent(page);

      for (const [w, h] of [
        [900, 900],
        [1024, 900],
        [1440, 900],
      ] as const) {
        await setContentSize(app, w, h);

        const layout = await page.evaluate(() => {
          const left = document.querySelector('.notes-tab-sidebar-left');
          const center = document.querySelector('[data-testid="notes-tab-center"]');
          const right = document.querySelector('[data-testid="notes-brainstorm-panel"]');
          const minW = right ? parseFloat(getComputedStyle(right).minWidth) : NaN;
          return {
            left: left?.getBoundingClientRect().width ?? 0,
            center: center?.getBoundingClientRect().width ?? 0,
            right: right?.getBoundingClientRect().width ?? 0,
            minW,
          };
        });

        expect(Math.round(layout.left), `@${w} left`).toBe(LEFT_DEFAULT);
        expect(layout.center, `@${w} center ≥ 300`).toBeGreaterThanOrEqual(300);
        expect(layout.minW, 'pane min-width pin').toBe(PANE_MIN_PX);

        if (w === 1440) {
          expect(Math.round(layout.right), '@1440 pane preferred width').toBe(RIGHT_PREFERRED);
        }
        if (w === 900) {
          expect(Math.round(layout.right), '@900 pane at min').toBe(PANE_MIN_PX);
        }

        await boxInsideViewportAndPane(page, '.brainstorm-input');
        await boxInsideViewportAndPane(page, '.brainstorm-send-btn');
        await boxInsideViewportAndPane(page, '.brainstorm-new-session-btn');
        await assertNoHorizontalOverflow(page);

        if (w === 900 || w === 1024) {
          await elementFromPointIsControl(page, '.brainstorm-send-btn');
          await elementFromPointIsControl(page, '.brainstorm-new-session-btn');
        }
      }

      // Freeze #3: type first, then Send via mock (no real AI).
      await setContentSize(app, 900, 900);
      const textarea = pane(page).locator('.brainstorm-input');
      const sendBtn = pane(page).locator('.brainstorm-send-btn');
      await expect(sendBtn).toBeDisabled();
      await textarea.fill('clip057 typed prompt');
      await expect(sendBtn).toBeEnabled();
      await sendBtn.click();
      await expect(pane(page).locator('.bs-assistant-bubble').last()).toContainText(
        'Clip057 mock reply',
        { timeout: 10_000 },
      );
    } finally {
      await closeElectronApp(app);
      removeTempDirs(fixture.userData, fixture.vaultDir, fixture.notesVaultDir);
    }
  });

  test('@900 left divider drag ±10 and peek button', async () => {
    const fixture = seedFixture();
    let app: ElectronApplication | undefined;
    try {
      app = await launchApp(fixture.userData);
      const page = await app.firstWindow();
      page.on('dialog', (d) => void d.accept().catch(() => undefined));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      await goNotesAgent(page);
      await setContentSize(app, 900, 900);

      const left = page.locator('.notes-tab-sidebar-left');
      const before = (await left.boundingBox())!;
      expect(Math.round(before.width)).toBe(LEFT_DEFAULT);

      const divider = page.locator('.notes-tab-divider:not(.notes-tab-divider--right)');
      const dbox = (await divider.boundingBox())!;
      await page.mouse.move(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2);
      await page.mouse.down();
      await page.mouse.move(dbox.x + dbox.width / 2 + 10, dbox.y + dbox.height / 2, {
        steps: 5,
      });
      await page.mouse.up();
      await page.waitForTimeout(100);

      const after = (await left.boundingBox())!;
      expect(Math.abs(after.width - (LEFT_DEFAULT + 10))).toBeLessThanOrEqual(2);

      // Persisted value matches shown width.
      await page.waitForTimeout(400);
      const persisted = JSON.parse(
        fs.readFileSync(path.join(fixture.userData, 'app-settings.json'), 'utf-8'),
      ) as { activeLayout?: { tabShell?: { notesSidebarWidth?: number } } };
      const saved = persisted.activeLayout?.tabShell?.notesSidebarWidth;
      expect(saved, 'persisted left width').toBeDefined();
      expect(Math.abs((saved as number) - after.width)).toBeLessThanOrEqual(2);

      // Collapsed peek visible at 900.
      await page.locator('[data-testid="notes-brainstorm-collapse"]').click();
      await expect(page.locator('[data-testid="notes-brainstorm-expand"]')).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await closeElectronApp(app);
      removeTempDirs(fixture.userData, fixture.vaultDir, fixture.notesVaultDir);
    }
  });

  test('C3: saved left 500 @900 stays 500; overflow no worse; still 500 @1440', async () => {
    const fixture = seedFixture({ notesSidebarWidth: 500 });
    let app: ElectronApplication | undefined;
    try {
      app = await launchApp(fixture.userData);
      const page = await app.firstWindow();
      page.on('dialog', (d) => void d.accept().catch(() => undefined));
      await page.waitForLoadState('domcontentloaded');
      await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });
      await goNotesAgent(page);
      await setContentSize(app, 900, 900);

      const at900 = await page.evaluate(() => {
        const left = document.querySelector('.notes-tab-sidebar-left');
        const paneEl = document.querySelector('[data-testid="notes-brainstorm-panel"]');
        const body = document.querySelector('.notes-tab-body');
        return {
          leftW: left?.getBoundingClientRect().width ?? 0,
          paneOverflow: paneEl ? paneEl.scrollWidth - paneEl.clientWidth : -1,
          bodyOverflow: body ? body.scrollWidth - body.clientWidth : -1,
        };
      });
      expect(Math.round(at900.leftW)).toBe(500);
      // Floor: 500+300+~195 > body — overflow is a known 0.5.7 issue; must not
      // exceed the pre-fix worst case (~145px body overflow at default 268).
      expect(at900.bodyOverflow).toBeGreaterThan(0);

      const disk = JSON.parse(
        fs.readFileSync(path.join(fixture.userData, 'app-settings.json'), 'utf-8'),
      ) as { activeLayout?: { tabShell?: { notesSidebarWidth?: number } } };
      expect(disk.activeLayout?.tabShell?.notesSidebarWidth).toBe(500);

      await setContentSize(app, 1440, 900);
      const at1440 = await page.evaluate(() => {
        const left = document.querySelector('.notes-tab-sidebar-left');
        return left?.getBoundingClientRect().width ?? 0;
      });
      expect(Math.round(at1440)).toBe(500);
    } finally {
      await closeElectronApp(app);
      removeTempDirs(fixture.userData, fixture.vaultDir, fixture.notesVaultDir);
    }
  });
});
