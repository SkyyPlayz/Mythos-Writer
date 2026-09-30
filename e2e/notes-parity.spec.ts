// SKY-3204 / SKY-3209 (B6): Notes rich-mode parity with Story via the shared
// <RichTextEditor> core — Underline, entity @-mentions, and wiki-links all work
// in Notes rich mode exactly as in Story, and the lossless source-of-truth
// contract (R1) holds: source mode stays byte-faithful, rich mode is opt-in.
import path from 'path';
import os from 'os';
import fs from 'fs';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { notesPanel, noteTestId, noteViewer } from './helpers/notesPanel';
import { enableNoteViewModes } from './helpers/noteViewPrefs';

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

/** Seed an entity file so the @-mention picker has something to offer. */
function seedEntity(vaultDir: string, id: string, name: string): void {
  const dir = path.join(vaultDir, 'entities', 'characters');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    `---\nid: ${id}\nname: ${name}\ntype: character\n---\n\n${name} is a character.\n`,
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

/** M17: mode switching moved into the gear "View options" popover. */
async function switchNoteMode(page: Page, mode: 'rich' | 'markdown' | 'source'): Promise<void> {
  // F4#4: Markdown/Source are Settings-gated — enable before opening the gear.
  if (mode === 'markdown' || mode === 'source') {
    await enableNoteViewModes(page, [mode]);
  }
  await noteTestId(page, 'note-gear-btn').click();
  await expect(page.locator('[data-testid="note-gear-menu"]')).toBeVisible();
  await page.locator(`[data-testid="note-gear-mode-${mode}"]`).click();
}

async function openNoteInRichMode(page: Page, noteBaseName: string): Promise<void> {
  await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
  await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
  await page.locator('[data-testid^="vb-row-"]', { hasText: noteBaseName }).first().click();
  await expect(noteTestId(page, 'note-gear-btn')).toBeVisible({ timeout: 8_000 });
  await switchNoteMode(page, 'rich');
  await expect(noteViewer(page).locator('.ProseMirror')).toBeVisible();
}

let tempRoot: string;
let userData: string;
let vaultDir: string;
let notesDir: string;

test.beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-notes-parity-'));
  userData = path.join(tempRoot, 'userData');
  vaultDir = path.join(tempRoot, 'vault');
  notesDir = path.join(tempRoot, 'notes');
  seedUserData(userData, vaultDir, notesDir);
});

