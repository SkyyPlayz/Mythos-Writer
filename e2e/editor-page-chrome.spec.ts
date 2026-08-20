// SKY-3204 / SKY-3209 (B6): Story page chrome — presets + drag (owner-locked decision).
// Page chrome is a Story-only wrapper concern (wired in DesktopShell, NOT in the
// shared <RichTextEditor> core): size presets, margin/font sliders, reset. This
// net pins that the chrome survives the B1 extraction and stays Story-scoped.
//
// SKY-9404 (M1-S4): the legacy `PageChromeToolbar` (`.pct-*`)/`PageRuler`
// (`[data-testid="page-ruler"]`)/`DocHeader` (`.doc-header*`) components this
// file used to test were deleted — M1 spec §4 row 5/6 replaced them with
// ManuscriptView's own `.msv-toolbar` + `PageSetupPopover` (page chip) + the
// single-track `MarginRuler` (two diamond pairs), all depth-invariant. This
// file was rewritten against the current DOM; interaction semantics that were
// genuinely retired (A4/Letter presets, a reset button, a continuous
// line-spacing slider, click-to-rename in the header) are gone by design —
// see plans/fidelity-rebuild/PLAN.md §4 rows 3/5/6.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { clickStoryNav } from './helpers/navGuard';

const MAIN_JS = path.resolve(__dirname, '../out/main/main.js');

function seedUserData(userData: string, vaultDir: string, notesDir: string): void {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, '.notes-vault'), '');
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({ onboardingComplete: true, theme: 'dark' }, null, 2),
  );
  fs.writeFileSync(
    path.join(userData, 'vault-settings.json'),
    JSON.stringify({ vaultRoot: vaultDir, notesVaultRoot: notesDir }, null, 2),
  );
}

async function launchApp(userData: string): Promise<ElectronApplication> {
  const extraArgs = process.platform !== 'darwin' && !process.env.DISPLAY ? ['--headless'] : [];
  return electron.launch({
    args: [MAIN_JS, `--user-data-dir=${userData}`, '--no-sandbox', ...extraArgs],
    timeout: 60_000,
  });
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

async function openScene(page: Page): Promise<void> {
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await clickStoryNav(page);
  await expect(page.locator('#app-tabpanel-story')).toBeVisible({ timeout: 5_000 });

  const storiesTab = page.locator('.rail-tab', { hasText: 'Stories' });
  if (await storiesTab.isVisible()) await storiesTab.click();
  // M3 instant-create: no prompt — one transaction scaffolds the story,
  // "Chapter 1", and an "Untitled Scene", and opens the scene automatically.
  await page.locator('.lr-nav-add').first().click();
  await page.locator('.nav-scene-row').first().click();

  await expect(page.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible({ timeout: 10_000 });

  // A fresh scene shows the Getting Started checklist, which floats over the
  // page and intercepts pointer events aimed at the ruler/toolbar beneath it.
  const gsDismiss = page.locator('[data-testid="gs-dismiss"]');
  if (await gsDismiss.isVisible().catch(() => false)) {
    await gsDismiss.click();
    await expect(page.locator('[data-testid="gs-panel"]')).not.toBeVisible({ timeout: 4_000 });
  }
}

/** The custom properties `applyStoryPageTokens` (theme.ts) writes onto :root —
 * inherited everywhere, so reading them off document.documentElement is
 * immune to which element currently renders the page chrome. */
function readPageToken(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
}

let tempRoot: string;
let userData: string;
let vaultDir: string;
let notesDir: string;

test.beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-pagechrome-'));
  userData = path.join(tempRoot, 'userData');
  vaultDir = path.join(tempRoot, 'vault');
  notesDir = path.join(tempRoot, 'notes');
  seedUserData(userData, vaultDir, notesDir);
});

