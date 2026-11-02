// MW-059-S1b (#9): keyboard-only unlock → move → duplicate → Escape → lock, with focus and the polite live region asserted at every step, plus axe on the frame.
/**
 * widget-shell-s1b-keyboard.spec.ts
 *
 * No mouse input at all after launch: every step is Tab / Shift+Tab / Enter /
 * arrows / Escape. Runs against the beta bundle (widgetShell ON). The layout is
 * never seeded. Only the S1b DOM contract is used (no .dv-* selectors).
 *
 *   rm -rf out/ && npm run build:electron
 *   xvfb-run --auto-servernum npx playwright test e2e/widget-shell-s1b-keyboard.spec.ts --reporter=list --workers=1
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
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

const MSG = {
  unlocked: 'Layout unlocked. Widgets can be moved and duplicated.',
  locked: 'Layout locked.',
  movedTop: 'Story navigator moved to the top.',
  duplicated: 'Story navigator duplicated as Story navigator (copy 2).',
};

interface ActiveInfo {
  testId: string;
  role: string;
  /** data-widget-tab of the focused role=tab, if the focus is a widget tab. */
  widgetTab: string;
  name: string;
  inMenu: boolean;
}

async function active(page: Page): Promise<ActiveInfo> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { testId: '', role: '', widgetTab: '', name: '', inMenu: false };
    const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
    const tabLabel = role === 'tab' ? el.querySelector('[data-widget-tab]') : null;
    return {
      testId: el.getAttribute('data-testid') ?? '',
      role,
      widgetTab: tabLabel?.getAttribute('data-widget-tab') ?? '',
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim(),
      inMenu: !!el.closest('[data-testid="widget-menu"]'),
    };
  });
}

/** Presses Tab (then Shift+Tab) until the focused element matches; fails with the stops seen. */
async function tabTo(page: Page, matches: (a: ActiveInfo) => boolean, label: string): Promise<void> {
  const seen: string[] = [];
  for (const key of ['Tab', 'Shift+Tab'] as const) {
    for (let i = 0; i < 160; i++) {
      if (matches(await active(page))) return;
      await page.keyboard.press(key);
      const a = await active(page);
      seen.push(`${key}:${a.role}:${a.testId || a.widgetTab || a.name.slice(0, 24)}`);
    }
  }
  throw new Error(`keyboard never reached ${label}; stops: ${seen.slice(-40).join(' | ')}`);
}

/** Moves focus inside the open widget menu with ArrowDown until the named item is focused. */
async function arrowToItem(page: Page, item: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const a = await active(page);
    if (a.inMenu && a.role === 'menuitem' && a.name === item) return;
    await page.keyboard.press('ArrowDown');
  }
  throw new Error(`menu item "${item}" never focused`);
}

async function expectAnnounced(page: Page, message: string): Promise<void> {
  const region = page.locator('#widget-layout-announcer');
  await expect(region).toHaveAttribute('role', 'status');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await expect(region).toHaveText(message);
}

interface AxeViolation { id: string; impact: string | null; help: string; nodes: Array<{ target: unknown }> }

/**
 * Runs axe in-page (Electron cannot open the extra page @axe-core/playwright needs).
 * Returns every violation on the frame (+ open widget menu) and, separately, the
 * violations on the widget chrome S1b adds (tabs, menu buttons, menu, lock toggle).
 */
