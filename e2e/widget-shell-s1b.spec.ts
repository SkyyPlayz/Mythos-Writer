// MW-059-S1b proof: unlock → move Story navigator to top → duplicate → lock, and the editor survives (no remount; text, selection, undo, focus, IME).
/**
 * widget-shell-s1b.spec.ts
 *
 * Runs against a beta bundle (widgetShell flag ON), built once into
 * out/widget-shell-beta by the helper below. The profile seeds only vault
 * paths + onboardingComplete; the layout is never seeded — every widget change
 * is made by clicking the real lock toggle and widget menu.
 *
 * Asserts only the S1b DOM contract (data-widget-* hosts, widget menu testids,
 * role=tab with [data-widget-tab]); the only dockview selector is `.dv-tab`,
 * used once to prove no tab headers are visible while locked.
 *
 *   rm -rf out/ && npm run build:electron
 *   xvfb-run --auto-servernum npx playwright test e2e/widget-shell-s1b.spec.ts --reporter=list --workers=1
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';
import { createStoryFromNavAdd } from './helpers/newStoryModal';
import { closeElectronApp, removeTempDirs } from './helpers/electronTeardown';
import { composeWithIme, installCompositionProbe, readCompositionProbe } from './fixtures/imeComposition';

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
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

// ── DOM contract (frame) ──
const host = (page: Page, id: string) => page.locator(`[data-widget-id="${id}"]`);
const widgetTab = (page: Page, id: string) =>
  page.getByRole('tab').filter({ has: page.locator(`[data-widget-tab="${id}"]`) });
const EDITOR_SEL = '[data-widget-id="center"] .ProseMirror';

// v2 settings fields 0.5.8 reads (plan "N1"): S1b must never write them.
const N1_FIELDS = ['activeLayout', 'workspaceLayouts', 'rightSidebarVisible', 'rightSidebarWidth', 'rightSidebarPanels'] as const;

interface PersistSnapshot {
  hasLayoutV3: boolean;
  n1: Record<string, unknown>;
}

function readPersist(settingsPath: string): PersistSnapshot | null {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    const n1: Record<string, unknown> = {};
    for (const k of N1_FIELDS) n1[k] = raw[k] ?? null;
    return { hasLayoutV3: Object.prototype.hasOwnProperty.call(raw, 'layoutV3'), n1 };
  } catch {
    return null; // mid-write — caller retries
  }
}

/**
 * Reads the settings file once it has stopped changing for `quietMs` (the app's
 * settings writes are debounced). This is a settle wait, not a fixed sleep: it
 * returns as soon as the file has been quiet that long.
 */
async function readPersistSettled(settingsPath: string, quietMs = 1_500, timeoutMs = 20_000): Promise<PersistSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last = readPersist(settingsPath);
  let lastJson = JSON.stringify(last);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const next = readPersist(settingsPath);
    const nextJson = JSON.stringify(next);
    if (nextJson !== lastJson) {
      last = next;
      lastJson = nextJson;
      stableSince = Date.now();
    } else if (last && Date.now() - stableSince >= quietMs) {
      return last;
    }
  }
  throw new Error(`settings file ${settingsPath} never settled`);
}

async function widgetStorageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const keys: string[] = [];
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && /layoutV3|widget|dockview/i.test(k)) keys.push(k);
      }
    } catch { /* storage unavailable */ }
    return keys.sort();
  });
}

interface EditorState {
  sameNode: boolean;
  connected: boolean;
  text: string;
  selection: string;
  focusedInEditor: boolean;
}

async function editorState(page: Page): Promise<EditorState> {
  return page.evaluate((sel) => {
    const tagged = (window as unknown as { __s1bEditor?: HTMLElement }).__s1bEditor;
    const current = document.querySelector(sel);
    const selection = window.getSelection();
    return {
      sameNode: !!tagged && current === tagged && (tagged as unknown as { __s1bTag?: string }).__s1bTag === 's1b-editor',
      connected: !!tagged && tagged.isConnected,
      text: tagged?.textContent ?? '',
      selection: selection && tagged && selection.anchorNode && tagged.contains(selection.anchorNode) ? selection.toString() : '',
      focusedInEditor: !!tagged && !!document.activeElement && tagged.contains(document.activeElement),
    };
  }, EDITOR_SEL);
}

