// MW-059-S1b G0 tests 6 + 7: typing 200 keys while dragging the navigator/center sash drops none, keeps focus and the editor mount, keeps resize p95 ≤ 2× idle p95; axe + tab order on the frame.
/**
 * widget-shell-resize-keys.spec.ts
 *
 * Runs on Linux CI and on native Windows (`notes-windows`, via
 * test:e2e:notes-unicode-names): no xvfb assumptions, paths via `path`.
 * Beta bundle (widgetShell ON); the layout is never seeded.
 *
 * Method (POC #1754 test 6): measure idle frame times for 2 s with the editor
 * focused, then press the pointer on the sash between the Story navigator and
 * the center and, while dragging, alternate a few-px pointer move with one
 * typed key, 200 times. Prints one `[resize-gate] {json}` line per frame state.
 *
 *   rm -rf out/ && npm run build:electron
 *   xvfb-run --auto-servernum npx playwright test e2e/widget-shell-resize-keys.spec.ts --reporter=list --workers=1
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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

const AXE_SOURCE = fs.readFileSync(path.join(REPO_ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const KEYS = 200;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const EDITOR_SEL = '[data-widget-id="center"] .ProseMirror';

function seedProfile(userData: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

const host = (page: Page, id: string) => page.locator(`[data-widget-id="${id}"]`);

// ── The one dockview-aware selector in this spec. A fixed-slot fallback adapter swaps it here. ──
const SASH_SELECTOR = '.dv-sash';

/** Centre point of the vertical sash on the boundary between the Story navigator and the center. */
async function sashBetweenNavigatorAndCenter(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate((sashSel) => {
    const nav = document.querySelector('[data-widget-id="leftSidebar"]')?.getBoundingClientRect();
    const centre = document.querySelector('[data-widget-id="center"]')?.getBoundingClientRect();
    if (!nav || !centre) return null;
    const boundary = (nav.right + centre.left) / 2;
    let best: { x: number; y: number; d: number } | null = null;
    document.querySelectorAll(sashSel).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= r.width) return; // vertical, rendered sashes only
      const top = Math.max(r.top, centre.top);
      const bottom = Math.min(r.bottom, centre.bottom);
      if (bottom - top < 40) return; // must run alongside the center
      const x = r.left + r.width / 2;
      const d = Math.abs(x - boundary);
      if (d <= 12 && (!best || d < best.d)) best = { x, y: top + Math.min(160, (bottom - top) / 2), d };
    });
    return best as { x: number; y: number; d: number } | null;
  }, SASH_SELECTOR);
  if (!point) throw new Error('no sash between the Story navigator and the center');
  return { x: point.x, y: point.y };
}

interface FrameStats { n: number; p50: number; p95: number; max: number }

function frameStats(samples: number[]): FrameStats {
  const usable = samples.slice(1).filter((n) => Number.isFinite(n) && n >= 0);
  const sorted = [...usable].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { n: usable.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? 0) };
}

async function startFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __rkFrames?: number[]; __rkRaf?: number };
    if (w.__rkRaf) cancelAnimationFrame(w.__rkRaf);
    w.__rkFrames = [];
    let last = performance.now();
    const loop = (now: number) => {
      w.__rkFrames?.push(now - last);
      last = now;
      w.__rkRaf = requestAnimationFrame(loop);
    };
    w.__rkRaf = requestAnimationFrame(loop);
  });
}

async function stopFrames(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __rkFrames?: number[]; __rkRaf?: number };
    if (w.__rkRaf) cancelAnimationFrame(w.__rkRaf);
    w.__rkRaf = undefined;
    return w.__rkFrames ?? [];
  });
}

async function focusInTaggedEditor(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ed = (window as unknown as { __rkEditor?: HTMLElement }).__rkEditor;
    const a = document.activeElement;
    return !!ed && !!a && ed.contains(a);
  });
}

async function editorIdentity(page: Page): Promise<{ sameNode: boolean; text: string }> {
  return page.evaluate((sel) => {
    const ed = (window as unknown as { __rkEditor?: HTMLElement }).__rkEditor;
    return { sameNode: !!ed && ed.isConnected && document.querySelector(sel) === ed, text: ed?.textContent ?? '' };
  }, EDITOR_SEL);
}

