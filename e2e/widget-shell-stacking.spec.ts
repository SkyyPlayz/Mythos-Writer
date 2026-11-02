// MW-059-S1b (Critic r4 FAIL 2): menus, popovers and dialogs render above every widget for left/right/top/bottom slot arrangements, unlocked and locked.
/**
 * widget-shell-stacking.spec.ts
 *
 * For each arrangement (each fills all four edges), opens: every widget menu,
 * the nav rail "Customize navigation" popover, the nav rail Stories popover,
 * the Story navigator context menu, the Settings dialog and the Keyboard
 * shortcuts dialog. Each must be the topmost element at its centre and at its
 * four corners (inset 4 px), checked with document.elementFromPoint.
 *
 * Uses only the S1b DOM contract (data-widget-* hosts, widget-menu testids) and
 * existing app testids — no dockview classes — so it also runs unchanged
 * against a fixed-slot fallback adapter. Runs on the beta bundle (widgetShell ON).
 *
 *   rm -rf out/ && npm run build:electron
 *   xvfb-run --auto-servernum npx playwright test e2e/widget-shell-stacking.spec.ts --reporter=list --workers=1
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';
import { createStoryFromNavAdd } from './helpers/newStoryModal';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';

// ── Beta bundle (widgetShell ON): build once, reuse; same helper in every widget-shell spec ──
const REPO_ROOT = path.resolve(__dirname, '..');
const STABLE_MAIN_JS = path.join(REPO_ROOT, 'out', 'main', 'main.js');
const BETA_OUT = path.join(REPO_ROOT, 'out', 'widget-shell-beta');
const BETA_MAIN_JS = path.join(BETA_OUT, 'main', 'main.js');
const BETA_LOCK = path.join(REPO_ROOT, 'out', '.widget-shell-beta.lock');

function betaBundleFresh(ignoreLock = false): boolean {
  if (!ignoreLock && fs.existsSync(BETA_LOCK)) return false;
  if (!fs.existsSync(BETA_MAIN_JS) || !fs.existsSync(path.join(BETA_OUT, 'renderer', 'index.html'))) return false;
  return !fs.existsSync(STABLE_MAIN_JS) || fs.statSync(BETA_MAIN_JS).mtimeMs >= fs.statSync(STABLE_MAIN_JS).mtimeMs;
}

async function ensureBetaBundle(): Promise<string> {
  const deadline = Date.now() + 300_000;
  while (!betaBundleFresh()) {
    if (Date.now() > deadline) throw new Error('widget-shell beta bundle: timed out waiting for the build');
    fs.mkdirSync(path.dirname(BETA_LOCK), { recursive: true });
    try {
      fs.mkdirSync(BETA_LOCK); // atomic: exactly one worker builds
    } catch {
      const lockAge = Date.now() - (fs.statSync(BETA_LOCK, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (lockAge > 300_000) fs.rmSync(BETA_LOCK, { recursive: true, force: true }); // crashed builder
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    try {
      if (!betaBundleFresh(true)) {
        const cli = path.join(REPO_ROOT, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
        const res = spawnSync(process.execPath, [cli, 'build', '--outDir', BETA_OUT], {
          cwd: REPO_ROOT,
          stdio: 'inherit',
          env: { ...process.env, VITE_MYTHOS_CHANNEL: 'beta', NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=4096' },
        });
        if (res.status !== 0) throw new Error(`widget-shell beta build failed (exit ${res.status ?? res.signal})`);
      }
    } finally {
      fs.rmSync(BETA_LOCK, { recursive: true, force: true });
    }
  }
  return BETA_MAIN_JS;
}

async function launchBeta(mainJs: string, userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [mainJs, `--user-data-dir=${userData}`, '--no-sandbox', '--force-prefers-reduced-motion', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message));
  await page.waitForLoadState('domcontentloaded');
  return page;
}
// ── end beta bundle helper ──

function seedProfile(userData: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    // rightSidebarVisible: GlobalRightSidebar (the Assistant widget's content)
    // only mounts once it is an explicit boolean (DesktopShell SKY-1686).
    JSON.stringify({ onboardingComplete: true, theme: 'dark', rightSidebarVisible: true }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

type Edge = 'left' | 'right' | 'top' | 'bottom';
const COPY_ID = 'leftSidebar:copy:2';
const WIDGET_IDS = ['navRail', 'leftSidebar', 'rightSidebar', COPY_ID] as const;
type WidgetId = (typeof WIDGET_IDS)[number];

/** Every arrangement puts a widget on each of the four edges. */
const ARRANGEMENTS: ReadonlyArray<{ name: string; edges: Record<WidgetId, Edge> }> = [
  { name: 'A', edges: { navRail: 'left', leftSidebar: 'top', rightSidebar: 'right', [COPY_ID]: 'bottom' } },
  { name: 'B', edges: { navRail: 'right', leftSidebar: 'bottom', rightSidebar: 'left', [COPY_ID]: 'top' } },
  { name: 'C', edges: { navRail: 'left', leftSidebar: 'right', rightSidebar: 'bottom', [COPY_ID]: 'top' } },
];