test.afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('NP-01: Notes rich mode has the shared format toolbar with a working Underline', async () => {
  const notePath = path.join(notesDir, 'underline-parity.md');
  fs.writeFileSync(notePath, 'Parity body text.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'underline-parity');

    // Shared toolbar present inside the Notes surface (drift fix: was missing Underline).
    const toolbar = page.locator('#app-tabpanel-notes .fmt-toolbar[aria-label="Text formatting"]');
    await expect(toolbar).toBeVisible();

    const editor = noteViewer(page).locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' plus ');
    const underline = toolbar.locator('button[aria-label="Underline"]');
    await underline.click();
    await expect(underline).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('underlined');
    await expect(editor.locator('u', { hasText: 'underlined' })).toBeVisible();

    // Wait past the 800ms autosave debounce; the note file must round-trip <u>.
    await expect(notesPanel(page).locator('.note-viewer-save-status')).toHaveText(/Saved/, { timeout: 8_000 });
    expect(fs.readFileSync(notePath, 'utf-8')).toContain('<u>underlined</u>');

    // Reopening rich mode must NOT trip the fidelity guard on our own <u> output.
    await switchNoteMode(page, 'source');
    await switchNoteMode(page, 'rich');
    await expect(notesPanel(page).locator('.note-fidelity-overlay')).toHaveCount(0);
    await expect(noteViewer(page).locator('.ProseMirror')).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-02: entity @-mention picker works in Notes rich mode (parity with Story)', async () => {
  seedEntity(vaultDir, 'char-elara', 'Elara');
  const notePath = path.join(notesDir, 'mention-parity.md');
  fs.writeFileSync(notePath, 'Ask about the harbor.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'mention-parity');

    const editor = noteViewer(page).locator('.ProseMirror');
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' @Ela');

    const picker = page.locator('.entity-mention-picker[aria-label="Entity suggestions"]');
    await expect(picker).toBeVisible({ timeout: 5_000 });
    await expect(picker.locator('.entity-mention-picker-name', { hasText: 'Elara' })).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(editor.locator('.entity-mention-chip', { hasText: '@Elara' })).toBeVisible();

    // The mention serializes into the note file through the shared markdown path.
    await expect(notesPanel(page).locator('.note-viewer-save-status')).toHaveText(/Saved/, { timeout: 8_000 });
    expect(fs.readFileSync(notePath, 'utf-8')).toContain('entity://char-elara');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-03: wiki-links render and click-delegate in Notes rich mode', async () => {
  const notePath = path.join(notesDir, 'wiki-parity.md');
  fs.writeFileSync(notePath, 'Linked: [[Character: Elara]] appears here.\n');

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'wiki-parity');

    const wikiLink = noteViewer(page).locator('.ProseMirror [data-wiki-link]');
    await expect(wikiLink).toBeVisible();
    await expect(wikiLink).toHaveAttribute('data-wiki-link', 'Character: Elara');

    // Clicking plain body text must NOT activate the link (the Story-only
    // plain-text fallback stays out of Notes) — the note stays open.
    await noteViewer(page).locator('.ProseMirror').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);
    await expect(noteViewer(page).locator('.ProseMirror')).toBeVisible();
    await expect(notesPanel(page).locator('.note-viewer-error')).toHaveCount(0);
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-04: source mode stays the lossless source of truth (R1) — lossy content guarded, source byte-faithful', async () => {
  const lossyBody = '---\ntitle: Guarded\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nBody.\n';
  const notePath = path.join(notesDir, 'lossless-guard.md');
  fs.writeFileSync(notePath, lossyBody);

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('nav[aria-label="Main navigation"]')).toBeVisible({ timeout: 12_000 });
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await page.locator('[data-testid^="vb-row-"]', { hasText: 'lossless-guard' }).first().click();
    await expect(noteTestId(page, 'note-gear-btn')).toBeVisible({ timeout: 8_000 });

    // Rich is opt-in: switching onto lossy content must raise the fidelity guard.
    // W0.2 (Beta 4): YAML frontmatter is no longer flagged — it is held aside
    // verbatim and never fed to (or rendered by) the Rich editor. The table in
    // the display body still triggers the guard.
    await switchNoteMode(page, 'rich');
    const guard = notesPanel(page).locator('.note-fidelity-overlay[role="dialog"]');
    await expect(guard).toBeVisible();
    await expect(guard).not.toContainText('YAML frontmatter');
    await expect(guard).toContainText('Markdown tables');

    // Choosing the safe path keeps source mode active and the file untouched.
    await guard.locator('button', { hasText: 'Edit in Source (safe)' }).click();
    await expect(notesPanel(page).locator('textarea.note-viewer-editor')).toBeVisible();
    await noteTestId(page, 'note-gear-btn').click();
    await expect(page.locator('[data-testid="note-gear-mode-source"]')).toHaveAttribute('aria-checked', 'true');
    await page.locator('.note-gear-backdrop').click();
    expect(fs.readFileSync(notePath, 'utf-8')).toBe(lossyBody);
  } finally {
    await app.close().catch(() => undefined);
  }
});

// ---------------------------------------------------------------------------
// M17 (Beta 4 "Refine") — note body parity
// ---------------------------------------------------------------------------

const GATE_NOTE = [
  '---',
  'title: The Sunken Gate',
  'tags: [location, ruins]',
  '---',
  'An ancient floodgate built by a lost civilization.',
  '',
  '> [!legend]',
  '> Sailors speak of a hum that rises from the depths on still nights.',
  '',
  '## Architecture',
  '',
  '- Massive stone arches encrusted with coral',
  '',
  '## Linked Notes',
  '',
  '[[Drownlight]] · [[Tide Mechanics]]',
].join('\n');