test.afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('PC-01: manuscript formatting toolbar renders style/font/size/line-spacing + page setup controls', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const toolbar = page.getByTestId('msv-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByTestId('msv-style-select')).toBeVisible();
    await expect(toolbar.getByTestId('msv-font-select')).toBeVisible();
    await expect(toolbar.getByTestId('msv-size-down')).toBeVisible();
    await expect(toolbar.getByTestId('msv-size-val')).toBeVisible();
    await expect(toolbar.getByTestId('msv-size-up')).toBeVisible();
    await expect(toolbar.getByTestId('msv-line-spacing-select')).toBeVisible();
    await expect(toolbar.getByTestId('msv-page-setup-btn')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-02: page setup popover opens from the page chip and live-updates the page width', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const pageSetupBtn = page.getByTestId('msv-page-setup-btn');
    await expect(pageSetupBtn.locator('.msv-page-setup-readout')).toHaveText('1000px');

    await pageSetupBtn.click();
    const popover = page.locator('[role="dialog"][aria-label="Page setup"]');
    await expect(popover).toBeVisible();

    const widthSlider = popover.locator('input[aria-label="Page width slider"]');
    await expect(widthSlider).toHaveValue('1000');
    await widthSlider.fill('900');
    await widthSlider.dispatchEvent('change');

    await expect(widthSlider).toHaveValue('900');
    expect(await readPageToken(page, '--page-width-story')).toBe('900px');
    await expect(pageSetupBtn.locator('.msv-page-setup-readout')).toHaveText('900px');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-04: line-spacing select changes and persists the page line height (SKY-5777)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const lineSpacingSelect = page.getByTestId('msv-line-spacing-select');
    await expect(lineSpacingSelect).toBeVisible();
    await expect(lineSpacingSelect).toHaveValue('1.85');

    const initialLineHeight = await readPageToken(page, '--story-page-line-height');
    expect(initialLineHeight).toBe('1.85');

    await lineSpacingSelect.selectOption('2.5');

    await expect(lineSpacingSelect).toHaveValue('2.5');
    const updatedLineHeight = await readPageToken(page, '--story-page-line-height');
    expect(updatedLineHeight).not.toEqual(initialLineHeight);
    expect(updatedLineHeight).toBe('2.5');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-03: page chrome is Story-only — Notes rich mode has minimal chrome (owner decision)', async () => {
  const notePath = path.join(notesDir, 'chromeless.md');
  fs.writeFileSync(notePath, '# Minimal\n\nNotes keep minimal page chrome.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();

    await page.locator('[data-testid^="vb-row-"]', { hasText: 'chromeless' }).first().click();
    // M17: the mode switch now lives inside the gear-menu popover
    // (`[data-testid="note-gear-btn"]`), not an always-visible mode row.
    await page.locator('.note-viewer [data-testid="note-gear-btn"]').click();
    await expect(page.locator('.note-viewer .note-mode-group[aria-label="Editor mode"]')).toBeVisible({ timeout: 8_000 });
    await page.locator('[data-testid="note-gear-mode-rich"]').click();
    await expect(page.locator('.note-viewer .ProseMirror')).toBeVisible();

    // The Story manuscript toolbar / page ruler must NOT leak into the Notes surface.
    await expect(page.locator('#app-tabpanel-notes [data-testid="msv-toolbar"]')).toHaveCount(0);
    await expect(page.locator('#app-tabpanel-notes [data-testid="margin-ruler"]')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

// ─── GH #842 / Beta 3 M10 / M1 row 6 — single ruler, two diamond pairs ──────

test('PC-05: margin ruler drags page width (outer pair) and margins (inner pair) with keyboard nudge (GH #842)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    // SKY-5904-style width requirement: the ruler track is sized to the
    // visible content column, and at the default (narrower) window the
    // canonical 1000px page width leaves the diamonds positioned partly
    // behind the left sidebar. Widen the window so both diamond pairs sit
    // fully inside the visible track.
    const originalSize = page.viewportSize();
    await page.setViewportSize({ width: 2000, height: 1000 });

    const ruler = page.getByTestId('margin-ruler');
    await expect(ruler).toBeVisible();

    // Baseline: canonical page prefs seed 1000px / 84px margin on fresh profiles.
    const widthHandle = page.getByTestId('margin-ruler-handle-r');
    await expect(widthHandle).toHaveAttribute('aria-valuenow', '1000');

    // Inner (margin) diamond drag writes through to --story-page-pad-horiz
    // (canonical default 84px) — locked pair: dragging toward the page center
    // grows the margin, width stays put. Done first, at the pristine 1000px
    // width, so the diamond sits safely inside the ruler track — growing the
    // page width first would push it toward/off the track's edge.
    const marginHandle = page.getByTestId('margin-ruler-margin-handle-l');
    await expect(marginHandle).toHaveAttribute('aria-valuenow', '84');
    const mbox = await marginHandle.boundingBox();
    expect(mbox).not.toBeNull();
    const mx = mbox!.x + mbox!.width / 2;
    const my = mbox!.y + mbox!.height / 2;
    await page.mouse.move(mx, my);
    await page.mouse.down();
    // The drag start handler attaches its window mousemove/mouseup listeners
    // from a React onMouseDown callback — give it a tick before the next
    // synthesized move, or it races the listener registration.
    await page.waitForTimeout(100);
    await page.mouse.move(mx + 30, my, { steps: 4 });
    // Live preview during the drag is local component state (the page-corner
    // badge), not yet the shared :root token — onChange/onMarginChange only
    // feed the ruler's own live value; onCommit (mouseup/keyboard) is what
    // funnels through commitPrefs → applyStoryPageTokens.
    await expect(page.getByTestId('msv-width-badge')).toHaveText('114 px margin');
    expect(await readPageToken(page, '--story-page-pad-horiz')).toBe('84px');
    await page.mouse.up();
    await expect(page.getByTestId('msv-width-badge')).not.toBeVisible();
    expect(await readPageToken(page, '--story-page-pad-horiz')).toBe('114px');
    await expect(marginHandle).toHaveAttribute('aria-valuenow', '114');
    // Width is unaffected by the margin drag (locked-pair contract).
    expect(await readPageToken(page, '--page-width-story')).toBe('1000px');

    // Drag the right (outer) diamond outward by 100px — symmetric resize math
    // doubles the delta: width grows by 2×∆ = 200px → 1200px.
    const box = await widthHandle.boundingBox();
    expect(box).not.toBeNull();
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(startX + 100, startY, { steps: 5 });
    await expect(page.getByTestId('msv-width-badge')).toHaveText('1200 px page');
    expect(await readPageToken(page, '--page-width-story')).toBe('1000px');
    await page.mouse.up();
    await expect(page.getByTestId('msv-width-badge')).not.toBeVisible();
    expect(await readPageToken(page, '--page-width-story')).toBe('1200px');
    // Commit landed in prefs: the page chip readout follows.
    await expect(page.getByTestId('msv-page-setup-btn').locator('.msv-page-setup-readout')).toHaveText('1200px');
    // The margin set moments ago is unaffected by the width commit (locked pair).
    expect(await readPageToken(page, '--story-page-pad-horiz')).toBe('114px');

    // Keyboard: focused outer diamond nudges width by 20px per arrow (WCAG 2.1 AA).
    await widthHandle.focus();
    await expect(widthHandle).toHaveAttribute('aria-valuenow', '1200');
    await page.keyboard.press('ArrowRight');
    await expect(widthHandle).toHaveAttribute('aria-valuenow', '1220');
    expect(await readPageToken(page, '--page-width-story')).toBe('1220px');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('PC-07: margin ruler renders above the editor with a measurable track', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const ruler = page.getByTestId('margin-ruler');
    await expect(ruler).toBeVisible();
    const track = page.getByTestId('margin-ruler-track');
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

// ─── M1 row 3/4 — title row + zoom bar (formerly the DocHeader) ────────────

test('PC-06: title row and zoom bar render above the editor with zoom and focus controls', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    // Zoom control — M1 row 4, depth-invariant zoom segment on ManuscriptView.
    const zoomBar = page.locator('.msv-zoombar').first();
    await expect(zoomBar).toBeVisible();
    await expect(page.getByTestId('msv-zoom-scene')).toHaveAttribute('aria-pressed', 'true');

    // Focus toggle — M1 row 3, title row.
    await expect(page.getByTestId('msv-title-focus')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

// SKY-6491: DocHeader shipped with wordCount hardcoded to 0 and its title
// editor wired to a no-op — this net pins that word count is real and
// load-bearing. Title rename itself now happens via the nav-tree double-click
// path (e2e/vault-crud.spec.ts TC-V-07), not a click-to-edit header title —
// M1 row 3 (PLAN.md §4) doesn't spec an inline-editable title.
test('PC-08: title row word count reflects real content (SKY-6491)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    const wordCount = page.getByTestId('msv-title-words');
    await expect(wordCount).toHaveText('0 words');

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('one two three four five');
    await expect(wordCount).toHaveText('5 words');

    await expect(page.getByTestId('msv-scope-title')).toHaveText('Untitled Scene');
  } finally {
    await app.close().catch(() => undefined);
  }
});

// SKY-10925 (R9): scene depth used to drop into BlockEditor's own card — its
// own header/chips, its own .fmt-toolbar stacked on top of msv-toolbar, and
// its own bordered/backgrounded box nested inside .msv-sheet (the unified
// page). This pins the fix: exactly ONE toolbar at every depth including
// scene, and the scene editor renders as page content, not a nested card.
test('PC-09: scene depth has exactly one toolbar and no nested editor card (SKY-10925)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openScene(page);

    for (const depth of ['book', 'part', 'chapter', 'scene'] as const) {
      await page.getByTestId(`msv-zoom-${depth}`).click();
      await expect(page.getByTestId(`msv-zoom-${depth}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('msv-toolbar')).toHaveCount(1);
      await expect(page.locator('.fmt-toolbar')).toHaveCount(0);
    }

    // Back to scene depth for the card-nesting checks.
    await page.getByTestId('msv-zoom-scene').click();
    await expect(page.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible();

    // No BlockEditor-owned card wrapper (its own background/border/max-width)
    // survives inside the page — the prose IS the page, not a box floating on it.
    await expect(page.locator('.shell-editor-beta-wrap--page-mode')).toHaveCount(0);
    await expect(page.locator('.block-editor-toolbar .scene-name')).toHaveCount(0);
    await expect(page.locator('.draft-state-group')).toHaveCount(0);

    // The scene editor's prose sits inside .msv-sheet — the same page frame
    // every other depth renders into — not a separate card next to it.
    const sheet = page.getByTestId('msv-sheet');
    await expect(sheet.locator('.tiptap-editor-wrap .ProseMirror')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});