// ── DOM contract (frame) ──
const host = (page: Page, id: string) => page.locator(`[data-widget-id="${id}"]`);
const lockToggle = (page: Page) => page.getByTestId('widget-layout-lock-toggle');

async function setLocked(page: Page, locked: boolean): Promise<void> {
  const frame = page.getByTestId('widget-frame');
  if ((await frame.getAttribute('data-locked')) !== String(locked)) await lockToggle(page).click();
  await expect(frame).toHaveAttribute('data-locked', String(locked));
}

async function chooseMenuItem(page: Page, widgetId: string, item: string): Promise<void> {
  await page.getByTestId(`widget-menu-button-${widgetId}`).click();
  const menu = page.getByTestId('widget-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

async function arrange(page: Page, edges: Record<WidgetId, Edge>): Promise<void> {
  if ((await host(page, COPY_ID).count()) === 0) {
    await chooseMenuItem(page, 'leftSidebar', 'Duplicate');
    await expect(host(page, COPY_ID)).toHaveCount(1);
  }
  for (const id of WIDGET_IDS) {
    if ((await host(page, id).getAttribute('data-widget-edge')) !== edges[id]) {
      await chooseMenuItem(page, id, `Move to ${edges[id]}`);
    }
    await expect(host(page, id)).toHaveAttribute('data-widget-edge', edges[id]);
  }
}

interface PointHit { x: number; y: number; ok: boolean; hit: string; widgetBelow: string }

/**
 * Asserts the overlay is topmost at its centre and its corners (inset 4 px, or further on a rounded
 * corner so the point lies inside the painted curve: a point (d, d) from a corner of radius r is inside
 * only when d >= r(1 - 1/sqrt 2); at r = 14 px a 4 px inset is 0.14 px outside and hits what is beneath).
 * Corners outside the viewport are skipped; the centre never is.
 */
async function expectOnTop(overlay: Locator, label: string): Promise<void> {
  await expect(overlay, `${label} visible`).toBeVisible();
  const report = await overlay.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inset = (radius: string) => Math.max(4, Math.ceil((parseFloat(radius) || 0) * (1 - Math.SQRT1_2)) + 1);
    const tl = inset(cs.borderTopLeftRadius);
    const tr = inset(cs.borderTopRightRadius);
    const bl = inset(cs.borderBottomLeftRadius);
    const br = inset(cs.borderBottomRightRadius);
    const pts: Array<[number, number, boolean]> = [
      [r.left + r.width / 2, r.top + r.height / 2, true],
      [r.left + tl, r.top + tl, false],
      [r.right - tr, r.top + tr, false],
      [r.left + bl, r.bottom - bl, false],
      [r.right - br, r.bottom - br, false],
    ];
    const describe = (n: Element | null) => {
      if (!n) return 'null';
      const id = n.id ? `#${n.id}` : '';
      const tid = n.getAttribute('data-testid');
      const cls = typeof n.className === 'string' && n.className ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      return `${n.tagName.toLowerCase()}${id}${tid ? `[data-testid=${tid}]` : ''}${cls}`;
    };
    const hits: PointHit[] = [];
    let centreInView = true;
    for (const [x, y, isCentre] of pts) {
      const inView = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
      if (!inView) {
        if (isCentre) centreInView = false;
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      const below = document.elementsFromPoint(x, y).find((n) => n.hasAttribute('data-widget-id'));
      hits.push({
        x: Math.round(x),
        y: Math.round(y),
        ok: !!hit && (hit === el || el.contains(hit)),
        hit: describe(hit),
        widgetBelow: below?.getAttribute('data-widget-id') ?? '',
      });
    }
    return { size: { w: Math.round(r.width), h: Math.round(r.height) }, centreInView, hits };
  });
  console.log(`[stacking] ${label} ${JSON.stringify(report)}`);
  expect(report.size.w, `${label} has width`).toBeGreaterThan(8);
  expect(report.size.h, `${label} has height`).toBeGreaterThan(8);
  expect(report.centreInView, `${label} centre inside the window`).toBe(true);
  const covered = report.hits.filter((h) => !h.ok);
  expect(covered, `${label} covered at: ${JSON.stringify(covered)}`).toEqual([]);
}

async function blurAll(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function checkWidgetMenus(page: Page, label: string): Promise<void> {
  for (const id of WIDGET_IDS) {
    const button = page.getByTestId(`widget-menu-button-${id}`);
    await button.click();
    const menu = page.getByTestId('widget-menu');
    await expectOnTop(menu, `${label} widget menu ${id}`);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
}

async function checkCustomizeNavPopover(page: Page, label: string): Promise<void> {
  await host(page, 'navRail').getByTestId('nav-rail-edit-btn').click();
  const pop = page.getByTestId('nav-rail-edit');
  await expectOnTop(pop, `${label} nav rail customize popover`);
  await page.keyboard.press('Escape');
  if (await pop.count()) await page.getByTestId('nav-rail-edit-backdrop').click({ position: { x: 5, y: 5 }, force: true });
  await expect(pop).toHaveCount(0);
}

async function checkStoriesPopover(page: Page, label: string): Promise<void> {
  await clickStoryNav(page); // Story active, no popover
  await host(page, 'navRail').locator('button[aria-label="Story Writer"]').click(); // re-click opens the popover
  const pop = page.getByTestId('nav-rail-stories');
  await expectOnTop(pop, `${label} nav rail stories popover`);
  await page.getByTestId('nav-rail-stories-backdrop').click({ position: { x: 5, y: 5 }, force: true });
  await expect(pop).toHaveCount(0);
}

async function checkNavigatorContextMenu(page: Page, label: string): Promise<void> {
  await host(page, 'leftSidebar').locator('.nav-story-row').first().click({ button: 'right' });
  const menu = page.getByTestId('story-navigator-context-menu');
  await expectOnTop(menu, `${label} story navigator context menu`);
  // Escape closes it when the menu holds focus; otherwise its outside-mousedown dismissal.
  await page.keyboard.press('Escape');
  if (await menu.count()) {
    const centre = await host(page, 'center').boundingBox();
    if (!centre) throw new Error('center widget has no box');
    await page.mouse.click(centre.x + centre.width / 2, centre.y + centre.height - 12);
  }
  await expect(menu).toHaveCount(0);
}

async function checkSettingsDialog(page: Page, label: string): Promise<void> {
  await blurAll(page);
  await page.keyboard.press('ControlOrMeta+Comma');
  const dialog = page.getByRole('dialog', { name: /settings/i }).first();
  await expectOnTop(dialog, `${label} settings dialog`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /settings/i })).toHaveCount(0);
}

async function checkShortcutsDialog(page: Page, label: string): Promise<void> {
  await blurAll(page);
  await page.keyboard.press('ControlOrMeta+Slash');
  const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i }).first();
  await expectOnTop(dialog, `${label} keyboard shortcuts dialog`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toHaveCount(0);
}