async function runAxe(page: Page): Promise<{ all: AxeViolation[]; chrome: AxeViolation[] }> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    type Run = (ctx: unknown, opts?: unknown) => Promise<{ violations: AxeViolation[] }>;
    const axe = (window as unknown as { axe: { run: Run } }).axe;
    const include: string[][] = [['[data-testid="widget-frame"]']];
    if (document.querySelector('[data-testid="widget-menu"]')) include.push(['[data-testid="widget-menu"]']);
    const all = (await axe.run({ include })).violations;
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
  const report = {
    label,
    all: all.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target) })),
    chrome: chrome.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target) })),
  };
  console.log(`[axe] ${label} frame=${summarize(all)} chrome=${summarize(chrome)}`);
  await test.info().attach(`axe-${label}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  const fresh = newViolations(all);
  expect(fresh, `${label}: axe violations on the frame beyond the pre-existing app content: ${JSON.stringify(fresh)}`).toEqual([]);
  expect(chrome, `${label}: axe violations on widget chrome: ${summarize(chrome)}`).toEqual([]);
}

test.describe('MW-059-S1b widget shell: keyboard-only flow (#9)', () => {
  test.describe.configure({ timeout: 240_000 });

  let tempRoot: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    const mainJs = await ensureBetaBundle();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-widget-kbd-'));
    const userData = path.join(tempRoot, 'userData');
    seedProfile(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchBeta(mainJs, userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tempRoot);
  });

  test('unlock, move, duplicate, Escape, lock — focus and live region per step; axe clean', async () => {
    const frame = page.getByTestId('widget-frame');
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await expect(frame).toHaveAttribute('data-locked', 'true');
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 20_000 });

    const toggle = page.getByTestId('widget-layout-lock-toggle');
    const leftButtonId = 'widget-menu-button-leftSidebar';
    const copyButtonId = 'widget-menu-button-leftSidebar:copy:2';
    const menu = page.getByTestId('widget-menu');

    // 1. Tab to the lock toggle, Enter → unlocked, announced, focus stays on the toggle.
    await tabTo(page, (a) => a.testId === 'widget-layout-lock-toggle', 'lock toggle');
    await expect(toggle).toHaveAccessibleName('Unlock layout');
    await page.keyboard.press('Enter');
    await expect(frame).toHaveAttribute('data-locked', 'false');
    await expectAnnounced(page, MSG.unlocked);
    await expect(toggle).toHaveAccessibleName('Lock layout');
    expect((await active(page)).testId).toBe('widget-layout-lock-toggle');

    await expectAxeClean(page, 'unlocked');

    // 2. Tab / Shift+Tab to the Story navigator widget menu button; Enter opens the menu.
    await tabTo(page, (a) => a.testId === leftButtonId, 'Story navigator widget menu button');
    const leftButton = page.getByTestId(leftButtonId);
    await expect(leftButton).toHaveAttribute('aria-haspopup', 'menu');
    await expect(leftButton).toHaveAttribute('aria-expanded', 'false');
    await expect(leftButton).toHaveAccessibleName('Story navigator widget options');
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(menu).toHaveAttribute('aria-label', 'Story navigator widget options');
    await expect(leftButton).toHaveAttribute('aria-expanded', 'true');
    // Focus on the first enabled item: "Move to left" is the current edge (disabled).
    await expect(menu.getByRole('menuitem', { name: 'Move to left', exact: true })).toHaveAttribute('aria-disabled', 'true');
    let a = await active(page);
    expect(a.inMenu && a.role === 'menuitem').toBe(true);
    expect(a.name).toBe('Move to right');

    await expectAxeClean(page, 'menu-open');

    // 3. ArrowDown to "Move to top", Enter → moved, announced, focus on the moved widget's tab.
    await arrowToItem(page, 'Move to top');
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('[data-widget-id="leftSidebar"]')).toHaveAttribute('data-widget-edge', 'top');
    await expectAnnounced(page, MSG.movedTop);
    a = await active(page);
    expect(a.role, 'focus on a tab after move').toBe('tab');
    expect(a.widgetTab).toBe('leftSidebar');

    // 4. Reopen the menu, Duplicate → announced, focus on the copy's tab.
    await tabTo(page, (x) => x.testId === leftButtonId, 'Story navigator widget menu button (after move)');
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    // The edge item for the new spot is now the disabled one.
    await expect(menu.getByRole('menuitem', { name: 'Move to top', exact: true })).toHaveAttribute('aria-disabled', 'true');
    await arrowToItem(page, 'Duplicate');
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(page.locator('[data-widget-id="leftSidebar:copy:2"]')).toHaveCount(1);
    await expectAnnounced(page, MSG.duplicated);
    a = await active(page);
    expect(a.role, 'focus on a tab after duplicate').toBe('tab');
    expect(a.widgetTab).toBe('leftSidebar:copy:2');

    // 5. Escape closes the menu and returns focus to its button (nothing announced, nothing changed).
    await tabTo(page, (x) => x.testId === copyButtonId, 'copy widget menu button');
    const copyButton = page.getByTestId(copyButtonId);
    await expect(copyButton).toHaveAccessibleName('Story navigator (copy 2) widget options');
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Close copy', exact: true })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(copyButton).toHaveAttribute('aria-expanded', 'false');
    expect((await active(page)).testId).toBe(copyButtonId);
    await expect(page.locator('[data-widget-id="leftSidebar:copy:2"]')).toHaveCount(1);
    await expect(page.locator('[data-widget-id="leftSidebar"]')).toHaveAttribute('data-widget-edge', 'top');

    // 6. Enter reopens; End jumps to "Lock layout"; Enter → locked, announced, focus on the lock toggle.
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await page.keyboard.press('End');
    a = await active(page);
    expect(a.inMenu && a.name === 'Lock layout').toBe(true);
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(frame).toHaveAttribute('data-locked', 'true');
    await expectAnnounced(page, MSG.locked);
    await expect(toggle).toHaveAccessibleName('Unlock layout');
    expect((await active(page)).testId).toBe('widget-layout-lock-toggle');
    await expect(page.locator('[data-widget-tab]:visible')).toHaveCount(0);
  });
});