test('NP-05 (M17): header title/tags + gear menu + callout card + links block', async () => {
  fs.writeFileSync(path.join(notesDir, 'The Sunken Gate.md'), `${GATE_NOTE}\n`);

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'The Sunken Gate');

    // Editable Lora title (frontmatter-backed) + tag chips with add input.
    const title = noteTestId(page, 'note-title');
    await expect(title).toHaveText('The Sunken Gate');
    await expect(noteTestId(page, 'note-header-tag-location')).toBeVisible();
    await expect(noteTestId(page, 'note-header-tag-ruins')).toBeVisible();
    const tagInput = noteTestId(page, 'note-add-tag-input');
    await tagInput.fill('ancient');
    await tagInput.press('Enter');
    // SKY-9620: this chip render was intermittently missing the default 10s
    // window on contended shard-4 runners (e2e-shard-4 racing 3 sibling
    // shards + other in-flight PR runs) even though the state commit is
    // synchronous locally, under CPU stress, and on every rerun observed —
    // give it the same auto-retrying assertion with more margin instead of
    // a bare sleep.
    await expect(noteTestId(page, 'note-header-tag-ancient')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => fs.readFileSync(path.join(notesDir, 'The Sunken Gate.md'), 'utf-8'))
      .toContain('tags: [location, ruins, ancient]');

    // The simple callout renders as a purple card — no fidelity guard fired.
    await expect(notesPanel(page).locator('.note-fidelity-overlay')).toHaveCount(0);
    const callout = notesPanel(page).locator('.note-rich-editor [data-note-callout]');
    await expect(callout).toBeVisible();
    await expect(callout).toHaveAttribute('data-callout-type', 'legend');
    await expect(callout).toContainText('Sailors speak of a hum');

    // Links-only paragraph is chip-styled; frontmatter never shows in Rich.
    await expect(notesPanel(page).locator('.note-rich-editor p.note-links-block')).toBeVisible();
    await expect(notesPanel(page).locator('.note-rich-editor .ProseMirror')).not.toContainText('title:');
    await expect(notesPanel(page).locator('.note-rich-editor .ProseMirror')).not.toContainText('tags:');

    // Gear menu: Markdown view shows the raw file (frontmatter included).
    await switchNoteMode(page, 'markdown');
    await expect(page.locator('[data-testid="note-mode-banner-markdown"]')).toBeVisible();
    await expect(notesPanel(page).locator('textarea.note-viewer-editor--markdown')).toHaveValue(/title: The Sunken Gate/);

    // Editing the title writes the frontmatter field through the W0.2 engine.
    await title.click();
    await title.press('Control+a');
    await title.pressSequentially('The Risen Gate');
    await title.press('Enter');
    await expect
      .poll(() => fs.readFileSync(path.join(notesDir, 'The Sunken Gate.md'), 'utf-8'))
      .toContain('title: The Risen Gate');
  } finally {
    await app.close().catch(() => undefined);
  }
});

test('NP-06 (M17): wiki-link hover preview renders; unresolved link creates the note on click', async () => {
  fs.writeFileSync(path.join(notesDir, 'Drownlight.md'), '# Drownlight\n\nA cold blue glow beneath the waves.\n');
  fs.writeFileSync(
    path.join(notesDir, 'Hub.md'),
    'Resolved: [[Drownlight]]. Unresolved: [[Lost Civilization]].\n',
  );

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await openNoteInRichMode(page, 'Hub');

    // Resolved link is styled resolved; hovering raises the preview card.
    const resolved = noteViewer(page).locator('[data-wiki-link="Drownlight"]');
    await expect(resolved).toBeVisible();
    await expect(resolved).not.toHaveClass(/wiki-link-unresolved/);
    await resolved.hover();
    const card = page.locator('[data-testid="wiki-link-hover-preview"]');
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).toContainText('Drownlight');
    await expect(card).toContainText('cold blue glow');
    await page.mouse.move(0, 0);
    await expect(card).toHaveCount(0);

    // Unresolved link renders dashed and offers creation.
    const unresolved = noteViewer(page).locator('[data-wiki-link="Lost Civilization"]');
    await expect(unresolved).toHaveClass(/wiki-link-unresolved/);
    await unresolved.hover();
    await expect(page.locator('[data-testid="wiki-link-hover-unresolved"]')).toBeVisible({ timeout: 5_000 });
    await page.mouse.move(0, 0);

    // F2#3: unresolved click opens the create prompt; Create writes + opens.
    await unresolved.click();
    const prompt = page.locator('[data-testid="create-note-prompt"]');
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-testid="create-note-confirm"]').click();
    await expect(notesPanel(page).locator('.note-breadcrumb-item--current', { hasText: 'Lost Civilization' })).toBeVisible({ timeout: 8_000 });
    expect(fs.existsSync(path.join(notesDir, 'Lost Civilization.md'))).toBe(true);
    expect(fs.readFileSync(path.join(notesDir, 'Lost Civilization.md'), 'utf-8')).toContain('# Lost Civilization');
  } finally {
    await app.close().catch(() => undefined);
  }
});