async function checkAppOverlays(page: Page, label: string): Promise<void> {
  await checkCustomizeNavPopover(page, label);
  await checkStoriesPopover(page, label);
  await checkNavigatorContextMenu(page, label);
  await checkSettingsDialog(page, label);
  await checkShortcutsDialog(page, label);
}

test.describe('MW-059-S1b widget shell: overlays stack above widgets in every slot', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let tempRoot: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    const mainJs = await ensureBetaBundle();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-widget-stack-'));
    const userData = path.join(tempRoot, 'userData');
    seedProfile(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchBeta(mainJs, userData);
    page = await firstWindow(app);
    await expect(page.getByTestId('widget-frame')).toBeVisible({ timeout: 30_000 });
    // A story gives the navigator a row to right-click (created by clicking, not seeded).
    await clickStoryNav(page);
    await createStoryFromNavAdd(page);
    await expect(host(page, 'leftSidebar').locator('.nav-story-row').first()).toBeVisible({ timeout: 15_000 });
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tempRoot);
  });

  for (const arrangement of ARRANGEMENTS) {
    test(`arrangement ${arrangement.name}: ${JSON.stringify(arrangement.edges)}`, async () => {
      await setLocked(page, false);
      await arrange(page, arrangement.edges);
      await checkWidgetMenus(page, `${arrangement.name}/unlocked`);
      await checkAppOverlays(page, `${arrangement.name}/unlocked`);

      await setLocked(page, true);
      for (const id of WIDGET_IDS) {
        await expect(host(page, id)).toHaveAttribute('data-widget-edge', arrangement.edges[id]);
      }
      await checkAppOverlays(page, `${arrangement.name}/locked`);
    });
  }
});
