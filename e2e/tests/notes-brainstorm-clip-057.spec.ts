/**
 * notes-brainstorm-clip-057.spec.ts — PLAN-BRAINSTORM-CLIP-057 r2
 *
 * Notes tab Brainstorm right pane must fit at 900/940/1024/1440 with real
 * BrowserWindow setContentSize (not page viewport only). Freeze conditions:
 *   1. setContentSize 900/940/1024/1440×900
 *   2. elementFromPoint on Send AND New session centers → button/child
 *   3. type then mouse.click Send; body scrollLeft===0; stubbed stream:start
 *   4. scrollWidth ≤ clientWidth on right pane, documentElement, and body @900/1024
 *   5. no saved right width; saved-500-left stays 500
 *   6. @940: preset chip + header actions inside pane (pc-chrome wrap ≤273)
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
/** STEP 0 packaged: bodyCW@900=769 → 769−268−4−300−4 = 193; min 190 (+3 slack). */
const PANE_MIN_PX = 190;
/** N1: measured pc-chrome wrap threshold — one-row fits from 273 (RED if CSS back to 228). */
const PC_CHROME_WRAP_MAX_PX = 273;
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

/** Shield item 6: track mkdtemp dirs for afterEach rmSync. */
const clip057TempDirs: string[] = [];

function seedFixture(opts: { notesSidebarWidth?: number } = {}): Fixture {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-clip057-ud-'));
  const vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-clip057-vault-'));
  const notesVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-clip057-notes-'));
  clip057TempDirs.push(userData, vaultDir, notesVaultDir);

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

/** Prefreeze F2: every visible header/tab control inside pane + viewport + hit-test. */
async function assertAllVisibleHeaderControlsHitTestable(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const paneEl = document.querySelector('[data-testid="notes-brainstorm-panel"]');
    if (!paneEl) return { ok: false, failures: ['missing pane'], checked: 0 };
    const pr = paneEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const roots = [
      paneEl.querySelector('.notes-right-sidebar-header'),
      paneEl.querySelector('.pc-header.brainstorm-header--compact'),
    ].filter(Boolean) as HTMLElement[];
    const buttons: HTMLElement[] = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        // Skip display:none via offsetParent when not fixed
        if (style.opacity === '0') continue;
        buttons.push(el);
      }
    }
    const failures: string[] = [];
    for (const el of buttons) {
      const r = el.getBoundingClientRect();
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('data-testid') ||
        el.className.toString().slice(0, 48) ||
        el.tagName;
      const insidePane =
        r.left >= pr.left - 1 &&
        r.right <= pr.right + 1 &&
        r.top >= pr.top - 1 &&
        r.bottom <= pr.bottom + 1;
      const insideVp =
        r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const hit = !!(top && (top === el || el.contains(top)));
      if (!insidePane || !insideVp || !hit) {
        failures.push(
          `${label}: pane=${insidePane} vp=${insideVp} hit=${hit} top=${top ? String((top as HTMLElement).className || top.tagName).slice(0, 40) : null}`,
        );
      }
    }
    return { ok: failures.length === 0, failures, checked: buttons.length };
  });
  expect(report.checked, 'expected visible header/tab buttons').toBeGreaterThan(0);
  expect(report.ok, `F2 header hit-tests: ${JSON.stringify(report.failures)}`).toBe(true);
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