async function openSceneByClicking(page: Page): Promise<void> {
  await clickStoryNav(page);
  await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 10_000 });
  const storiesTab = host(page, 'leftSidebar').locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  await createStoryFromNavAdd(page);
  await host(page, 'leftSidebar').locator('.nav-scene-row').first().click();
  await expect(page.locator(EDITOR_SEL)).toBeVisible({ timeout: 15_000 });
}

async function chooseMenuItem(page: Page, widgetId: string, item: string): Promise<void> {
  const button = page.getByTestId(`widget-menu-button-${widgetId}`);
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByTestId('widget-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: item, exact: true }).click();
  await expect(menu).toHaveCount(0);
}

test.describe('MW-059-S1b widget shell: move, duplicate, lock keep the editor', () => {
  test.describe.configure({ timeout: 240_000 });

  let tempRoot: string;
  let userData: string;
  let app: ElectronApplication | undefined;
  let page: Page;

  test.beforeAll(async () => {
    const mainJs = await ensureBetaBundle();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-widget-s1b-'));
    userData = path.join(tempRoot, 'userData');
    seedProfile(userData, path.join(tempRoot, 'story-vault'), path.join(tempRoot, 'notes-vault'));
    app = await launchBeta(mainJs, userData);
    page = await firstWindow(app);
  });

  test.afterAll(async () => {
    await closeElectronApp(app);
    removeTempDirs(tempRoot);
  });

  test('unlock → move to top → duplicate → lock: no remount; text, selection, undo, focus, IME survive; nothing persisted', async () => {
    const testInfo = test.info();
    const frame = page.getByTestId('widget-frame');
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await expect(frame).toHaveAttribute('data-locked', 'true');
    await expect(host(page, 'center')).toBeVisible();
    await expect(host(page, 'leftSidebar')).toHaveAttribute('data-widget-edge', 'left');

    // ── Write in a scene reached by clicking from a fresh profile ──
    await openSceneByClicking(page);
    const editor = page.locator(EDITOR_SEL);
    await expect(editor).toHaveAttribute('aria-label', 'Writing editor');
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    // Write in a new paragraph: the first one has a CSS ::first-letter drop cap, and Chromium's
    // Home key stops after the first letter there (flag-off shell too), so Home would miss "T".
    await page.keyboard.press('Enter');
    await page.keyboard.type('The harbor bell rang twice. ');
    // Separate undo steps: ProseMirror history groups keys closer than ~500 ms.
    for (const ch of 'xyz') {
      await page.waitForTimeout(600);
      await page.keyboard.type(ch);
    }
    await page.waitForTimeout(600);
    // Select "The harbor" (first 10 characters of the paragraph).
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');

    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error('editor missing');
      (el as unknown as { __s1bTag?: string }).__s1bTag = 's1b-editor';
      (window as unknown as { __s1bEditor?: HTMLElement }).__s1bEditor = el;
    }, EDITOR_SEL);
    const before = await editorState(page);
    expect(before.sameNode).toBe(true);
    expect(before.text).toContain('The harbor bell rang twice. xyz');
    expect(before.selection).toBe('The harbor');

    const settingsPath = path.join(userData, 'app-settings.json');
    const persistBefore = await readPersistSettled(settingsPath);
    expect(persistBefore.hasLayoutV3).toBe(false);
    const storageBefore = await widgetStorageKeys(page);

    // ── Unlock ──
    const lockToggle = page.getByTestId('widget-layout-lock-toggle');
    await expect(lockToggle).toHaveAccessibleName('Unlock layout');
    await lockToggle.click();
    await expect(frame).toHaveAttribute('data-locked', 'false');
    await expect(lockToggle).toHaveAccessibleName('Lock layout');
    await expect(widgetTab(page, 'leftSidebar')).toBeVisible();
    const unlockedShot = testInfo.outputPath('widget-shell-unlocked.png');
    await page.screenshot({ path: unlockedShot });
    await testInfo.attach('widget-shell-unlocked', { path: unlockedShot, contentType: 'image/png' });

    // ── Move Story navigator to the top ──
    await chooseMenuItem(page, 'leftSidebar', 'Move to top');
    await expect(host(page, 'leftSidebar')).toHaveAttribute('data-widget-edge', 'top');
    await expect.poll(async () => {
      const nav = await host(page, 'leftSidebar').boundingBox();
      const center = await host(page, 'center').boundingBox();
      return !!nav && !!center && nav.height > 0 && nav.y + nav.height <= center.y + 2;
    }, { message: 'Story navigator sits above the center' }).toBe(true);

    // ── Duplicate ──
    await chooseMenuItem(page, 'leftSidebar', 'Duplicate');
    const copy = host(page, 'leftSidebar:copy:2');
    await expect(copy).toHaveCount(1);
    await expect(copy).toHaveAttribute('data-widget-kind', 'leftSidebar');
    await expect(copy.getByTestId('left-rail')).toBeVisible();
    await expect(widgetTab(page, 'leftSidebar:copy:2')).toHaveText('Story navigator (copy 2)');
    const dupShot = testInfo.outputPath('widget-shell-duplicated.png');
    await page.screenshot({ path: dupShot });
    await testInfo.attach('widget-shell-duplicated', { path: dupShot, contentType: 'image/png' });

    // ── Lock ──
    await lockToggle.click();
    await expect(frame).toHaveAttribute('data-locked', 'true');
    await expect(lockToggle).toHaveAccessibleName('Unlock layout');
    await expect(page.locator('.dv-tab:visible')).toHaveCount(0);
    await expect(page.locator('[data-widget-tab]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid^="widget-menu-button-"]:visible')).toHaveCount(0);
    // Positions survive the lock.
    await expect(host(page, 'leftSidebar')).toHaveAttribute('data-widget-edge', 'top');
    await expect(copy).toHaveCount(1);

    // ── Editor: not remounted, text unchanged ──
    const afterLayout = await editorState(page);
    expect(afterLayout.connected, 'tagged .ProseMirror still connected').toBe(true);
    expect(afterLayout.sameNode, 'same .ProseMirror node (no remount)').toBe(true);
    expect(afterLayout.text).toBe(before.text);

    // ── Selection restored on refocus (no click — a click would move it) ──
    await page.evaluate(() => (window as unknown as { __s1bEditor?: HTMLElement }).__s1bEditor?.focus());
    await expect.poll(async () => (await editorState(page)).selection, { message: 'selection restored' }).toBe(before.selection);
    expect((await editorState(page)).focusedInEditor).toBe(true);

    // ── Undo: one Ctrl+Z removes only the last typed step ("z") ──
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await editorState(page)).text).toBe(before.text.replace('twice. xyz', 'twice. xy'));
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await editorState(page)).text).toBe(before.text.replace('twice. xyz', 'twice. x'));

    // ── Focus returns to the editor by clicking it ──
    await page.getByTestId('widget-layout-lock-toggle').focus();
    expect((await editorState(page)).focusedInEditor).toBe(false);
    await editor.click();
    await expect.poll(async () => (await editorState(page)).focusedInEditor).toBe(true);

    // ── IME composition commits into the same editor node after the layout changes ──
    await page.keyboard.press('ControlOrMeta+End');
    await installCompositionProbe(page, EDITOR_SEL);
    await composeWithIme(page, ['n', 'に', 'にほ', 'にほん'], '日本');
    await expect.poll(async () => (await editorState(page)).text).toContain('日本');
    const afterIme = await editorState(page);
    expect(afterIme.text).not.toContain('にほん');
    expect(afterIme.sameNode, 'IME landed in the same editor node').toBe(true);
    const probe = await readCompositionProbe(page);
    expect(probe.starts).toBeGreaterThanOrEqual(1);
    expect(probe.ends).toBeGreaterThanOrEqual(1);
    expect(probe.committed).toContain('日本');

    // ── Persistence: S1b writes nothing (no layoutV3, N1 v2 fields untouched, no widget storage) ──
    const persistAfter = await readPersistSettled(settingsPath);
    expect(persistAfter.hasLayoutV3, 'no layoutV3 key written').toBe(false);
    expect(persistAfter.n1, 'N1 v2 fields unchanged').toEqual(persistBefore.n1);
    expect(await widgetStorageKeys(page)).toEqual(storageBefore);
  });
});
