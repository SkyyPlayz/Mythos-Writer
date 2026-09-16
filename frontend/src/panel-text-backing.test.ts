import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * SKY-11787 — every base panel that paints glass straight over the wallpaper
 * must paint it through `--glass-panel-bg`, so it picks up the adaptive
 * text-backing.
 *
 * The bug this keeps out: a panel goes back to `background: var(--glass-fill)`
 * (the old idiom, still correct-looking in every screenshot) and silently
 * loses the AA floor behind its body copy on 40 of the 42 bundled wallpapers.
 * Nothing else would catch it — the panel still frosts, still follows the
 * sliders, still passes the token-orphan guard.
 *
 * Scope is deliberately the *top-level* surfaces only — the ones whose own
 * comments say they are the only layer painting a background over the shell
 * wallpaper. Nested `--bg-panel` cards sit on top of an already-backed panel;
 * giving them a backing too would just double-darken.
 */

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** [stylesheet, selector the backing must reach]. */
const BASE_PANELS: ReadonlyArray<readonly [css: string, selector: string]> = [
  ['BlockEditor.css', '.block-editor-toolbar'],
  ['BrainstormPage.css', '.brainstorm-page'],
  ['DesktopShell.css', '.top-bar-chrome--peeking'],
  ['EntriesPanel.css', '.entries-panel'],
  ['FormatToolbar.css', '.fmt-toolbar'],
  ['ManuscriptStructureView.css', '.msv'],
  ['NoteViewer.css', '.note-viewer-toolbar'],
  ['NotesTabPanel.css', '.notes-tab-toolbar'],
  ['NotesTabPanel.css', '.notes-tab-sidebar-left'],
  ['NotesTabPanel.css', '.notes-tab-sidebar-right'],
  ['StoryNavigator.css', '.story-navigator'],
  ['TabBar.css', '.tab-bar'],
  ['VaultGraphView.css', '.vgv-toolbar'],
  ['VaultGraphView.css', '.vgv-bottom-toolbar'],
  ['VaultGraphView.css', '.vgv-left-panel'],
  ['VaultGraphView.css', '.vgv-inspector'],
  ['pages/SceneCrafter/SceneCrafterPage.css', '.scene-crafter-page::before'],
];

describe('SKY-11787 — base panels read --glass-panel-bg', () => {
  it.each(BASE_PANELS)('%s %s', (file, selector) => {
    const css = stripComments(read(file));
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // The declaration may live in the rule itself or in the file's
    // `@supports (backdrop-filter)` branch, so match any rule for the
    // selector and require at least one to carry the token.
    const rules = [...css.matchAll(new RegExp(`(?:^|[},/])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'gm'))];
    expect(rules.length, `no rule for ${selector} in ${file}`).toBeGreaterThan(0);
    const bodies = rules.map((m) => m[1]).join('\n');
    expect(bodies, `${file} ${selector} lost --glass-panel-bg`).toContain('var(--glass-panel-bg)');
    // The old idiom must be gone from these rules, or the later declaration
    // would win and drop the backing again.
    expect(bodies).not.toContain('var(--glass-fill)');
  });

  it('the multi-layer recipe clips the backing to the padding box', () => {
    const tokens = stripComments(read('tokens.css'));
    const m = /--glass-panel-bg:\s*([^;]+);/.exec(tokens);
    expect(m, 'tokens.css no longer defines --glass-panel-bg').not.toBeNull();
    const value = m![1].replace(/\s+/g, ' ').trim();
    // Layer order matters: the first layer paints on top, so the backing must
    // come before the glass fill, and only the backing is padding-box clipped
    // (content-box left a hard square seam inside the panel's rounded frame).
    expect(value).toMatch(/^linear-gradient\(var\(--ln-text-backing\), ?var\(--ln-text-backing\)\) padding-box,/);
    expect(value).toMatch(/var\(--glass-fill\) border-box$/);
  });

  it('defaults the backing to transparent so an unmeasured wallpaper renders as today', () => {
    const tokens = stripComments(read('tokens.css'));
    expect(tokens).toMatch(/--ln-text-backing:\s*transparent;/);
  });

  it('0.5.2 P0 jank — full-page shells must not stack live blur(var(--blur-panel))', () => {
    // PERFORMANCE.md §2 / W0.5: frost comes from --wp-blur + semi-opaque
    // --glass-panel-bg. Live backdrop-filter on these shells is a per-frame tax
    // that made Liquid Neon animations unusable on Windows.
    const shells = [
      'EntriesPanel.css',
      'BrainstormPage.css',
      'ManuscriptStructureView.css',
      'pages/SceneCrafter/SceneCrafterPage.css',
    ];
    for (const file of shells) {
      const css = stripComments(read(file));
      expect(css, file).not.toMatch(/backdrop-filter:\s*blur\(\s*var\(--blur-panel\)\s*\)/);
      expect(css, file).not.toMatch(/-webkit-backdrop-filter:\s*blur\(\s*var\(--blur-panel\)\s*\)/);
    }
  });

  it('flattens the backing wherever the panel fill is already opaque', () => {
    const tokens = stripComments(read('tokens.css'));
    // High contrast (K8), reduced transparency, and no-backdrop-filter all
    // paint an opaque panel, where the backing has nothing to do.
    const opaqueBlocks = [
      /:root\[data-contrast="high"\][\s\S]*?--ln-text-backing:\s*transparent;/,
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?--ln-text-backing:\s*transparent;/,
      /@supports not \(\(backdrop-filter[\s\S]*?--ln-text-backing:\s*transparent;/,
    ];
    for (const re of opaqueBlocks) expect(tokens).toMatch(re);
  });

  it('restates --glass-panel-bg in every flattening block, not just its inputs', () => {
    // The `var()`s inside --glass-panel-bg are substituted where it is
    // declared (:root), and the *resolved* value inherits — so overriding
    // --ln-text-backing / --glass-fill lower down does not change it.
    // Verified in Chromium: a `.k8 *` override of the inputs leaves the
    // recipe on the :root values. Dropping one of these lines silently
    // un-flattens 17 base panels in high-contrast / reduced-transparency mode.
    const tokens = stripComments(read('tokens.css'));
    const blocks = [
      /:root\[data-contrast="high"\][\s\S]*?--glass-panel-bg:\s*#15191f;/,
      /@media \(prefers-reduced-transparency: reduce\)[\s\S]*?--glass-panel-bg:\s*var\(--glass-fill-fallback\);/,
      /@supports not \(\(backdrop-filter[\s\S]*?--glass-panel-bg:\s*var\(--glass-fill-fallback\);/,
    ];
    for (const re of blocks) expect(tokens).toMatch(re);
  });
});