/** P4: notes-tab-body must not horizontally overflow at mid widths. */
async function assertBodyNoHorizontalOverflow(page: Page): Promise<void> {
  const m = await page.evaluate(() => {
    const body = document.querySelector('.notes-tab-body');
    return {
      sw: body?.scrollWidth ?? -1,
      cw: body?.clientWidth ?? -1,
      scrollLeft: body?.scrollLeft ?? -1,
    };
  });
  expect(m.sw, `P4 body scrollWidth≤clientWidth ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.cw);
}

/**
 * N1 @940: preset chip + every visible header/tab control inside pane; wrap
 * query engaged (actions flex-wrap). RED if pc-chrome threshold stays 228.
 */
async function assertN1PresetAndActionsAt940(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const paneEl = document.querySelector('[data-testid="notes-brainstorm-panel"]') as HTMLElement | null;
    const host = paneEl?.querySelector('.pc-header-host') as HTMLElement | null;
    const header = paneEl?.querySelector(
      '.pc-header.brainstorm-header--compact',
    ) as HTMLElement | null;
    const actions = header?.querySelector('.pc-header-actions') as HTMLElement | null;
    const preset = header?.querySelector('.brainstorm-header-preset') as HTMLElement | null;
    if (!paneEl || !header || !actions) {
      return { ok: false, reason: 'missing chrome', chromeW: 0, wrap: '', failures: [] as string[] };
    }
    const chromeW = host?.clientWidth ?? header.clientWidth;
    const acs = getComputedStyle(actions);
    const pr = paneEl.getBoundingClientRect();
    const failures: string[] = [];
    const check = (el: HTMLElement | null, label: string) => {
      if (!el) {
        failures.push(`missing ${label}`);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) {
        failures.push(`${label} zero-size`);
        return;
      }
      const inside =
        r.left >= pr.left - 1 &&
        r.right <= pr.right + 1 &&
        r.top >= pr.top - 1 &&
        r.bottom <= pr.bottom + 1;
      if (!inside) failures.push(`${label} outside pane l=${r.left} r=${r.right} paneR=${pr.right}`);
    };
    check(preset, 'preset');
    for (const el of header.querySelectorAll('button')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      const label =
        el.getAttribute('aria-label') ||
        el.getAttribute('data-testid') ||
        el.className.toString().slice(0, 40);
      check(el, label);
    }
    return {
      ok: failures.length === 0,
      reason: '',
      chromeW,
      wrap: acs.flexWrap,
      flex: `${acs.flexGrow} ${acs.flexShrink} ${acs.flexBasis}`,
      failures,
    };
  });
  expect(report.ok, `N1 @940 controls in pane: ${JSON.stringify(report)}`).toBe(true);
  // Wrap query must be active at Notes @940 chrome width — threshold 228 leaves flex-wrap nowrap.
  expect(report.wrap, `N1 wrap engaged @940 chrome=${report.chromeW}`).toBe('wrap');
  expect(report.chromeW, 'N1 chrome width under wrap max').toBeLessThanOrEqual(PC_CHROME_WRAP_MAX_PX);
  expect(report.chromeW, 'N1 chrome wider than old 228 threshold').toBeGreaterThan(228);
}

/** Prefreeze F1: at 1440, tab/header computed styles match main (unconditional shrink RED). */
async function assertMainTabStylesAt1440(page: Page): Promise<void> {
  const styles = await page.evaluate(() => {
    const tab = document.querySelector('.notes-right-tab') as HTMLElement | null;
    const header = document.querySelector('.notes-right-sidebar-header') as HTMLElement | null;
    if (!tab || !header) return null;
    const t = getComputedStyle(tab);
    const h = getComputedStyle(header);
    return {
      fontSize: t.fontSize,
      paddingTop: t.paddingTop,
      paddingRight: t.paddingRight,
      paddingBottom: t.paddingBottom,
      paddingLeft: t.paddingLeft,
      letterSpacing: t.letterSpacing,
      gap: h.gap,
    };
  });
  expect(styles, 'tab + header present').toBeTruthy();
  // Main values: font-size 0.72rem, padding 3px 9px, letter-spacing 0.03em (of font-size), no gap.
  // Unconditional tip shrink used 0.68rem / 6px / 0.02em / gap 4px — those must RED.
  const rootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const fontPx = parseFloat(styles!.fontSize);
  const letterPx = parseFloat(styles!.letterSpacing);
  expect(fontPx, 'F1 font-size = main 0.72rem').toBeCloseTo(0.72 * rootPx, 2);
  expect(fontPx, 'F1 not tip-shrink 0.68rem').not.toBeCloseTo(0.68 * rootPx, 2);
  expect(styles!.paddingTop).toBe('3px');
  expect(styles!.paddingBottom).toBe('3px');
  expect(styles!.paddingLeft).toBe('9px');
  expect(styles!.paddingRight).toBe('9px');
  expect(letterPx, 'F1 letter-spacing = main 0.03em').toBeCloseTo(0.03 * fontPx, 3);
  expect(
    styles!.gap === 'normal' || styles!.gap === '0px',
    `F1 header gap (main has none): ${styles!.gap}`,
  ).toBe(true);
}

/**
 * Prefreeze F2 @1440: pane is still 340 (preferred) — main's compact header is
 * the 2-row ≤400 pack (~107px), with PanelChrome `flex: 0 0 auto; overflow: visible`.
 * Pin that we did not reintroduce `flex: 0 1 auto; overflow: hidden` at this width.
 */
async function assertMainLikeHeaderChromeAt1440(page: Page): Promise<void> {
  const row = await page.evaluate(() => {
    const header = document.querySelector(
      '[data-testid="notes-brainstorm-panel"] .pc-header.brainstorm-header--compact',
    ) as HTMLElement | null;
    const actions = header?.querySelector('.pc-header-actions') as HTMLElement | null;
    if (!header || !actions) return { ok: false, reason: 'missing' };
    const cs = getComputedStyle(actions);
    const hr = header.getBoundingClientRect();
    return {
      height: hr.height,
      flexGrow: cs.flexGrow,
      flexShrink: cs.flexShrink,
      flexBasis: cs.flexBasis,
      overflow: cs.overflow,
      overflowX: cs.overflowX,
    };
  });
  // Main natural/340 compact height band (notes-parity MAIN_COMPACT_H.natural = 107).
  expect(Math.abs(row.height - 107), `F2 header height @1440≈main 107: ${JSON.stringify(row)}`).toBeLessThanOrEqual(4);
  expect(row.flexGrow, 'F2 actions flex-grow stays 0 (PanelChrome)').toBe('0');
  expect(row.flexShrink, 'F2 actions flex-shrink stays 0 (not 0 1 auto)').toBe('0');
  expect(row.overflow === 'visible' || row.overflowX === 'visible', `F2 overflow visible: ${JSON.stringify(row)}`).toBe(
    true,
  );
}

test.describe('beta-057 Notes Brainstorm clip @900/940/1024/1440', () => {
  test.afterEach(() => {
    while (clip057TempDirs.length > 0) {
      const dir = clip057TempDirs.pop();
      if (!dir) continue;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort — leftover tmp dirs must not fail the suite */
      }
    }
  });

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
        [940, 900],
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
            bodyCW: document.querySelector('.notes-tab-body')?.clientWidth ?? 0,
          };
        });

        expect(Math.round(layout.left), `@${w} left`).toBe(LEFT_DEFAULT);
        expect(layout.center, `@${w} center ≥ 300`).toBeGreaterThanOrEqual(300);
        expect(layout.minW, 'pane min-width pin').toBe(PANE_MIN_PX);

        if (w === 1440) {
          expect(Math.round(layout.right), '@1440 pane preferred width').toBe(RIGHT_PREFERRED);
          await assertMainTabStylesAt1440(page);
          await assertMainLikeHeaderChromeAt1440(page);
        }
        if (w === 900) {
          // Available = bodyCW − 268 − 4 − 300 − 4 (≈193 @769); min 190 is the floor, not the fill.
          const available = Math.round(layout.bodyCW) - LEFT_DEFAULT - 4 - 300 - 4;
          expect(Math.round(layout.right), `@900 pane ≈ available ${available}`).toBe(available);
          expect(Math.round(layout.right), '@900 pane ≥ min').toBeGreaterThanOrEqual(PANE_MIN_PX);
          expect(Math.round(layout.bodyCW), '@900 body CW packaged ≈769').toBeGreaterThanOrEqual(760);
          expect(Math.round(layout.bodyCW), '@900 body CW packaged ≈769').toBeLessThanOrEqual(775);
        }
        if (w === 940) {
          await assertN1PresetAndActionsAt940(page);
        }

        await boxInsideViewportAndPane(page, '.brainstorm-input');
        await boxInsideViewportAndPane(page, '.brainstorm-send-btn');
        await boxInsideViewportAndPane(page, '.brainstorm-new-session-btn');
        await assertNoHorizontalOverflow(page);
        await assertAllVisibleHeaderControlsHitTestable(page);

        if (w === 900 || w === 1024) {
          await elementFromPointIsControl(page, '.brainstorm-send-btn');
          await elementFromPointIsControl(page, '.brainstorm-new-session-btn');
          await assertBodyNoHorizontalOverflow(page);
        }
      }

      // P3 / Freeze #3: type, mouse.click Send center, body scrollLeft===0.
      await setContentSize(app, 900, 900);
      const textarea = pane(page).locator('.brainstorm-input');
      const sendBtn = pane(page).locator('.brainstorm-send-btn');
      await expect(sendBtn).toBeDisabled();
      await textarea.fill('clip057 typed prompt');
      await expect(sendBtn).toBeEnabled();
      const sendBox = (await sendBtn.boundingBox())!;
      await page.mouse.click(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);
      const scrollLeft = await page.evaluate(() => {
        const body = document.querySelector('.notes-tab-body');
        return body?.scrollLeft ?? -1;
      });
      expect(scrollLeft, 'P3 body scrollLeft===0 after Send mouse.click').toBe(0);
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
          bodyCW: body?.clientWidth ?? 0,
        };
      });
      expect(Math.round(at900.leftW)).toBe(500);
      // Prefreeze F3: overflow > 0, and ≤ main's layout overflow
      // (500+4+300+4+340 − clientWidth). Tip ideal ≈ 500+4+300+4+190 − CW (±2).
      expect(at900.bodyOverflow).toBeGreaterThan(0);
      const mainUpper = 500 + 4 + 300 + 4 + 340 - at900.bodyCW;
      const tipIdeal = 500 + 4 + 300 + 4 + PANE_MIN_PX - at900.bodyCW;
      expect(
        at900.bodyOverflow,
        `F3 bodyOverflow ≤ main math (${mainUpper}); got ${at900.bodyOverflow} (CW=${at900.bodyCW})`,
      ).toBeLessThanOrEqual(mainUpper + 2);
      expect(
        Math.abs(at900.bodyOverflow - tipIdeal),
        `F3 tip overflow ≈ ideal ${tipIdeal} ±2 (got ${at900.bodyOverflow})`,
      ).toBeLessThanOrEqual(2);

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