async function navigatorWidth(page: Page): Promise<number> {
  return (await host(page, 'leftSidebar').boundingBox())?.width ?? 0;
}

async function resizeWhileTyping(page: Page, label: 'locked' | 'unlocked'): Promise<void> {
  const editor = page.locator(EDITOR_SEL);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  const prefix = ` ${label}-start:`;
  await page.keyboard.type(prefix);

  await startFrames(page);
  await page.waitForTimeout(2_000); // idle sampling window
  const idle = frameStats(await stopFrames(page));

  const sash = await sashBetweenNavigatorAndCenter(page);
  const widthBefore = await navigatorWidth(page);
  let focusMisses = 0;
  let typed = '';

  await startFrames(page);
  await page.mouse.move(sash.x, sash.y);
  await page.mouse.down();
  if (!(await focusInTaggedEditor(page))) focusMisses += 1;
  for (let i = 0; i < KEYS; i++) {
    const wobble = 30 + ((i % 10) - 5) * 3; // net drag ≈ +30 px with a few-px back-and-forth
    await page.mouse.move(sash.x + wobble, sash.y);
    const ch = ALPHABET[i % ALPHABET.length];
    await page.keyboard.type(ch);
    typed += ch;
    if (!(await focusInTaggedEditor(page))) focusMisses += 1;
  }
  await page.mouse.up();
  const resize = frameStats(await stopFrames(page));
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const focusAfterPointerUp = await focusInTaggedEditor(page);
  const widthAfter = await navigatorWidth(page);

  const ident = await editorIdentity(page);
  const at = ident.text.lastIndexOf(prefix);
  const landed = at >= 0 ? ident.text.slice(at + prefix.length) : '';
  let inOrder = 0;
  while (inOrder < typed.length && landed[inOrder] === typed[inOrder]) inOrder += 1;

  const report = {
    label,
    platform: process.platform,
    keys: { typed: typed.length, landedInOrder: inOrder, dropped: typed.length - inOrder, extra: Math.max(0, landed.length - typed.length) },
    focus: { missesDuringDrag: focusMisses, afterPointerUp: focusAfterPointerUp },
    mounts: ident.sameNode ? 1 : 2,
    navigatorWidth: { before: Math.round(widthBefore), after: Math.round(widthAfter) },
    idle,
    resize,
    p95Limit: Math.round(idle.p95 * 2 * 100) / 100,
    p95Pass: resize.p95 <= idle.p95 * 2,
  };
  console.log(`[resize-gate] ${JSON.stringify(report)}`);
  await test.info().attach(`resize-gate-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

  expect(idle.n, 'idle frames sampled').toBeGreaterThan(20);
  expect(resize.n, 'resize frames sampled').toBeGreaterThan(20);
  expect(Math.abs(widthAfter - widthBefore), 'the drag resized the Story navigator').toBeGreaterThan(5);
  expect(landed, 'all 200 keys landed in order (0 dropped)').toBe(typed);
  expect(focusMisses, 'focus stayed in the editor during the drag').toBe(0);
  expect(focusAfterPointerUp, 'focus in the editor after pointerup').toBe(true);
  expect(ident.sameNode, 'same .ProseMirror node (1 mount)').toBe(true);
  expect(resize.p95, `resize p95 ${resize.p95} ms ≤ 2 × idle p95 ${idle.p95} ms`).toBeLessThanOrEqual(idle.p95 * 2);
}

interface AxeViolation { id: string; impact: string | null; help: string; nodes: Array<{ target: unknown }> }

/** In-page axe (Electron refuses the extra page @axe-core/playwright opens): frame-wide + S1b widget chrome only. */
async function runAxe(page: Page): Promise<{ all: AxeViolation[]; chrome: AxeViolation[] }> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    type Run = (ctx: unknown, opts?: unknown) => Promise<{ violations: AxeViolation[] }>;
    const axe = (window as unknown as { axe: { run: Run } }).axe;
    const all = (await axe.run({ include: [['[data-testid="widget-frame"]']] })).violations;
    const marks: Element[] = [];
    document.querySelectorAll('[data-widget-tab]').forEach((el) => { const t = el.closest('[role="tab"]'); if (t) marks.push(t); });
    document.querySelectorAll('[data-testid^="widget-menu"], [data-testid="widget-layout-lock-toggle"]').forEach((el) => marks.push(el));
    marks.forEach((el) => el.setAttribute('data-s1b-axe-chrome', ''));
    try {
      const chrome = marks.length ? (await axe.run({ include: [['[data-s1b-axe-chrome]']] })).violations : [];
      return { all, chrome };
    } finally {
      marks.forEach((el) => el.removeAttribute('data-s1b-axe-chrome'));
    }
  });
}

/**
 * Pre-existing app-content violations, outside the widget chrome. The flag-off (stable) shell shows
 * exactly these rule + node pairs in the same state: axe on `.desktop-shell__body` of `out/main/main.js`
 * with a scene open and the Assistant shown (9 rules there; the 9th, an unnamed `.tiptap` editor, is
 * fixed by S1b's "Writing editor" name). They belong to components S1b does not own, so they are not
 * fixed in this slice. Matching is per rule AND per node, so any other violation of any impact anywhere
 * in the frame, or one of these rules on a new node, still fails.
 */
const PRE_EXISTING_APP_VIOLATIONS: ReadonlyArray<{ rule: string; node: RegExp; owner: string }> = [
  { rule: 'aria-allowed-role', node: /(?:^|[\s>])\.msv-scope-title$/, owner: 'story/TitleRow.tsx' },
  { rule: 'aria-progressbar-name', node: /(?:^|[\s>])\.lr-progress-bar$/, owner: 'LeftRail.tsx' },
  { rule: 'aria-required-attr', node: /(?:^|[\s>])\.msv-edge--[lr]$/, owner: 'story/ManuscriptView.tsx' },
  { rule: 'aria-required-children', node: /(?:^|[\s>])\.wtb-root$/, owner: 'WorkspaceTabBar.tsx' },
  { rule: 'aria-required-parent', node: /(?:^|[\s>])(?:\.ahp-tab--active|button\[data-testid="ahp-tab-[a-z-]+"\])$/, owner: 'AgentHubPanel.tsx' },
  { rule: 'aria-valid-attr-value', node: /(?:^|[\s>])#workspace-tab-[0-9a-f-]+$/, owner: 'WorkspaceTabBar.tsx' },
  { rule: 'label-content-name-mismatch', node: /(?:^|[\s>])(?:\.nav-rail__vault-tile|\.nav-scene-row|button\[data-testid="msv-block-ordered"\])$/, owner: 'AppNavRail.tsx, StoryNavigator.tsx, story/ManuscriptView.tsx' },
  { rule: 'nested-interactive', node: /(?:^|[\s>])\.nav-scene-row$/, owner: 'StoryNavigator.tsx' },
  // aria-label "Page setup" vs visible "<n>px" readout; same markup on stable, where axe reports it only
  // once the narrower center (after the sash drags here) brings the readout into its visible-text check.
  { rule: 'label-content-name-mismatch', node: /(?:^|[\s>])\.msv-page-setup-btn$/, owner: 'story/ManuscriptView.tsx' },
];

/** Every violation node that is not one of the pre-existing app-content pairs above. */
function newViolations(all: AxeViolation[]): Array<{ id: string; impact: string | null; node: string }> {
  const out: Array<{ id: string; impact: string | null; node: string }> = [];
  for (const v of all) {
    for (const n of v.nodes) {
      const node = Array.isArray(n.target) ? n.target.join(' ') : String(n.target);
      const known = PRE_EXISTING_APP_VIOLATIONS.some((k) => k.rule === v.id && k.node.test(node));
      if (!known) out.push({ id: v.id, impact: v.impact, node });
    }
  }
  return out;
}

function summarize(v: AxeViolation[]): string {
  return v.map((x) => `${x.id}:${x.impact}:${x.nodes.length}`).join(', ') || 'none';
}

async function expectAxeClean(page: Page, label: string): Promise<void> {
  const { all, chrome } = await runAxe(page);
  const toJson = (v: AxeViolation[]) => v.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.map((n) => n.target) }));
  console.log(`[axe] ${label} frame=${summarize(all)} chrome=${summarize(chrome)}`);
  await test.info().attach(`axe-${label}.json`, { body: JSON.stringify({ label, all: toJson(all), chrome: toJson(chrome) }, null, 2), contentType: 'application/json' });
  const fresh = newViolations(all);
  expect(fresh, `${label}: axe violations on the frame beyond the pre-existing app content: ${JSON.stringify(fresh)}`).toEqual([]);
  expect(chrome, `${label}: axe violations on widget chrome: ${summarize(chrome)}`).toEqual([]);
}

/** Starts on the lock toggle (nav rail footer) and records it plus every Tab stop after it, up to `max` presses. */
async function tabStops(page: Page, max = 250): Promise<string[]> {
  await page.getByTestId('widget-layout-lock-toggle').focus();
  const stops: string[] = [];
  for (let i = 0; i <= max; i++) {
    if (i > 0) await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return 'body';
      const tab = el.getAttribute('role') === 'tab' ? el.querySelector('[data-widget-tab]')?.getAttribute('data-widget-tab') : null;
      if (tab) return `widget-tab:${tab}`;
      const tid = el.getAttribute('data-testid');
      if (tid) return `testid:${tid}`;
      if (el.classList.contains('ProseMirror')) return 'editor';
      return `${el.getAttribute('role') ?? el.tagName.toLowerCase()}:${el.getAttribute('aria-label') ?? ''}`;
    }));
  }
  return stops;
}

test.describe('MW-059-S1b widget shell: resize while typing (G0 tests 6 + 7)', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let tempRoot: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    const mainJs = await ensureBetaBundle();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-widget-resize-'));
    const userData = path.join(tempRoot, 'userData');
    seedProfile(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchBeta(mainJs, userData);
    page = await firstWindow(app);
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      win?.setContentSize(1440, 900);
    });
    const frame = page.getByTestId('widget-frame');
    await expect(frame).toBeVisible({ timeout: 30_000 });

    // Open a scene by clicking (fresh profile → navigator + → scaffolded scene).
    await clickStoryNav(page);
    await createStoryFromNavAdd(page);
    await host(page, 'leftSidebar').locator('.nav-scene-row').first().click();
    const editor = page.locator(EDITOR_SEL);
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toHaveAttribute('aria-label', 'Writing editor');
    await page.evaluate((sel) => {
      (window as unknown as { __rkEditor?: Element | null }).__rkEditor = document.querySelector(sel);
    }, EDITOR_SEL);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tempRoot);
  });

  test('locked frame: 200 keys while dragging the navigator sash — 0 dropped, focus held, 1 mount, p95 ≤ 2× idle', async () => {
    await expect(page.getByTestId('widget-frame')).toHaveAttribute('data-locked', 'true');
    await resizeWhileTyping(page, 'locked');
  });

  test('unlocked frame: 200 keys while dragging the navigator sash — 0 dropped, focus held, 1 mount, p95 ≤ 2× idle', async () => {
    await page.getByTestId('widget-layout-lock-toggle').click();
    await expect(page.getByTestId('widget-frame')).toHaveAttribute('data-locked', 'false');
    await resizeWhileTyping(page, 'unlocked');
  });

  test('axe clean and tab order reaches widget tabs and menus only when unlocked', async () => {
    const frame = page.getByTestId('widget-frame');
    await expect(frame).toHaveAttribute('data-locked', 'false');
    await expectAxeClean(page, 'unlocked');
    const unlockedStops = await tabStops(page);
    await test.info().attach('tab-stops-unlocked.json', { body: JSON.stringify(unlockedStops, null, 2), contentType: 'application/json' });
    expect(unlockedStops).toContain('widget-tab:leftSidebar');
    expect(unlockedStops).toContain('testid:widget-menu-button-leftSidebar');
    expect(unlockedStops).toContain('editor');

    await page.getByTestId('widget-layout-lock-toggle').click();
    await expect(frame).toHaveAttribute('data-locked', 'true');
    await expectAxeClean(page, 'locked');
    const lockedStops = await tabStops(page);
    await test.info().attach('tab-stops-locked.json', { body: JSON.stringify(lockedStops, null, 2), contentType: 'application/json' });
    expect(lockedStops.filter((s) => s.startsWith('widget-tab:') || s.startsWith('testid:widget-menu-button-'))).toEqual([]);
    expect(lockedStops).toContain('editor');
    expect((await editorIdentity(page)).sameNode, 'same editor node after every state').toBe(true);
  });
});