// ── F2 Probe N1 fold — #12 into notes-parity (e2e-shard-4) ───────────────────
// Measures REAL rendered bars (±1px). OOS: window/OS frame, workspace tabs,
// bottom/status, dialog/popover headers, Story msv-toolbar (F1#13).

test('F2#12 real side/middle panel top bars are 36px (±1)', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // Story shell bars (side + middle; not msv-toolbar).
    // All matches, but only laid-out (clientHeight>0): Story B7 keep-mounts
    // with display:none under Notes → zero-height .pc-header ghosts otherwise.
    const storyBars = await page.evaluate(() => {
      const token = getComputedStyle(document.documentElement)
        .getPropertyValue('--panel-top-bar-height').trim();
      const sel = ['.lr-nav-header', '.shell-editor-toolbar', '.grs-topbar', '.pc-header'];
      const heights: Record<string, number[]> = {};
      for (const s of sel) {
        heights[s] = [...document.querySelectorAll(s)]
          .filter((el) => (el as HTMLElement).clientHeight > 0)
          .map((el) => Math.round(el.getBoundingClientRect().height));
      }
      return { token, heights };
    });
    expect(storyBars.token).toBe('36px');
    // Soft Critic: require the Story-side bars that always mount; check EVERY laid-out match.
    for (const required of ['.lr-nav-header', '.shell-editor-toolbar'] as const) {
      expect(storyBars.heights[required].length, `${required} missing`).toBeGreaterThan(0);
    }
    for (const [sel, hs] of Object.entries(storyBars.heights)) {
      for (const h of hs) {
        expect(Math.abs(h - 36), `${sel} height ${h}`).toBeLessThanOrEqual(1);
      }
    }

    // Notes shell bars. (Probe fold typo: label is "Notes Editor", not "Notes".)
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('.notes-tab-panel, .notes-tab-toolbar').first()).toBeVisible({ timeout: 8_000 });
    const notesBars = await page.evaluate(() => {
      const sel = [
        '.notes-tab-toolbar',
        '.notes-sidebar-header',
        '.vb-notes-header',
        '.notes-right-sidebar-header',
        '.pc-header',
      ];
      const heights: Record<string, number[]> = {};
      for (const s of sel) {
        heights[s] = [...document.querySelectorAll(s)]
          .filter((el) => (el as HTMLElement).clientHeight > 0)
          .map((el) => Math.round(el.getBoundingClientRect().height));
      }
      return heights;
    });
    for (const required of ['.notes-tab-toolbar', '.notes-sidebar-header'] as const) {
      expect(notesBars[required].length, `${required} missing`).toBeGreaterThan(0);
    }
    for (const [sel, hs] of Object.entries(notesBars)) {
      for (const h of hs) {
        expect(Math.abs(h - 36), `${sel} height ${h}`).toBeLessThanOrEqual(1);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});

