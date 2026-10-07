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
import { openPartnerWriterTips } from './helpers/partnerHub';

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
          .filter((el) => {
            const h = el as HTMLElement;
            // Ivy GO (b): Brainstorm headers are exempt from the F2#12 36px clamp.
            if (h.classList.contains('brainstorm-header')) return false;
            // Ivy ruling B / NH3: nested WA tip-strip header is allowed to wrap
            // under ≤320 @container — not a top-level panel bar. Exclude only
            // `.pc-header.wa-panel-header` inside `.ahp-writer-tips`.
            if (
              h.classList.contains('wa-panel-header')
              && h.closest('.ahp-writer-tips')
            ) {
              return false;
            }
            return h.clientHeight > 0;
          })
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
          .filter((el) => {
            const h = el as HTMLElement;
            // Ivy GO (b): compact Notes Agent Brainstorm is exempt — not a 36px bar.
            if (h.classList.contains('brainstorm-header')) return false;
            // Ivy ruling B / NH3: nested WA tip-strip header may wrap @≤320.
            if (
              h.classList.contains('wa-panel-header')
              && h.closest('.ahp-writer-tips')
            ) {
              return false;
            }
            return h.clientHeight > 0;
          })
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

// Ivy ruling B / NH3: nested WA tip-strip header at default GRS 300.
// Wrap under ≤320 @container is allowed, not required (unlike F2#12 36px bars).
// Cadence + Mute must stay fully visible (bbox inside header + viewport, not
// clipped by an overflow ancestor), clickable, and non-overlapping. Text
// overflow/ellipsis counts as clipped via scrollWidth > clientWidth.
test('Ivy ruling B: nested WA tip header @GRS 300 — Cadence/Mute visible+clickable', async () => {
  // Default GRS is 300; seed visibility so the hub (and tips nest) mounts.
  fs.writeFileSync(
    path.join(userData, 'app-settings.json'),
    JSON.stringify({
      onboardingComplete: true,
      theme: 'dark',
      rightSidebarVisible: true,
      rightSidebarWidth: 300,
    }, null, 2),
  );

  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    const grs = page.locator('[data-testid="global-right-sidebar"]');
    await expect(grs).toBeVisible({ timeout: 15_000 });
    const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
    await expect(hubPanel).toBeVisible({ timeout: 8_000 });
    const partnerTab = page.locator('[data-testid="ahp-tab-partner"]');
    if (await partnerTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await partnerTab.click();
    }
    await openPartnerWriterTips(page);
    const waHeader = page.locator(
      '.ahp-writer-tips .writing-assistant-panel .pc-header.wa-panel-header',
    );
    await expect(waHeader).toBeVisible({ timeout: 8_000 });

    const cadence = waHeader.locator('select.wa-cadence-select');
    const mute = waHeader.locator('button.wa-mute-btn');
    await expect(cadence).toBeVisible({ timeout: 5_000 });
    await expect(mute).toBeVisible({ timeout: 5_000 });

    // Geometry: GRS ≈300; controls fully inside header + viewport; no overflow clip.
    const geometry = await page.evaluate(() => {
      function overlaps(a: DOMRect, b: DOMRect): boolean {
        return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      }
      function inside(child: DOMRect, parent: DOMRect, tol = 1): boolean {
        return (
          child.left >= parent.left - tol
          && child.right <= parent.right + tol
          && child.top >= parent.top - tol
          && child.bottom <= parent.bottom + tol
        );
      }
      /** True when any overflow/clip ancestor cuts into the element's full bbox. */
      function clippedByOverflowAncestor(el: HTMLElement, elRect: DOMRect): boolean {
        let p: HTMLElement | null = el.parentElement;
        while (p) {
          const cs = getComputedStyle(p);
          const ox = cs.overflowX;
          const oy = cs.overflowY;
          const clips = (v: string) => v === 'hidden' || v === 'clip' || v === 'scroll' || v === 'auto';
          if (clips(ox) || clips(oy)) {
            const pr = p.getBoundingClientRect();
            const top = Math.max(elRect.top, pr.top);
            const bottom = Math.min(elRect.bottom, pr.bottom);
            const left = Math.max(elRect.left, pr.left);
            const right = Math.min(elRect.right, pr.right);
            const visW = Math.max(0, right - left);
            const visH = Math.max(0, bottom - top);
            if (visW < elRect.width - 1 || visH < elRect.height - 1) return true;
          }
          if (p.classList.contains('ahp-writer-tips')) break;
          p = p.parentElement;
        }
        return false;
      }

      const header = document.querySelector(
        '.ahp-writer-tips .writing-assistant-panel .pc-header.wa-panel-header',
      ) as HTMLElement | null;
      const cad = header?.querySelector('select.wa-cadence-select') as HTMLElement | null;
      const mut = header?.querySelector('button.wa-mute-btn') as HTMLElement | null;
      const grsEl = document.querySelector('[data-testid="global-right-sidebar"]') as HTMLElement | null;
      if (!header || !cad || !mut || !grsEl) {
        return {
          found: false,
          grsWidth: 0,
          headerHeight: 0,
          cadenceW: 0,
          muteW: 0,
          cadenceInsideHeader: false,
          muteInsideHeader: false,
          cadenceInViewport: false,
          muteInViewport: false,
          cadenceClipped: true,
          muteClipped: true,
          childOverlap: true,
          textClipOffenders: ['missing-header'],
        };
      }
      const hr = header.getBoundingClientRect();
      const cr = cad.getBoundingClientRect();
      const mr = mut.getBoundingClientRect();
      const gr = grsEl.getBoundingClientRect();
      const vp = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const kids = [...header.querySelectorAll<HTMLElement>(
        'button, [role="tab"], [role="switch"], .pc-header-title, select, input, .wa-cadence-label',
      )];
      let childOverlap = false;
      for (let i = 0; i < kids.length; i++) {
        const ri = kids[i].getBoundingClientRect();
        if (ri.width < 1 || ri.height < 1) continue;
        for (let j = i + 1; j < kids.length; j++) {
          if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue;
          const rj = kids[j].getBoundingClientRect();
          if (rj.width < 1 || rj.height < 1) continue;
          if (overlaps(ri, rj)) { childOverlap = true; break; }
        }
        if (childOverlap) break;
      }

      // Text-overflow/ellipsis: scrollWidth > clientWidth (+1) counts as clipped.
      const textClipTargets: { label: string; el: HTMLElement | null }[] = [
        { label: '.pc-header-start', el: header.querySelector('.pc-header-start') },
        { label: '.pc-header-actions', el: header.querySelector('.pc-header-actions') },
        { label: '.pc-header-title', el: header.querySelector('.pc-header-title') },
        { label: '.wa-header-title', el: header.querySelector('.wa-header-title') },
        { label: '.wa-header-context', el: header.querySelector('.wa-header-context') },
        { label: '.wa-cadence-label', el: header.querySelector('.wa-cadence-label') },
        { label: 'select.wa-cadence-select', el: cad },
        { label: 'button.wa-mute-btn', el: mut },
      ];
      // Title text spans (incl. nested context) under the title group.
      for (const span of header.querySelectorAll<HTMLElement>(
        '.pc-header-title span, .pc-header-title-group span, .wa-header-title, .wa-header-context',
      )) {
        const cls = span.className ? `.${String(span.className).trim().split(/\s+/).join('.')}` : 'span';
        textClipTargets.push({ label: `title-span${cls}`, el: span });
      }
      const textClipOffenders: string[] = [];
      const seen = new Set<HTMLElement>();
      for (const { label, el } of textClipTargets) {
        if (!el || seen.has(el)) continue;
        seen.add(el);
        if (el.clientWidth < 1 && el.clientHeight < 1) continue;
        if (el.scrollWidth > el.clientWidth + 1) {
          textClipOffenders.push(
            `${label} scrollWidth=${el.scrollWidth} clientWidth=${el.clientWidth}`,
          );
        }
      }

      return {
        found: true,
        grsWidth: Math.round(gr.width),
        headerHeight: Math.round(hr.height),
        cadenceW: Math.round(cr.width),
        muteW: Math.round(mr.width),
        cadenceInsideHeader: inside(cr, hr),
        muteInsideHeader: inside(mr, hr),
        cadenceInViewport: inside(cr, vp),
        muteInViewport: inside(mr, vp),
        cadenceClipped: clippedByOverflowAncestor(cad, cr),
        muteClipped: clippedByOverflowAncestor(mut, mr),
        childOverlap,
        textClipOffenders,
      };
    });

    expect(geometry.found, 'nested WA tip header + Cadence/Mute must mount').toBe(true);
    expect(Math.abs(geometry.grsWidth - 300), `GRS width ${geometry.grsWidth}`).toBeLessThanOrEqual(8);
    // Wrap is allowed, not required (NH3 / Ivy ruling B) — log height only.
    console.log(`Ivy ruling B nested WA tip headerHeight@GRS300=${geometry.headerHeight}`);
    expect(geometry.cadenceW, `Cadence width ${geometry.cadenceW}`).toBeGreaterThanOrEqual(40);
    expect(geometry.muteW, `Mute width ${geometry.muteW}`).toBeGreaterThanOrEqual(40);
    expect(geometry.cadenceInsideHeader, 'Cadence bbox must be inside WA header').toBe(true);
    expect(geometry.muteInsideHeader, 'Mute bbox must be inside WA header').toBe(true);
    expect(geometry.cadenceInViewport, 'Cadence bbox must be inside viewport').toBe(true);
    expect(geometry.muteInViewport, 'Mute bbox must be inside viewport').toBe(true);
    expect(geometry.cadenceClipped, 'Cadence must not be clipped by overflow ancestor').toBe(false);
    expect(geometry.muteClipped, 'Mute must not be clipped by overflow ancestor').toBe(false);
    expect(geometry.childOverlap, 'nested WA header children must not overlap').toBe(false);
    expect(
      geometry.textClipOffenders,
      `header child text clipped (scrollWidth>clientWidth): ${geometry.textClipOffenders.join('; ')}`,
    ).toEqual([]);

    // Real click: Mute must be hittable (not covered) and toggle aria-pressed.
    const before = await mute.getAttribute('aria-pressed');
    await mute.click({ timeout: 5_000 });
    await expect.poll(async () => mute.getAttribute('aria-pressed')).not.toBe(before);
    // Cadence select: centre hit-test must land on the select (or a child of it).
    const cadenceHit = await page.evaluate(() => {
      const cad = document.querySelector(
        '.ahp-writer-tips .writing-assistant-panel .pc-header.wa-panel-header select.wa-cadence-select',
      ) as HTMLElement | null;
      if (!cad) return false;
      const r = cad.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && (hit === cad || cad.contains(hit)));
    });
    expect(cadenceHit, 'Cadence select centre must be clickable (not covered)').toBe(true);
    await cadence.selectOption('300');
    await expect(cadence).toHaveValue('300');
  } finally {
    await app.close().catch(() => undefined);
  }
});

