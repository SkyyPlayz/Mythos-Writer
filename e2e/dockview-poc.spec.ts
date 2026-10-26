/**
 * Throwaway dockview proof of concept.
 *
 * The normal shell is not under test. Each case reloads the built app with
 * ?poc=dockview, which mounts the real BlockEditor and the real Notes board
 * on a seeded test vault.
 *
 *   npx playwright test e2e/dockview-poc.spec.ts --reporter=list --workers=1
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');
const ARTIFACTS = '/opt/cursor/artifacts/dockview-poc';
const AXE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../node_modules/axe-core/axe.min.js'), 'utf8');

const HISTORY_GAP_MS = 600;

interface EditorSnapshot {
  text: string;
  selection: string;
  from: number;
  to: number;
  scrollTop: number;
  mounts: number;
  unmounts: number;
  boardMounts: number;
  boardUnmounts: number;
}

interface FrameStats {
  n: number;
  p50: number;
  p95: number;
  max: number;
  over16: number;
  over20: number;
}

let tempRoot: string;
let userData: string;
let app: ElectronApplication;
let page: Page;

function writeProfile(dir: string, storyDir: string, notesDir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(storyDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark', apiKey: '' }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: storyDir, notesVaultRoot: notesDir }, null, 2),
  );
}

function seedNotes(notesDir: string): void {
  fs.writeFileSync(path.join(notesDir, 'Alpha.md'), '# Alpha\n\nFirst card.\n');
  fs.writeFileSync(path.join(notesDir, 'Beta.md'), '# Beta\n\nSecond card.\n');
  fs.writeFileSync(path.join(notesDir, 'Gamma.md'), '# Gamma\n\nThird card.\n');
}

async function launchApp(dir: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${dir}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function openPoc(running: ElectronApplication): Promise<Page> {
  const first = await running.firstWindow();
  await first.waitForLoadState('domcontentloaded');
  await running.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) throw new Error('no BrowserWindow');
    win.setContentSize(1440, 900);
    const url = new URL(win.webContents.getURL());
    url.searchParams.set('poc', 'dockview');
    await win.loadURL(url.toString());
  });
  const next = await running.firstWindow();
  await next.waitForLoadState('domcontentloaded');
  return next;
}

async function waitForPoc(target: Page): Promise<void> {
  const error = target.getByTestId('dockview-poc-error');
  const shell = target.getByTestId('dockview-poc');
  await expect(shell.or(error)).toBeVisible({ timeout: 25_000 });
  if (await error.count()) {
    throw new Error(`dockview poc failed to load: ${await error.innerText()}`);
  }
  await expect(target.locator('[data-testid="dockview-poc-editor"] .ProseMirror')).toBeVisible({ timeout: 20_000 });
  await expect(target.locator('.board-canvas__item--note', { hasText: 'Alpha' })).toBeVisible({ timeout: 20_000 });
}

async function editorSnapshot(target: Page): Promise<EditorSnapshot> {
  // Do not focus. Focusing scrolls the selection into view and hides a scroll change.
  // Selection comes from the ProseMirror state, which survives a drag that blurs the DOM.
  return target.evaluate(() => {
    const root = document.querySelector('[data-testid="dockview-poc-editor"]');
    const pm = root?.querySelector('.ProseMirror');
    const wrap = root?.querySelector('.tiptap-editor-wrap');
    const view = window as Window & {
      __pocEditorMounts?: number;
      __pocEditorUnmounts?: number;
      __pocBoardMounts?: number;
      __pocBoardUnmounts?: number;
      __pocEditor?: {
        state: {
          selection: { from: number; to: number };
          doc: { textBetween: (from: number, to: number, blockSeparator?: string) => string };
        };
      } | null;
    };
    const editor = view.__pocEditor;
    const from = editor?.state.selection.from ?? -1;
    const to = editor?.state.selection.to ?? -1;
    const selection = editor && from >= 0 && to >= from ? editor.state.doc.textBetween(from, to, '\n') : '';
    return {
      text: pm?.textContent ?? '',
      selection,
      from,
      to,
      scrollTop: wrap instanceof HTMLElement ? wrap.scrollTop : 0,
      mounts: view.__pocEditorMounts ?? 0,
      unmounts: view.__pocEditorUnmounts ?? 0,
      boardMounts: view.__pocBoardMounts ?? 0,
      boardUnmounts: view.__pocBoardUnmounts ?? 0,
    };
  });
}

async function settledSnapshot(target: Page): Promise<EditorSnapshot> {
  let prev = await editorSnapshot(target);
  for (let i = 0; i < 8; i++) {
    await target.evaluate(() => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }));
    const next = await editorSnapshot(target);
    if (next.text === prev.text && next.from === prev.from && next.to === prev.to && next.scrollTop === prev.scrollTop) return next;
    prev = next;
  }
  return prev;
}

async function dragPointer(target: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await target.mouse.move(from.x, from.y);
  await target.mouse.down();
  await target.mouse.move(from.x + 12, from.y + 8, { steps: 4 });
  await target.mouse.move(to.x, to.y, { steps: 24 });
  await target.mouse.up();
}

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('missing bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragTab(target: Page, tabName: string, dest: Locator, yRatio: number): Promise<void> {
  const from = await centerOf(target.getByRole('tab', { name: tabName, exact: true }));
  const box = await dest.boundingBox();
  if (!box) throw new Error(`missing drop target for ${tabName}`);
  await dragPointer(target, from, { x: box.x + box.width / 2, y: box.y + box.height * yRatio });
}

async function typeDistinctEdits(target: Page, text: string): Promise<void> {
  await target.locator('[data-testid="dockview-poc-editor"] .ProseMirror').click();
  await target.keyboard.press('Control+End');
  for (const ch of text) {
    await target.keyboard.type(ch);
    // ProseMirror history groups keystrokes closer than ~500ms into one undo step.
    await target.waitForTimeout(HISTORY_GAP_MS);
  }
}

async function pressTimes(target: Page, key: string, n: number): Promise<void> {
  await target.locator('[data-testid="dockview-poc-editor"] .ProseMirror').focus();
  for (let i = 0; i < n; i++) await target.keyboard.press(key);
}

function card(target: Page, name: string): Locator {
  return target.locator('.board-canvas__item--note', { hasText: name }).first();
}

async function itemPos(target: Page, name: string): Promise<{ left: number; top: number }> {
  const style = (await card(target, name).getAttribute('style')) ?? '';
  return {
    left: Number(/left:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN),
    top: Number(/top:\s*([\d.]+)px/.exec(style)?.[1] ?? NaN),
  };
}

async function cardOrder(target: Page): Promise<string[]> {
  return target.locator('.board-canvas__item-name').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''));
}

function frameStats(samples: number[]): FrameStats {
  const usable = samples.slice(1).filter((n) => Number.isFinite(n) && n >= 0);
  const sorted = [...usable].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
  return {
    n: usable.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1] ?? 0,
    over16: usable.filter((n) => n > 16).length,
    over20: usable.filter((n) => n > 20).length,
  };
}

async function readFrames(target: Page): Promise<number[]> {
  return target.evaluate(() => {
    const view = window as Window & { __pocFrames?: number[]; __pocRaf?: number };
    if (view.__pocRaf) cancelAnimationFrame(view.__pocRaf);
    return view.__pocFrames ?? [];
  });
}

async function startFrames(target: Page): Promise<void> {
  await target.evaluate(() => {
    const view = window as Window & { __pocFrames?: number[]; __pocRaf?: number };
    if (view.__pocRaf) cancelAnimationFrame(view.__pocRaf);
    view.__pocFrames = [];
    let last = performance.now();
    const loop = (now: number) => {
      view.__pocFrames?.push(now - last);
      last = now;
      view.__pocRaf = requestAnimationFrame(loop);
    };
    view.__pocRaf = requestAnimationFrame(loop);
  });
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function floatLayout(target: Page): Promise<{ floating: boolean; editor: Box | null; dialog: Box | null }> {
  return target.evaluate(() => {
    const editor = document.querySelector('[data-testid="dockview-poc-editor"]');
    const overlay = editor?.closest('.dv-render-overlay');
    const dialog = document.querySelector('.dv-resize-container');
    const box = (el: Element | null | undefined) => {
      if (!(el instanceof HTMLElement)) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    };
    return {
      floating: overlay?.classList.contains('dv-render-overlay-float') ?? false,
      editor: box(editor),
      dialog: box(dialog),
    };
  });
}

function boxInside(inner: Box | null, outer: Box | null): boolean {
  if (!inner || !outer || inner.w < 40 || inner.h < 40) return false;
  const pad = 4;
  return inner.x >= outer.x - pad
    && inner.y >= outer.y - pad
    && inner.x + inner.w <= outer.x + outer.w + pad
    && inner.y + inner.h <= outer.y + outer.h + pad
    && inner.w >= outer.w * 0.75
    && inner.h >= outer.h * 0.55;
}

async function shot(target: Page, name: string): Promise<void> {
  await target.screenshot({ path: path.join(ARTIFACTS, name) });
}

test.describe('dockview poc', () => {
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async () => {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-dockview-poc-'));
    userData = path.join(tempRoot, 'userData');
    const storyDir = path.join(tempRoot, 'story-vault');
    const notesDir = path.join(tempRoot, 'notes-vault');
    writeProfile(userData, storyDir, notesDir);
    seedNotes(notesDir);
    app = await launchApp(userData);
    page = await openPoc(app);
  });

  test.afterAll(async () => {
    await app?.close().catch(() => {});
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test.beforeEach(async () => {
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await waitForPoc(page);
  });

  test('1. drag keeps text, cursor, selection, scroll, and does not remount the editor', async () => {
    const pm = page.locator('[data-testid="dockview-poc-editor"] .ProseMirror');
    await pm.click();
    const paragraph = 'The harbor bell rang twice before the tide turned back.';
    await page.keyboard.type(paragraph);
    await page.keyboard.press('End');
    for (let i = 0; i < 48; i++) await page.keyboard.type('\nscroll line');
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 11; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    const wrap = page.locator('[data-testid="dockview-poc-editor"] .tiptap-editor-wrap');
    await wrap.evaluate((el) => { el.scrollTop = 180; });

    const before = await settledSnapshot(page);
    expect(before.text).toContain(paragraph);
    expect(before.selection.length).toBeGreaterThan(0);
    expect(before.to).toBeGreaterThan(before.from);
    expect(before.scrollTop).toBeGreaterThan(0);
    expect(before.mounts).toBe(1);
    expect(before.unmounts).toBe(0);

    const editorBox = await page.getByTestId('dockview-poc-editor').boundingBox();
    await dragTab(page, 'Writing editor', page.getByTestId('dockview-poc-board'), 0.82);
    await expect.poll(async () => (await page.getByTestId('dockview-poc-editor').boundingBox())?.y ?? 0)
      .toBeGreaterThan((editorBox?.y ?? 0) + 40);

    const after = await editorSnapshot(page);
    expect(after.text).toBe(before.text);
    expect(after.selection).toBe(before.selection);
    expect(after.from).toBe(before.from);
    expect(after.to).toBe(before.to);
    expect(after.scrollTop).toBe(before.scrollTop);
    expect(after.mounts).toBe(before.mounts);
    expect(after.unmounts).toBe(0);
    console.log(`[poc] test1 mounts=${after.mounts} unmounts=${after.unmounts} selection="${after.selection}" from=${after.from} to=${after.to} scroll=${after.scrollTop}`);
    await shot(page, '01-editor-moved.png');
  });

  test('2. ten edits survive a move and a resize, then undo and redo', async () => {
    const before = await editorSnapshot(page);
    await typeDistinctEdits(page, 'abcdefghij');
    const edited = await editorSnapshot(page);
    expect(edited.text.endsWith('abcdefghij')).toBe(true);

    await dragTab(page, 'Writing editor', page.getByTestId('dockview-poc-board'), 0.82);
    const sash = page.locator('.dv-sash').first();
    const sashBox = await sash.boundingBox();
    expect(sashBox).toBeTruthy();
    const sx = (sashBox?.x ?? 0) + (sashBox?.width ?? 0) / 2;
    const sy = (sashBox?.y ?? 0) + (sashBox?.height ?? 0) / 2;
    await dragPointer(page, { x: sx, y: sy }, { x: sx + 48, y: sy });

    const moved = await editorSnapshot(page);
    expect(moved.mounts).toBe(1);
    expect(moved.unmounts).toBe(0);
    expect(moved.text.endsWith('abcdefghij')).toBe(true);

    await pressTimes(page, 'Control+z', 10);
    const undone = await editorSnapshot(page);
    expect(undone.text).toBe(before.text);

    await pressTimes(page, 'Control+y', 10);
    const redone = await editorSnapshot(page);
    expect(redone.text.endsWith('abcdefghij')).toBe(true);
    expect(redone.mounts).toBe(1);
    console.log(`[poc] test2 undo restored=${undone.text === before.text} redoTail=${redone.text.slice(-10)} mounts=${redone.mounts}`);
    await shot(page, '02-after-undo-redo.png');
  });

  test('3. text, selection, and undo survive tabbing the editor behind the board', async () => {
    const pm = page.locator('[data-testid="dockview-poc-editor"] .ProseMirror');
    await pm.click();
    await page.keyboard.type('Tabbed sentence stays put.');
    await page.keyboard.press('Home');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    const before = await settledSnapshot(page);
    expect(before.selection.length).toBeGreaterThan(0);

    await dragTab(page, 'Writing editor', page.getByRole('tab', { name: 'Board', exact: true }), 0.5);
    await expect.poll(async () => page.evaluate(() => {
      const editor = document.querySelector('[role="tab"][aria-label="Writing editor"]');
      const board = document.querySelector('[role="tab"][aria-label="Board"]');
      return !!editor && !!board && editor.parentElement === board.parentElement;
    })).toBe(true);

    await page.getByRole('tab', { name: 'Board', exact: true }).click();
    await page.getByRole('tab', { name: 'Writing editor', exact: true }).click();
    const afterTab = await editorSnapshot(page);
    expect(afterTab.text).toBe(before.text);
    expect(afterTab.selection).toBe(before.selection);
    expect(afterTab.from).toBe(before.from);
    expect(afterTab.to).toBe(before.to);
    expect(afterTab.mounts).toBe(1);
    expect(afterTab.unmounts).toBe(0);

    const marked = await editorSnapshot(page);
    await typeDistinctEdits(page, 'abcdefghij');
    await page.getByRole('tab', { name: 'Board', exact: true }).click();
    await page.getByRole('tab', { name: 'Writing editor', exact: true }).click();
    await pressTimes(page, 'Control+z', 10);
    const undone = await editorSnapshot(page);
    expect(undone.text).toBe(marked.text);
    await pressTimes(page, 'Control+y', 10);
    const redone = await editorSnapshot(page);
    expect(redone.text.endsWith('abcdefghij')).toBe(true);
    expect(redone.mounts).toBe(1);
    console.log(`[poc] test3 mounts=${redone.mounts} unmounts=${redone.unmounts} selection="${afterTab.selection}"`);
    await shot(page, '03-tabbed-back.png');
  });

  test('4. floating the editor and docking it back keeps the document', async () => {
    const pm = page.locator('[data-testid="dockview-poc-editor"] .ProseMirror');
    await pm.click();
    await page.keyboard.type('Floating keeps this sentence.');
    await page.keyboard.down('Shift');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.up('Shift');
    const before = await settledSnapshot(page);
    const windowsBefore = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    await page.getByTestId('poc-float-editor').click();
    // dockview draws panel content in .dv-render-overlay, positioned over the
    // floating dialog. It is not a DOM child of .dv-resize-container.
    await expect.poll(async () => {
      const layout = await floatLayout(page);
      return layout.floating && boxInside(layout.editor, layout.dialog);
    }).toBe(true);
    const floated = await floatLayout(page);
    const windowsDuring = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const floating = await editorSnapshot(page);
    expect(windowsDuring).toBe(windowsBefore);
    console.log(`[poc] test4 before="${before.selection}" ${before.from}-${before.to} after="${floating.selection}" ${floating.from}-${floating.to} overlay=${JSON.stringify(floated)}`);
    expect(floating.text).toBe(before.text);
    expect(floating.selection).toBe(before.selection);
    expect(floating.from).toBe(before.from);
    expect(floating.to).toBe(before.to);
    expect(floating.mounts).toBe(1);
    expect(floating.unmounts).toBe(0);
    await shot(page, '04-editor-floating.png');

    await page.getByTestId('poc-dock-editor').click();
    await expect(page.locator('.dv-resize-container')).toHaveCount(0);
    await expect.poll(async () => (await floatLayout(page)).floating).toBe(false);
    const docked = await editorSnapshot(page);
    expect(docked.text).toBe(before.text);
    expect(docked.selection).toBe(before.selection);
    expect(docked.from).toBe(before.from);
    expect(docked.to).toBe(before.to);
    expect(docked.mounts).toBe(1);
    expect(docked.unmounts).toBe(0);
    console.log(`[poc] test4 windows=${windowsDuring} mounts=${docked.mounts} unmounts=${docked.unmounts}`);
    await shot(page, '04-editor-docked.png');
  });

  test('5. dragging a card, then moving the board, keeps order and selection', async () => {
    const beforeOrder = await cardOrder(page);
    expect(beforeOrder).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'Gamma']));
    const alpha = card(page, 'Alpha');
    const start = await alpha.boundingBox();
    if (!start) throw new Error('Alpha card has no box');
    await dragPointer(page, { x: start.x + 24, y: start.y + 16 }, { x: start.x + 24 + 90, y: start.y + 16 + 50 });
    await expect(alpha).toHaveAttribute('data-selected', 'true');
    const dragged = {
      alpha: await itemPos(page, 'Alpha'),
      beta: await itemPos(page, 'Beta'),
      gamma: await itemPos(page, 'Gamma'),
      order: await cardOrder(page),
    };
    expect(dragged.alpha.left).toBeGreaterThan(0);

    const boardBox = await page.getByTestId('dockview-poc-board').boundingBox();
    await dragTab(page, 'Board', page.getByTestId('dockview-poc-editor'), 0.82);
    await expect.poll(async () => (await page.getByTestId('dockview-poc-board').boundingBox())?.y ?? 0)
      .toBeGreaterThan((boardBox?.y ?? 0) + 40);

    const after = {
      alpha: await itemPos(page, 'Alpha'),
      beta: await itemPos(page, 'Beta'),
      gamma: await itemPos(page, 'Gamma'),
      order: await cardOrder(page),
    };
    expect(after.order).toEqual(dragged.order);
    // Alpha was dragged, so its position is saved. Beta and Gamma are still on
    // the board's auto-layout, which follows canvas width when the panel is docked
    // into a different size. That reflow is the board, and it is logged below.
    expect(after.alpha).toEqual(dragged.alpha);
    await expect(card(page, 'Alpha')).toHaveAttribute('data-selected', 'true');
    const mounts = await editorSnapshot(page);
    console.log(`[poc] test5 boardMounts=${mounts.boardMounts} boardUnmounts=${mounts.boardUnmounts} order=${after.order.join(',')} alpha=${JSON.stringify(after.alpha)} beta ${JSON.stringify(dragged.beta)} -> ${JSON.stringify(after.beta)} gamma ${JSON.stringify(dragged.gamma)} -> ${JSON.stringify(after.gamma)}`);
    expect(mounts.boardUnmounts).toBe(0);
    await shot(page, '05-board-moved.png');
  });

  test('6. resize-drag for 10 seconds while typing drops no keys and stays under 16ms', async () => {
    const pm = page.locator('[data-testid="dockview-poc-editor"] .ProseMirror');
    await pm.click();
    const prefix = 'resize-start ';
    await page.keyboard.type(prefix);

    await startFrames(page);
    await page.waitForTimeout(2_000);
    const idle = frameStats(await readFrames(page));

    const sash = page.locator('.dv-sash').first();
    const sashBox = await sash.boundingBox();
    if (!sashBox) throw new Error('no sash');
    const sx = sashBox.x + sashBox.width / 2;
    const sy = sashBox.y + Math.min(80, sashBox.height / 2);
    await pm.click();
    await startFrames(page);
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    const focusDuringDrag = await page.evaluate(() => {
      const active = document.activeElement;
      return `${active?.tagName ?? 'none'}.${typeof active?.className === 'string' ? active.className : ''}`;
    });
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let typed = '';
    const started = Date.now();
    let i = 0;
    while (Date.now() - started < 10_000) {
      const ch = alphabet[i % alphabet.length];
      await page.keyboard.type(ch);
      typed += ch;
      const wobble = ((i % 10) - 5) * 14;
      await page.mouse.move(sx + wobble, sy, { steps: 2 });
      i += 1;
    }
    await page.mouse.up();
    const resize = frameStats(await readFrames(page));
    const snap = await editorSnapshot(page);
    const text = snap.text;
    const landed = text.includes(prefix) ? text.slice(text.indexOf(prefix) + prefix.length) : '';
    const report = {
      idle,
      resize,
      typed: typed.length,
      landed: landed.length,
      dropped: typed.length - landed.length,
      textLength: text.length,
      textHead: text.slice(0, 80),
      focusDuringDrag,
      mounts: snap.mounts,
      unmounts: snap.unmounts,
    };
    fs.writeFileSync(path.join(ARTIFACTS, 'frame-time.json'), JSON.stringify(report, null, 2));
    console.log(`[poc] test6 ${JSON.stringify(report)}`);
    expect(landed).toBe(typed);
    expect(resize.p95).toBeLessThanOrEqual(16);
    await shot(page, '06-during-resize.png');
  });

  test('7. keyboard moves focus between panels and the screen reader names them', async () => {
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    const stops: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return 'body';
        const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
        const label = el.getAttribute('aria-label') ?? '';
        return `${role}:${label}`;
      });
      stops.push(stop);
    }
    fs.writeFileSync(path.join(ARTIFACTS, 'keyboard-stops.json'), JSON.stringify(stops, null, 2));
    console.log(`[poc] test7 stops=${stops.filter((s) => s.startsWith('tab:')).join(' | ')}`);
    expect(stops).toContain('tab:Writing editor');
    expect(stops).toContain('tab:Board');

    await expect(page.getByRole('tab', { name: 'Writing editor', exact: true })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Board', exact: true })).toHaveCount(1);
    const regionNames = await page.getByRole('region').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(regionNames).toEqual(expect.arrayContaining(['Writing editor', 'Board']));

    // @axe-core/playwright opens a new page, which Electron refuses. Run axe in this page.
    await page.evaluate(AXE_SOURCE);
    const axe = await page.evaluate(async () => {
      const root = document.querySelector('[data-testid="dockview-poc"]');
      if (!root) throw new Error('dockview poc root missing');
      const runner = (window as unknown as {
        axe: { run: (el: Element) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: unknown[] }> }> };
      }).axe;
      return runner.run(root);
    });
    fs.writeFileSync(
      path.join(ARTIFACTS, 'axe.json'),
      JSON.stringify({ violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) }, null, 2),
    );
    console.log(`[poc] test7 axe=${axe.violations.map((v) => `${v.id}:${v.impact}`).join(',') || 'none'}`);
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious, serious.map((v) => v.id).join(', ')).toEqual([]);
    await shot(page, '07-keyboard.png');
  });
});