// Critic r3 #6 / N7: at 280px the @container wrap on .pc-header-host must keep
// title width > 0, no overlaps, and action controls visible (main-clean).
test('F2 W0.3 / Critic #6: .pc-header + in-scope bars clean at 280px', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    // Standalone Brainstorm (nav-rail) mounts the full non-compact PanelHeader
    // with Agent Chat / Board switch + .pc-header-host @container. Notes embeds
    // compact Brainstorm without that switch; NotesSubView is editor-only.
    await page.locator('[data-testid="nav-rail-brainstorm"]').click();
    await expect(page.locator('[aria-labelledby="app-tab-brainstorm"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.pc-header-host .pc-header').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.pc-header .pc-header-actions button, .pc-header [role="switch"]').first())
      .toBeVisible({ timeout: 8_000 });

    const report = await page.evaluate(() => {
      const BAR_SELS = [
        '.lr-nav-header',
        '.shell-editor-toolbar',
        '.grs-topbar',
        '.notes-tab-toolbar',
        '.notes-sidebar-header',
        '.vb-notes-header',
        '.notes-right-sidebar-header',
        '.pc-header',
      ];

      function overlaps(a: DOMRect, b: DOMRect): boolean {
        return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      }

      const results: Array<{
        sel: string;
        width: number;
        titleWidth: number | null;
        switchVisible: boolean | null;
        overlap: boolean;
      }> = [];

      for (const sel of BAR_SELS) {
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          // Skip keep-mounted display:none ghosts (Story B7 under other tabs).
          if (el.clientHeight <= 0) continue;

          // Force the bar's container to 280px so @container / wrap can fire.
          const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
          const prev = host.style.width;
          host.style.width = '280px';
          host.style.minWidth = '280px';
          host.style.maxWidth = '280px';
          // Force layout.
          void host.offsetWidth;

          const rect = el.getBoundingClientRect();
          const title = el.querySelector('.pc-header-title') as HTMLElement | null;
          const titleWidth = title ? title.getBoundingClientRect().width : null;
          const actions = el.querySelector('.pc-header-actions');
          // Empty actions box (compact Notes Brainstorm) — treat as N/A.
          const switchVisible = actions && actions.querySelector('button, [role="switch"], [role="tab"], select')
            ? (() => {
              const r = actions.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })()
            : null;

          // Overlap check among direct interactive children of the header row.
          const kids = [...el.querySelectorAll<HTMLElement>('button, [role="tab"], .pc-header-title, select')];
          let overlap = false;
          for (let i = 0; i < kids.length; i++) {
            const ri = kids[i].getBoundingClientRect();
            if (ri.width < 1 || ri.height < 1) continue;
            for (let j = i + 1; j < kids.length; j++) {
              const rj = kids[j].getBoundingClientRect();
              if (rj.width < 1 || rj.height < 1) continue;
              // Same flex row only — ignore wrapped second-row siblings.
              if (Math.abs(ri.top - rj.top) > 4) continue;
              if (overlaps(ri, rj)) { overlap = true; break; }
            }
            if (overlap) break;
          }

          results.push({
            sel,
            width: Math.round(rect.width),
            titleWidth: titleWidth === null ? null : Math.round(titleWidth),
            switchVisible,
            overlap,
          });

          host.style.width = prev;
          host.style.minWidth = '';
          host.style.maxWidth = '';
        }
      }
      return results;
    });

    // Hard #6: a real laid-out .pc-header with title + switch at 280px.
    expect(report.some((r) => r.sel === '.pc-header')).toBe(true);
    expect(report.some((r) => r.sel === '.pc-header' && (r.titleWidth ?? 0) > 0)).toBe(true);
    expect(report.some((r) => r.sel === '.pc-header' && r.switchVisible === true)).toBe(true);

    for (const r of report) {
      expect(r.overlap, `${r.sel} overlaps at 280px`).toBe(false);
      if (r.titleWidth !== null) {
        expect(r.titleWidth, `${r.sel} title width`).toBeGreaterThan(0);
      }
      if (r.switchVisible !== null) {
        expect(r.switchVisible, `${r.sel} actions/switch visible`).toBe(true);
      }
    }
  } finally {
    await app.close().catch(() => undefined);
  }
});