// Critic r3 #6 / N7 + Probe H2 + Critic hard 1/3 + Ivy tip-form:
// Measure Story, Notes, AND Brainstorm tabs so the seven non-pc bars are not
// skipped via clientHeight<=0 ghosts. Require ≥1 laid-out match per selector.
// Overlap set includes input + [role=switch]; no "different row" skip; every
// control must stay inside its bar. Brainstorm host widths: 280/400/500/600
// plus Critic hard 3 / Ivy guards at 700 and 1000 (no clip, title > 0).
// Ivy: at ≥701 match main — height at 1000 and 1440 within ~2px of main's
// measured values (Probe main c5ea5d4c: 77px board / 77px at both widths).
test('F2 W0.3 / Critic #6 / Probe H2 / Critic hard 1+3: bars clean across tabs', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    const STORY_SELS = [
      '.lr-nav-header',
      '.shell-editor-toolbar',
      '.grs-topbar',
      '.pc-header',
    ] as const;
    const NOTES_SELS = [
      '.notes-tab-toolbar',
      '.notes-sidebar-header',
      '.vb-notes-header',
      '.notes-right-sidebar-header',
      '.pc-header',
    ] as const;
    const BRAINSTORM_SELS = ['.pc-header'] as const;
    const ALL_NON_PC = [
      '.lr-nav-header',
      '.shell-editor-toolbar',
      '.grs-topbar',
      '.notes-tab-toolbar',
      '.notes-sidebar-header',
      '.vb-notes-header',
      '.notes-right-sidebar-header',
    ] as const;

    // Probe VERIFY FAIL 5372190174 — main c5ea5d4c Brainstorm header heights
    // (board mode). Tip must stay within ~2px at 1000 and 1440.
    const MAIN_BRAINSTORM_HEADER_H_1000 = 77;
    const MAIN_BRAINSTORM_HEADER_H_1440 = 77;

    type BarReport = {
      sel: string;
      height: number;
      titleWidth: number | null;
      switchVisible: boolean | null;
      overlap: boolean;
      controlOutside: boolean;
      clipped: boolean;
    };

    async function measure(sels: readonly string[], width: number): Promise<BarReport[]> {
      return page.evaluate(({ selectors, hostWidth }) => {
        function overlaps(a: DOMRect, b: DOMRect): boolean {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        function inside(child: DOMRect, bar: DOMRect): boolean {
          return (
            child.left >= bar.left - 1
            && child.right <= bar.right + 1
            && child.top >= bar.top - 1
            && child.bottom <= bar.bottom + 1
          );
        }

        const results: BarReport[] = [];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll<HTMLElement>(sel)) {
            // Skip keep-mounted display:none ghosts (Story B7 under other tabs).
            if (el.clientHeight <= 0) continue;

            const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
            const prevW = host.style.width;
            const prevMin = host.style.minWidth;
            const prevMax = host.style.maxWidth;
            host.style.width = `${hostWidth}px`;
            host.style.minWidth = `${hostWidth}px`;
            host.style.maxWidth = `${hostWidth}px`;
            void host.offsetWidth;

            const rect = el.getBoundingClientRect();
            const title = el.querySelector('.pc-header-title') as HTMLElement | null;
            const titleWidth = title ? title.getBoundingClientRect().width : null;
            const titleGroup = el.querySelector('.pc-header-title-group') as HTMLElement | null;
            const tg = titleGroup?.getBoundingClientRect();
            // Critic hard 3: title group must not be clipped by max-height/overflow.
            const clipped = Boolean(
              tg && (tg.bottom > rect.bottom + 1 || tg.top < rect.top - 1),
            );
            const actions = el.querySelector('.pc-header-actions');
            const switchVisible = actions && actions.querySelector(
              'button, [role="switch"], [role="tab"], select, input',
            )
              ? (() => {
                const r = actions.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              })()
              : null;

            // Critic hard 1: include [role=switch] + input; NO different-row skip.
            const kids = [...el.querySelectorAll<HTMLElement>(
              'button, [role="tab"], [role="switch"], .pc-header-title, select, input',
            )];
            let overlap = false;
            let controlOutside = false;
            for (let i = 0; i < kids.length; i++) {
              const ri = kids[i].getBoundingClientRect();
              if (ri.width < 1 || ri.height < 1) continue;
              if (!inside(ri, rect)) controlOutside = true;
              for (let j = i + 1; j < kids.length; j++) {
                if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue;
                const rj = kids[j].getBoundingClientRect();
                if (rj.width < 1 || rj.height < 1) continue;
                if (overlaps(ri, rj)) { overlap = true; break; }
              }
              if (overlap) break;
            }

            results.push({
              sel,
              height: Math.round(rect.height),
              titleWidth: titleWidth === null ? null : Math.round(titleWidth),
              switchVisible,
              overlap,
              controlOutside,
              clipped,
            });

            host.style.width = prevW;
            host.style.minWidth = prevMin;
            host.style.maxWidth = prevMax;
          }
        }
        return results;
      }, { selectors: [...sels], hostWidth: width });
    }

    function assertClean(report: BarReport[], sels: readonly string[], width: number, opts?: { requirePc?: boolean }) {
      for (const sel of sels) {
        expect(
          report.some((r) => r.sel === sel),
          `${sel} missing laid-out match at ${width}px`,
        ).toBe(true);
      }
      if (opts?.requirePc) {
        expect(
          report.some((r) => r.sel === '.pc-header' && (r.titleWidth ?? 0) > 0),
          `pc-header title 0 at ${width}px`,
        ).toBe(true);
        expect(
          report.some((r) => r.sel === '.pc-header' && r.switchVisible === true),
          `pc-header actions missing at ${width}px`,
        ).toBe(true);
      }
      for (const r of report) {
        expect(r.overlap, `${r.sel} overlaps at ${width}px`).toBe(false);
        expect(r.controlOutside, `${r.sel} control outside bar at ${width}px`).toBe(false);
        expect(r.clipped, `${r.sel} title clipped at ${width}px`).toBe(false);
        if (r.titleWidth !== null) {
          expect(r.titleWidth, `${r.sel} title width at ${width}px`).toBeGreaterThan(0);
        }
      }
    }

    // ── Story tab @ 280 ──────────────────────────────────────────────────
    // Default boot lands on Story Writer.
    await expect(page.locator('.lr-nav-header, .shell-editor-toolbar').first()).toBeVisible({ timeout: 8_000 });
    const story280 = await measure(STORY_SELS, 280);
    assertClean(story280, STORY_SELS.filter((s) => s !== '.pc-header'), 280);
    // Continuity/GRS .pc-header may or may not be present; when laid out, clean.
    for (const r of story280.filter((x) => x.sel === '.pc-header')) {
      expect(r.overlap).toBe(false);
      expect(r.controlOutside).toBe(false);
      expect(r.clipped).toBe(false);
    }

    // ── NH3: non-Brainstorm PanelHeader wrap @280 (WA / Continuity / AR) ──
    // Critic: ≤320px `.pc-header` wrap must have a real-layout guard — removing
    // PanelChrome.css @container (max-width: 320px) turns this red. Open Writing
    // Coach so a WA `.pc-header` is laid out and measured (not Brainstorm).
    {
      const hubPanel = page.locator('[data-testid="agent-hub-panel"]');
      await expect(hubPanel).toBeVisible({ timeout: 8_000 });
      const partnerTab = page.locator('[data-testid="ahp-tab-partner"]');
      if (await partnerTab.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await partnerTab.click();
      }
      const waPanel = page.locator('.writing-assistant-panel');
      if ((await waPanel.count()) === 0) {
        await openPartnerWriterTips(page);
      }
      await expect(page.locator('.writing-assistant-panel .pc-header.wa-panel-header')).toBeVisible({
        timeout: 8_000,
      });
      const wa280 = await page.evaluate(() => {
        function overlaps(a: DOMRect, b: DOMRect): boolean {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        function inside(child: DOMRect, bar: DOMRect): boolean {
          return (
            child.left >= bar.left - 1
            && child.right <= bar.right + 1
            && child.top >= bar.top - 1
            && child.bottom <= bar.bottom + 1
          );
        }
        const el = document.querySelector(
          '.writing-assistant-panel .pc-header.wa-panel-header',
        ) as HTMLElement | null;
        if (!el) {
          return { found: false, height: 0, titleWidth: 0, overlap: true, controlOutside: true, clipped: true, wrapped: false };
        }
        const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
        const prevW = host.style.width;
        const prevMin = host.style.minWidth;
        const prevMax = host.style.maxWidth;
        host.style.width = '280px';
        host.style.minWidth = '280px';
        host.style.maxWidth = '280px';
        void host.offsetWidth;
        const rect = el.getBoundingClientRect();
        const title = el.querySelector('.pc-header-title') as HTMLElement | null;
        const titleGroup = el.querySelector('.pc-header-title-group') as HTMLElement | null;
        const tg = titleGroup?.getBoundingClientRect();
        const titleWidth = title ? title.getBoundingClientRect().width : 0;
        const clipped = Boolean(tg && (tg.bottom > rect.bottom + 1 || tg.top < rect.top - 1));
        const kids = [...el.querySelectorAll<HTMLElement>(
          'button, [role="tab"], [role="switch"], .pc-header-title, select, input',
        )];
        let overlap = false;
        let controlOutside = false;
        for (let i = 0; i < kids.length; i++) {
          const ri = kids[i].getBoundingClientRect();
          if (ri.width < 1 || ri.height < 1) continue;
          if (!inside(ri, rect)) controlOutside = true;
          for (let j = i + 1; j < kids.length; j++) {
            if (kids[i].contains(kids[j]) || kids[j].contains(kids[i])) continue;
            const rj = kids[j].getBoundingClientRect();
            if (rj.width < 1 || rj.height < 1) continue;
            if (overlaps(ri, rj)) { overlap = true; break; }
          }
          if (overlap) break;
        }
        const start = el.querySelector('.pc-header-start') as HTMLElement | null;
        const actions = el.querySelector('.pc-header-actions') as HTMLElement | null;
        const sr = start?.getBoundingClientRect();
        const ar = actions?.getBoundingClientRect();
        // Wrap guard: actions sit on a second row below start (≤320 @container).
        const wrapped = Boolean(
          sr && ar && ar.top >= sr.bottom - 2 && Math.round(rect.height) > 40,
        );
        host.style.width = prevW;
        host.style.minWidth = prevMin;
        host.style.maxWidth = prevMax;
        return {
          found: true,
          height: Math.round(rect.height),
          titleWidth: Math.round(titleWidth),
          overlap,
          controlOutside,
          clipped,
          wrapped,
        };
      });
      expect(wa280.found, 'WA .pc-header must be laid out for NH3').toBe(true);
      expect(wa280.titleWidth, 'WA title width @280').toBeGreaterThan(0);
      expect(wa280.overlap, 'WA header overlaps @280 (NH3 wrap missing?)').toBe(false);
      expect(wa280.controlOutside, 'WA control outside bar @280').toBe(false);
      expect(wa280.clipped, 'WA title clipped @280').toBe(false);
      expect(wa280.wrapped, 'WA header must wrap at 280 (≤320 @container)').toBe(true);
    }

    // ── Notes tab @ 280 ──────────────────────────────────────────────────
    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('.notes-tab-panel, .notes-tab-toolbar').first()).toBeVisible({ timeout: 8_000 });
    const notes280 = await measure(NOTES_SELS, 280);
    assertClean(
      notes280,
      NOTES_SELS.filter((s) => s !== '.pc-header'),
      280,
    );
    for (const r of notes280.filter((x) => x.sel === '.pc-header')) {
      expect(r.overlap).toBe(false);
      expect(r.controlOutside).toBe(false);
      expect(r.clipped).toBe(false);
    }

    // Critic hard 1: every one of the seven non-pc bars must have been
    // measured across Story + Notes (not skipped as zero-height ghosts).
    const seenNonPc = new Set(
      [...story280, ...notes280].map((r) => r.sel).filter((s) => (ALL_NON_PC as readonly string[]).includes(s)),
    );
    for (const sel of ALL_NON_PC) {
      expect(seenNonPc.has(sel), `non-pc bar never measured: ${sel}`).toBe(true);
    }

    // ── Brainstorm @ 280/400/500/600/700/1000 (+ one-row @ 701–1440) ─────
    await page.locator('[data-testid="nav-rail-brainstorm"]').click();
    const bsPanelHeights = page.locator('#app-tabpanel-brainstorm');
    await expect(bsPanelHeights).toBeVisible({ timeout: 8_000 });
    await expect(
      bsPanelHeights.locator('.pc-header-host .pc-header.brainstorm-header:not(.brainstorm-header--compact)'),
    ).toBeVisible({ timeout: 8_000 });
    // Ivy ruling 4: mode seg may be display:none @≤999 (⋯ instead) — wait on
    // New Session (always present; avoid multi-match mute|new-session).
    await expect(
      bsPanelHeights.getByRole('button', { name: 'New Session' }),
    ).toBeVisible({ timeout: 8_000 });

    for (const hostWidth of [280, 400, 500, 600, 700, 1000] as const) {
      const report = await measure(BRAINSTORM_SELS, hostWidth);
      assertClean(report, BRAINSTORM_SELS, hostWidth, { requirePc: true });
    }

    // Ivy HARD: ≥701 ONE row; report heights at 701/900/1000/1100/1440;
    // 1000 & 1440 within ~2px of main 77.
    type HeightReport = { width: number; height: number; oneRow: boolean; titleWidth: number };
    async function measureStandaloneHeights(widths: readonly number[]): Promise<HeightReport[]> {
      return page.evaluate((ws) => {
        const el = document.querySelector(
          '#app-tabpanel-brainstorm .pc-header-host .pc-header.brainstorm-header:not(.brainstorm-header--compact)',
        ) as HTMLElement | null;
        if (!el) return ws.map((width) => ({ width, height: 0, oneRow: false, titleWidth: 0 }));
        const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
        const prevW = host.style.width;
        const prevMin = host.style.minWidth;
        const prevMax = host.style.maxWidth;
        const out: HeightReport[] = [];
        for (const width of ws) {
          host.style.width = `${width}px`;
          host.style.minWidth = `${width}px`;
          host.style.maxWidth = `${width}px`;
          void host.offsetWidth;
          const rect = el.getBoundingClientRect();
          const start = el.querySelector('.pc-header-start') as HTMLElement | null;
          const actions = el.querySelector('.pc-header-actions') as HTMLElement | null;
          const sr = start?.getBoundingClientRect();
          const ar = actions?.getBoundingClientRect();
          // One row: action midY sits inside the start band (center-align can
          // offset tops when title+subtitle are taller than the controls).
          // A wrapped second actions row lands clearly below start.bottom.
          const midY = ar ? (ar.top + ar.bottom) / 2 : NaN;
          const oneRow = Boolean(
            sr && ar
            && midY >= sr.top - 2
            && midY <= sr.bottom + 2
            && Math.round(rect.height) <= 90,
          );
          const title = el.querySelector('.pc-header-title') as HTMLElement | null;
          out.push({
            width,
            height: Math.round(rect.height),
            oneRow,
            titleWidth: title ? Math.round(title.getBoundingClientRect().width) : 0,
          });
        }
        host.style.width = prevW;
        host.style.minWidth = prevMin;
        host.style.maxWidth = prevMax;
        return out;
      }, widths);
    }

    const heightWidths = [701, 900, 1000, 1100, 1440] as const;
    const heightReports = await measureStandaloneHeights(heightWidths);
    await test.info().attach('standalone-brainstorm-header-heights.json', {
      body: Buffer.from(JSON.stringify(heightReports, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    // eslint-disable-next-line no-console
    console.log('[standalone Brainstorm heights]', JSON.stringify(heightReports));

    for (const r of heightReports) {
      expect(r.titleWidth, `standalone title @${r.width}`).toBeGreaterThan(0);
      expect(r.oneRow, `standalone must be ONE row @${r.width} (h=${r.height})`).toBe(true);
      // One-row band around main's 77 (padding + title/subtitle); two-row would be ≫90.
      expect(r.height, `standalone one-row height @${r.width}`).toBeGreaterThanOrEqual(60);
      expect(r.height, `standalone one-row height @${r.width}`).toBeLessThanOrEqual(90);
    }

    const h1000 = heightReports.find((r) => r.width === 1000)?.height;
    const h1440 = heightReports.find((r) => r.width === 1440)?.height;
    // Playwright expect has no toBeTypeOf (vitest-only).
    expect(typeof h1000, 'brainstorm header height at 1000').toBe('number');
    expect(typeof h1440, 'brainstorm header height at 1440').toBe('number');
    expect(
      Math.abs((h1000 as number) - MAIN_BRAINSTORM_HEADER_H_1000),
      `brainstorm header @1000 tip=${h1000} main=${MAIN_BRAINSTORM_HEADER_H_1000}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs((h1440 as number) - MAIN_BRAINSTORM_HEADER_H_1440),
      `brainstorm header @1440 tip=${h1440} main=${MAIN_BRAINSTORM_HEADER_H_1440}`,
    ).toBeLessThanOrEqual(2);
    assertClean(await measure(BRAINSTORM_SELS, 1440), BRAINSTORM_SELS, 1440, { requirePc: true });
  } finally {
    await app.close().catch(() => undefined);
  }
});

// Ivy ruling 4 (amended): standalone AI-on chat AND board @701/760/880/920/
// 950/1000 — one row, no overlap among Back, title, Session pill (chat), ⋯;
// mode in ⋯ at ≤999 and inline at ≥1000; real hit-test click on Back at each
// width. ≤700 two-row wrap is accepted elsewhere (W0.3 test) when clean.
test('Ivy ruling 4: standalone chat+board no overlap at 701–1000 + Back hit-test', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="nav-rail-brainstorm"]').click();
    // Keep-alive: scope to standalone tab — never compact GRS/split clones.
    const bsPanel = page.locator('#app-tabpanel-brainstorm');
    await expect(bsPanel).toBeVisible({ timeout: 8_000 });
    await expect(
      bsPanel.locator('.pc-header-host .pc-header.brainstorm-header:not(.brainstorm-header--compact)'),
    ).toBeVisible({ timeout: 8_000 });
    // Chat is default when AI is on — New Session stays visible; mode seg may be in ⋯.
    await expect(
      bsPanel.getByRole('button', { name: 'New Session' }),
    ).toBeVisible({ timeout: 5_000 });

    type ModeReport = {
      width: number;
      mode: 'chat' | 'board';
      height: number;
      titleVisible: boolean;
      backVisible: boolean;
      sessionVisible: boolean | null;
      overflowVisible: boolean;
      modePlacement: 'inline' | 'overflow';
      overlap: boolean;
      backHitOk: boolean;
    };

    async function measureMode(width: number, mode: 'chat' | 'board'): Promise<ModeReport> {
      // Ensure the requested mode without relying on viewport (⋯ vs inline).
      const inlineSeg = bsPanel.locator('[data-testid="bsc-mode-seg-inline"]');
      const overflowBtn = bsPanel.locator('[data-testid="brainstorm-header-overflow-standalone"]');
      if (await inlineSeg.isVisible().catch(() => false)) {
        await bsPanel.locator(`[data-testid="bsc-mode-seg-inline"] [data-testid="bsc-mode-${mode}"]`).click();
      } else if (await overflowBtn.isVisible().catch(() => false)) {
        const menu = page.locator('[data-testid="brainstorm-header-overflow-standalone-menu"]');
        if (!(await menu.isVisible().catch(() => false))) await overflowBtn.click();
        await expect(menu).toBeVisible({ timeout: 3_000 });
        await page
          .locator(`[data-testid="brainstorm-header-overflow-standalone-menu"] [data-testid="bsc-mode-${mode}"]`)
          .click();
        // Menu closes after choice; wait a tick for layout.
        await expect(menu).toBeHidden({ timeout: 3_000 }).catch(() => undefined);
      }

      return page.evaluate(({ w, m }) => {
        function overlaps(a: DOMRect, b: DOMRect): boolean {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        const el = document.querySelector(
          '#app-tabpanel-brainstorm .pc-header-host .pc-header.brainstorm-header:not(.brainstorm-header--compact)',
        ) as HTMLElement | null;
        if (!el) {
          return {
            width: w, mode: m, height: 0, titleVisible: false, backVisible: false,
            sessionVisible: null, overflowVisible: false,
            modePlacement: 'overflow' as const, overlap: true, backHitOk: false,
          };
        }
        const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
        const prevW = host.style.width;
        const prevMin = host.style.minWidth;
        const prevMax = host.style.maxWidth;
        host.style.width = `${w}px`;
        host.style.minWidth = `${w}px`;
        host.style.maxWidth = `${w}px`;
        void host.offsetWidth;
        const rect = el.getBoundingClientRect();
        const back = el.querySelector('.brainstorm-back-btn, [aria-label="Close brainstorm"]') as HTMLElement | null;
        const title = el.querySelector('.pc-header-title') as HTMLElement | null;
        const session = el.querySelector('.bs-session-pill, .asp-root.bs-session-pill, .asp-pill') as HTMLElement | null;
        const seg = el.querySelector('[data-testid="bsc-mode-seg-inline"]') as HTMLElement | null;
        const overflow = el.querySelector('[data-testid="brainstorm-header-overflow-standalone"]') as HTMLElement | null;
        const br = back?.getBoundingClientRect();
        const tr = title?.getBoundingClientRect();
        const sessR = session?.getBoundingClientRect();
        const sr = seg?.getBoundingClientRect();
        const or = overflow?.getBoundingClientRect();
        const backVisible = Boolean(br && br.width > 0 && br.height > 0);
        const titleVisible = Boolean(tr && tr.width > 0 && tr.height > 0);
        const sessionVisible = m === 'chat'
          ? Boolean(sessR && sessR.width > 0 && sessR.height > 0)
          : null;
        const segVisible = Boolean(sr && sr.width > 0 && sr.height > 0);
        const overflowVisible = Boolean(or && or.width > 0 && or.height > 0);
        const modePlacement = segVisible ? 'inline' as const : 'overflow' as const;

        // Overlap set: Back, title, Session pill (chat), ⋯ — skip nested pairs
        // (Session lives inside .pc-header-title).
        const parts: Array<{ el: HTMLElement; r: DOMRect }> = [];
        if (backVisible && br && back) parts.push({ el: back, r: br });
        if (titleVisible && tr && title) parts.push({ el: title, r: tr });
        if (sessionVisible && sessR && session) parts.push({ el: session, r: sessR });
        if (overflowVisible && or && overflow) parts.push({ el: overflow, r: or });
        let overlap = false;
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            if (parts[i].el.contains(parts[j].el) || parts[j].el.contains(parts[i].el)) continue;
            if (overlaps(parts[i].r, parts[j].r)) { overlap = true; break; }
          }
          if (overlap) break;
        }

        // Real hit-test: elementFromPoint at Back centre must be Back (or inside it).
        let backHitOk = false;
        if (backVisible && br && back) {
          const cx = br.left + br.width / 2;
          const cy = br.top + br.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          backHitOk = Boolean(hit && (hit === back || back.contains(hit)));
        }

        host.style.width = prevW;
        host.style.minWidth = prevMin;
        host.style.maxWidth = prevMax;
        return {
          width: w,
          mode: m,
          height: Math.round(rect.height),
          titleVisible,
          backVisible,
          sessionVisible,
          overflowVisible,
          modePlacement,
          overlap,
          backHitOk,
        };
      }, { w: width, m: mode });
    }

    const widths = [701, 760, 880, 920, 950, 1000] as const;
    const reports: ModeReport[] = [];
    for (const mode of ['chat', 'board'] as const) {
      for (const w of widths) {
        const m = await measureMode(w, mode);
        reports.push(m);
        expect(m.backVisible, `Back visible @${w} ${mode}`).toBe(true);
        expect(m.titleVisible, `title visible @${w} ${mode}`).toBe(true);
        expect(m.overlap, `no Back/title/Session/⋯ overlap @${w} ${mode}`).toBe(false);
        expect(m.backHitOk, `Back hit-test @${w} ${mode}`).toBe(true);
        expect(m.height, `one-row height @${w} ${mode}`).toBeGreaterThanOrEqual(60);
        expect(m.height, `one-row height @${w} ${mode}`).toBeLessThanOrEqual(90);
        if (w <= 999) {
          expect(m.modePlacement, `mode in overflow @${w} ${mode}`).toBe('overflow');
          expect(m.overflowVisible, `⋯ visible @${w} ${mode}`).toBe(true);
        } else {
          expect(m.modePlacement, `mode inline @${w} ${mode}`).toBe('inline');
        }
        if (mode === 'chat') {
          expect(m.sessionVisible, `Session pill visible @${w} chat`).toBe(true);
        }
      }
    }

    // Real mouse click on Back centre at each width (chat) navigates away, then
    // re-enter Brainstorm for the next width.
    for (const w of widths) {
      await page.locator('[data-testid="nav-rail-brainstorm"]').click();
      await expect(page.locator(
        '.pc-header-host .pc-header.brainstorm-header:not(.brainstorm-header--compact)',
      ).first()).toBeVisible({ timeout: 8_000 });
      await page.evaluate((width) => {
        const el = document.querySelector(
          '.pc-header-host .pc-header.brainstorm-header:not(.brainstorm-header--compact)',
        ) as HTMLElement | null;
        const host = (el?.closest('.pc-header-host') as HTMLElement | null) ?? el;
        if (host) {
          host.style.width = `${width}px`;
          host.style.minWidth = `${width}px`;
          host.style.maxWidth = `${width}px`;
        }
      }, w);
      const back = page.locator(
        '.pc-header.brainstorm-header:not(.brainstorm-header--compact) .brainstorm-back-btn, .pc-header.brainstorm-header:not(.brainstorm-header--compact) [aria-label="Close brainstorm"]',
      ).first();
      await expect(back).toBeVisible();
      const box = await back.boundingBox();
      expect(box, `Back hit target @${w}`).toBeTruthy();
      await page.mouse.click((box!.x + box!.width / 2), (box!.y + box!.height / 2));
      await expect(page.locator('[aria-labelledby="app-tab-brainstorm"]')).not.toBeVisible({ timeout: 5_000 });
    }

    await test.info().attach('ivy-ruling4-standalone-header.json', {
      body: Buffer.from(JSON.stringify(reports, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    // eslint-disable-next-line no-console
    console.log('[Ivy ruling 4 chat+board header]', JSON.stringify(reports));
  } finally {
    await app.close().catch(() => undefined);
  }
});

// Critic hard 2 / Ivy GO (b): Notes Agent compact Brainstorm exempt from 36px
// clamp — title/subtitle readable, preset out of Back hit area, height in the
// main-like unclamped band. Guard natural + 340/500/700; click Back navigates.
test('Critic hard 2: Notes Agent compact Brainstorm header readable at natural/340/500/700', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="notes-brainstorm-panel"]')).toBeVisible({ timeout: 8_000 });
    // Agent tab is default when AI is on.
    await expect(page.locator('[data-testid="notes-agent-chat"]')).toBeVisible({ timeout: 8_000 });
    const compactHeader = page.locator(
      '[data-testid="notes-agent-chat"] .pc-header.brainstorm-header--compact',
    );
    await expect(compactHeader).toBeVisible({ timeout: 8_000 });

    // Notes Agent sidebar is 340px (RIGHT_SIDEBAR_W) — natural === 340.
    // Per-width ceilings = main's measured compact .pc-header heights
    // (Electron, origin/main @ 3ec964a1): 107 @ natural/340, 75 @ 500/700.
    // Same ±2 tolerance as standalone 1000/1440 vs main 77. Clamp (~36) RED.
    const MAIN_COMPACT_H: Record<string, number> = {
      natural: 107,
      '340': 107,
      '500': 75,
      '700': 75,
    };

    type CompactReport = {
      width: string;
      height: number;
      titleWidth: number;
      subtitleWidth: number;
      subtitleClipped: boolean;
      backPresetOverlap: boolean;
      backVisible: boolean;
      presetVisible: boolean;
      controlOutside: boolean;
    };

    async function measureCompact(hostWidth: number | 'natural'): Promise<CompactReport> {
      return page.evaluate(({ width }) => {
        function overlaps(a: DOMRect, b: DOMRect): boolean {
          return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
        }
        function inside(child: DOMRect, bar: DOMRect): boolean {
          return (
            child.left >= bar.left - 1
            && child.right <= bar.right + 1
            && child.top >= bar.top - 1
            && child.bottom <= bar.bottom + 1
          );
        }
        const el = document.querySelector(
          '[data-testid="notes-agent-chat"] .pc-header.brainstorm-header--compact',
        ) as HTMLElement | null;
        const label = width === 'natural' ? 'natural' : `${width}px`;
        if (!el) {
          return {
            width: label,
            height: 0,
            titleWidth: 0,
            subtitleWidth: 0,
            subtitleClipped: true,
            backPresetOverlap: true,
            backVisible: false,
            presetVisible: false,
            controlOutside: true,
          };
        }
        const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
        const prevW = host.style.width;
        const prevMin = host.style.minWidth;
        const prevMax = host.style.maxWidth;
        if (width !== 'natural') {
          host.style.width = `${width}px`;
          host.style.minWidth = `${width}px`;
          host.style.maxWidth = `${width}px`;
          void host.offsetWidth;
        }
        const rect = el.getBoundingClientRect();
        const title = el.querySelector('.pc-header-title') as HTMLElement | null;
        const subtitle = el.querySelector('.pc-header-subtitle') as HTMLElement | null;
        const titleWidth = title ? title.getBoundingClientRect().width : 0;
        const subtitleWidth = subtitle ? subtitle.getBoundingClientRect().width : 0;
        const titleGroup = el.querySelector('.pc-header-title-group') as HTMLElement | null;
        const tg = titleGroup?.getBoundingClientRect();
        const subtitleClipped = Boolean(
          tg && (tg.bottom > rect.bottom + 1 || tg.top < rect.top - 1 || tg.height < 1),
        );
        const back = el.querySelector('.brainstorm-back-btn, [aria-label="Close brainstorm"]') as HTMLElement | null;
        const preset = el.querySelector('.brainstorm-header-preset') as HTMLElement | null;
        const actionsKids = [...el.querySelectorAll<HTMLElement>(
          '.pc-header-actions button, .pc-header-actions select, .pc-header-actions [role="switch"], .brainstorm-header-preset',
        )];
        let backPresetOverlap = false;
        const backRect = back?.getBoundingClientRect();
        const backVisible = Boolean(backRect && backRect.width > 0 && backRect.height > 0);
        const presetRect = preset?.getBoundingClientRect();
        const presetVisible = Boolean(presetRect && presetRect.width > 0 && presetRect.height > 0);
        if (back && backVisible) {
          const br = back.getBoundingClientRect();
          for (const a of actionsKids) {
            const ar = a.getBoundingClientRect();
            if (ar.width < 1 || ar.height < 1) continue;
            if (overlaps(br, ar)) { backPresetOverlap = true; break; }
          }
          if (!backPresetOverlap && preset) {
            const pr = preset.getBoundingClientRect();
            if (pr.width >= 1 && pr.height >= 1 && overlaps(br, pr)) backPresetOverlap = true;
          }
        }
        let controlOutside = false;
        for (const kid of el.querySelectorAll<HTMLElement>(
          'button, [role="switch"], .pc-header-title, select, input',
        )) {
          const kr = kid.getBoundingClientRect();
          if (kr.width < 1 || kr.height < 1) continue;
          if (!inside(kr, rect)) { controlOutside = true; break; }
        }
        host.style.width = prevW;
        host.style.minWidth = prevMin;
        host.style.maxWidth = prevMax;
        return {
          width: label,
          height: Math.round(rect.height),
          titleWidth: Math.round(titleWidth),
          subtitleWidth: Math.round(subtitleWidth),
          subtitleClipped,
          backPresetOverlap,
          backVisible,
          presetVisible,
          controlOutside,
        };
      }, { width: hostWidth });
    }

    const widths: Array<number | 'natural'> = ['natural', 340, 500, 700];
    const reports: CompactReport[] = [];
    for (const w of widths) {
      const r = await measureCompact(w);
      reports.push(r);
      const key = w === 'natural' ? 'natural' : String(w);
      const label = r.width;
      // Clamp restore → ~36 and RED. Tip must match main height ±2 per width.
      expect(r.height, `compact header height at ${label}`).toBeGreaterThan(50);
      expect(
        Math.abs(r.height - MAIN_COMPACT_H[key]),
        `compact header height at ${label}: tip=${r.height} main=${MAIN_COMPACT_H[key]} (±2)`,
      ).toBeLessThanOrEqual(2);
      expect(r.titleWidth, `compact title width at ${label}`).toBeGreaterThan(0);
      expect(r.subtitleWidth, `compact subtitle width at ${label}`).toBeGreaterThan(0);
      expect(r.subtitleClipped, `compact subtitle clipped at ${label}`).toBe(false);
      expect(r.backVisible, `Back visible at ${label}`).toBe(true);
      expect(r.backPresetOverlap, `Back overlapped by actions/preset at ${label}`).toBe(false);
      expect(r.controlOutside, `control outside compact header at ${label}`).toBe(false);
    }

    await test.info().attach('critic-hard2-compact-brainstorm-measure.json', {
      body: Buffer.from(JSON.stringify(reports, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    // eslint-disable-next-line no-console
    console.log('[Critic hard 2] compact Brainstorm measure:', JSON.stringify(reports));

    // Click Back (not preset) — collapses Notes Agent brainstorm panel.
    const backBtn = page.locator(
      '[data-testid="notes-agent-chat"] .brainstorm-back-btn, [data-testid="notes-agent-chat"] [aria-label="Close brainstorm"]',
    ).first();
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page.locator('[data-testid="notes-agent-chat"]')).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await app.close().catch(() => undefined);
  }
});

// Ivy: compact Download never disappears — inline when it fits, ⋯ overflow
// when it does not (≤400 / W0.3 @280). Same handleDownload export path.
// RED if `messages.length > 0 && !compact` is restored (no Download in compact).
test('Ivy: compact Download reachable inline or overflow at 280/340/500/700/natural', async () => {
  const app = await launchApp(userData);
  try {
    const page = await firstWindow(app);
    await expect(page.locator('.app-menu-bar')).toBeVisible({ timeout: 20_000 });

    await page.locator('nav[aria-label="Main navigation"] button[aria-label="Notes Editor"]').click();
    await expect(page.locator('[data-testid="notes-agent-chat"]')).toBeVisible({ timeout: 8_000 });
    const compactHeader = page.locator(
      '[data-testid="notes-agent-chat"] .pc-header.brainstorm-header--compact',
    );
    await expect(compactHeader).toBeVisible({ timeout: 8_000 });

    // Ensure messages exist so Download mounts (greeting or seeded user turn).
    const msg = page.locator('[data-testid="notes-agent-chat"] .bs-message').first();
    if (!(await msg.isVisible().catch(() => false))) {
      const input = page.locator('[data-testid="notes-agent-chat"] textarea, [data-testid="notes-agent-chat"] [aria-label*="Tell me" i]').first();
      await input.fill('Seed note for download export');
      await page.locator('[data-testid="notes-agent-chat"] button:has-text("Send")').first().click();
    }
    await expect(page.locator('[data-testid="notes-agent-chat"] .bs-message').first()).toBeVisible({ timeout: 8_000 });
    // Download control must exist in the DOM (inline + overflow trigger; CSS picks one).
    await expect(page.locator('[data-testid="brainstorm-download-inline"]')).toBeAttached({ timeout: 8_000 });
    await expect(page.locator('[data-testid="brainstorm-header-overflow"]')).toBeAttached();

    type Placement = {
      width: string;
      placement: 'inline' | 'overflow';
      height: number;
      controlOutside: boolean;
      inlineVisible: boolean;
      overflowVisible: boolean;
      downloadTriggered: boolean;
      downloadName: string | null;
    };

    const MAIN_COMPACT_H: Record<string, number> = {
      natural: 107,
      '280': 0, // W0.3 — no height ceiling; containment only
      '340': 107,
      '500': 75,
      '700': 75,
    };

    // Set host width inside the same evaluate as measure (Critic hard 2 pattern)
    // and restore afterward so later widths / natural are not poisoned.
    // Do NOT press Escape after Download — BrainstormPage ESC → onClose()
    // collapses the Notes Agent panel (GRS replaces it); Menu already closes
    // on item click.
    async function measurePlacement(width: number | 'natural'): Promise<{
      width: string;
      placement: 'inline' | 'overflow';
      height: number;
      controlOutside: boolean;
      inlineVisible: boolean;
      overflowVisible: boolean;
      hostW: number;
    }> {
      return page.evaluate(({ w }) => {
        function inside(child: DOMRect, bar: DOMRect): boolean {
          return (
            child.left >= bar.left - 1
            && child.right <= bar.right + 1
            && child.top >= bar.top - 1
            && child.bottom <= bar.bottom + 1
          );
        }
        const el = document.querySelector(
          '[data-testid="notes-agent-chat"] .pc-header.brainstorm-header--compact',
        ) as HTMLElement | null;
        const label = w === 'natural' ? 'natural' : String(w);
        if (!el) {
          return {
            width: label,
            placement: 'overflow' as const,
            height: 0,
            controlOutside: true,
            inlineVisible: false,
            overflowVisible: false,
            hostW: 0,
          };
        }
        const host = (el.closest('.pc-header-host') as HTMLElement | null) ?? el;
        const prevW = host.style.width;
        const prevMin = host.style.minWidth;
        const prevMax = host.style.maxWidth;
        if (w !== 'natural') {
          host.style.width = `${w}px`;
          host.style.minWidth = `${w}px`;
          host.style.maxWidth = `${w}px`;
          void host.offsetWidth;
        } else {
          host.style.width = '';
          host.style.minWidth = '';
          host.style.maxWidth = '';
          void host.offsetWidth;
        }
        const rect = el.getBoundingClientRect();
        const hostW = Math.round(host.getBoundingClientRect().width);
        const inline = el.querySelector('[data-testid="brainstorm-download-inline"]') as HTMLElement | null;
        const overflow = el.querySelector('[data-testid="brainstorm-header-overflow"]') as HTMLElement | null;
        const ir = inline?.getBoundingClientRect();
        const or = overflow?.getBoundingClientRect();
        const inlineVisible = Boolean(ir && ir.width > 0 && ir.height > 0);
        const overflowVisible = Boolean(or && or.width > 0 && or.height > 0);
        let controlOutside = false;
        for (const kid of el.querySelectorAll<HTMLElement>(
          'button, [role="switch"], .pc-header-title, select, input',
        )) {
          const kr = kid.getBoundingClientRect();
          if (kr.width < 1 || kr.height < 1) continue;
          if (!inside(kr, rect)) { controlOutside = true; break; }
        }
        host.style.width = prevW;
        host.style.minWidth = prevMin;
        host.style.maxWidth = prevMax;
        return {
          width: label,
          placement: (inlineVisible ? 'inline' : 'overflow') as 'inline' | 'overflow',
          height: Math.round(rect.height),
          controlOutside,
          inlineVisible,
          overflowVisible,
          hostW,
        };
      }, { w: width });
    }

    async function applyHostWidth(width: number | 'natural'): Promise<void> {
      await page.evaluate(({ w }) => {
        const el = document.querySelector(
          '[data-testid="notes-agent-chat"] .pc-header.brainstorm-header--compact',
        ) as HTMLElement | null;
        const host = (el?.closest('.pc-header-host') as HTMLElement | null) ?? el;
        if (!host) return;
        if (w === 'natural') {
          host.style.width = '';
          host.style.minWidth = '';
          host.style.maxWidth = '';
        } else {
          host.style.width = `${w}px`;
          host.style.minWidth = `${w}px`;
          host.style.maxWidth = `${w}px`;
        }
        void host.offsetWidth;
      }, { w: width });
    }

    const widths: Array<number | 'natural'> = [280, 'natural', 340, 500, 700];
    const reports: Placement[] = [];

    // Probe handleDownload's blob + <a download>.click contract (Electron may
    // not emit Playwright's "download" event for programmatic anchor clicks).
    await page.evaluate(() => {
      const w = window as unknown as {
        __mythosDlProbe?: { clicked: boolean; download: string; blobType: string };
      };
      w.__mythosDlProbe = { clicked: false, download: '', blobType: '' };
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = ((blob: Blob) => {
        w.__mythosDlProbe!.blobType = blob.type;
        return origCreate(blob);
      }) as typeof URL.createObjectURL;
      HTMLAnchorElement.prototype.click = function mythosDlProbeClick(this: HTMLAnchorElement) {
        w.__mythosDlProbe!.clicked = true;
        w.__mythosDlProbe!.download = this.download || '';
      };
    });

    for (const w of widths) {
      // Keep panel mounted — Escape after Download previously collapsed it.
      await expect(compactHeader).toBeVisible({ timeout: 5_000 });
      const m = await measurePlacement(w);
      // Re-apply width for the click path (measure restores host styles).
      await applyHostWidth(w);
      const key = w === 'natural' ? 'natural' : String(w);
      const label = m.width;

      // Exactly one Download path must be visible.
      expect(
        m.inlineVisible || m.overflowVisible,
        `Download path missing at ${label} (hostW=${m.hostW}, h=${m.height})`,
      ).toBe(true);
      if (w === 280 || w === 340 || w === 'natural') {
        // ≤400 container: overflow menu (⋯), not inline chip.
        expect(m.placement, `Download should be overflow at ${label}`).toBe('overflow');
        expect(m.overflowVisible, `overflow trigger visible at ${label}`).toBe(true);
        expect(m.inlineVisible, `inline Download hidden at ${label}`).toBe(false);
      } else {
        expect(m.placement, `Download should be inline at ${label}`).toBe('inline');
        expect(m.inlineVisible, `inline Download visible at ${label}`).toBe(true);
      }
      expect(m.controlOutside, `control outside at ${label}`).toBe(false);
      if (MAIN_COMPACT_H[key] > 0) {
        expect(
          Math.abs(m.height - MAIN_COMPACT_H[key]),
          `height at ${label}: tip=${m.height} main=${MAIN_COMPACT_H[key]} (±2)`,
        ).toBeLessThanOrEqual(2);
      }

      await page.evaluate(() => {
        const win = window as unknown as {
          __mythosDlProbe?: { clicked: boolean; download: string; blobType: string };
        };
        if (win.__mythosDlProbe) {
          win.__mythosDlProbe.clicked = false;
          win.__mythosDlProbe.download = '';
          win.__mythosDlProbe.blobType = '';
        }
      });
      if (m.placement === 'inline') {
        await page.locator('[data-testid="brainstorm-download-inline"]').click();
      } else {
        await page.locator('[data-testid="brainstorm-header-overflow"]').click();
        await expect(page.locator('[data-testid="menu-item-download"]')).toBeVisible({ timeout: 3_000 });
        await page.locator('[data-testid="menu-item-download"]').click();
        await expect(page.locator('[data-testid="menu-item-download"]')).toBeHidden({ timeout: 3_000 });
      }
      const probe = await page.evaluate(() => {
        const win = window as unknown as {
          __mythosDlProbe?: { clicked: boolean; download: string; blobType: string };
        };
        return win.__mythosDlProbe ?? { clicked: false, download: '', blobType: '' };
      });
      expect(probe.clicked, `handleDownload anchor click at ${label}`).toBe(true);
      expect(probe.blobType, `download blob type at ${label}`).toBe('text/markdown');
      expect(probe.download, `download filename at ${label}`).toMatch(/^brainstorm-\d{4}-\d{2}-\d{2}\.md$/);

      reports.push({
        width: label,
        placement: m.placement,
        height: m.height,
        controlOutside: m.controlOutside,
        inlineVisible: m.inlineVisible,
        overflowVisible: m.overflowVisible,
        downloadTriggered: true,
        downloadName: probe.download,
      });
    }

    await test.info().attach('ivy-compact-download-placement.json', {
      body: Buffer.from(JSON.stringify(reports, null, 2), 'utf8'),
      contentType: 'application/json',
    });
    // eslint-disable-next-line no-console
    console.log('[Ivy compact Download]', JSON.stringify(reports));

    // Back still navigates after Download interactions.
    const backBtn = page.locator(
      '[data-testid="notes-agent-chat"] .brainstorm-back-btn, [data-testid="notes-agent-chat"] [aria-label="Close brainstorm"]',
    ).first();
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(page.locator('[data-testid="notes-agent-chat"]')).not.toBeVisible({ timeout: 5_000 });
  } finally {
    await app.close().catch(() => undefined);
  }
});
