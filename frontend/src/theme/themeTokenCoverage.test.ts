/**
 * SKY-11482 — repo-wide guard: no stylesheet may read a custom property that
 * nothing ever defines.
 *
 * The bug class (SKY-11449 on the Boards canvas, SKY-11482 on `--bh`/`--bwh`):
 * a stylesheet ships `var(--surface-card, #1e2130)` or
 * `var(--bh, rgba(0,240,255,.2))` for a property that is declared nowhere —
 * not in tokens.css, not in any other stylesheet, not stamped by
 * theme/liquidNeonEngine.ts, not set from a component. CSS has no error for
 * that. The declaration silently resolves to its hardcoded fallback, so the
 * surface paints a frozen literal and never repaints when the user changes
 * accent slots, glow intensity, Reduce Glow, high contrast or the light theme.
 * It looks fine in a screenshot and is structurally disconnected from the
 * theme engine forever.
 *
 * SKY-11449 encoded this for two Boards files. This promotes it to every
 * stylesheet under frontend/src, so the *next* one fails CI instead of
 * shipping a dead surface.
 *
 * ## Scope of the check
 *
 * A property counts as defined when any of these declare it:
 *   1. the same stylesheet (a local `--x: …`),
 *   2. any other stylesheet in the bundle (the cascade is global — tokens.css
 *      is just the biggest one),
 *   3. theme/liquidNeonEngine.ts, evaluated at runtime for both default and
 *      fully-customized settings (some tokens are only emitted when the user
 *      overrides a colour),
 *   4. a component, via an inline style key or `setProperty` — including
 *      template-literal names like `--ln-graph-node-${category}`, which are
 *      matched by prefix.
 *
 * Rule 2 is deliberately generous: it does not verify that the declaring
 * selector actually matches the element doing the reading. It is a
 * declared-nowhere check, which is precisely the bug class above, with no
 * false positives.
 *
 * ## The baseline
 *
 * This check was retrofitted onto a codebase that already had orphans, so it
 * runs as a ratchet against KNOWN_ORPHANS below rather than demanding zero on
 * day one. The list is exact in both directions:
 *
 *   - a new orphan fails ("add the token or fix the reference"),
 *   - a *fixed* orphan also fails ("delete the line from KNOWN_ORPHANS"),
 *
 * so the baseline can only shrink and nothing is silenced — every entry is a
 * live surface that does not repaint with the theme. Burning it down is
 * SKY-11489.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyLiquidNeonV2Tokens, LIQUID_NEON_V2_DEFAULTS } from './liquidNeonEngine';

/** Repo-relative-to-`frontend/src` paths, so failure messages are greppable. */
const SRC_ROOT = resolve(__dirname, '..');

/**
 * Every orphan present when this guard went repo-wide, as `file  --token`.
 * Each one is a real surface frozen on a literal fallback — not an exemption.
 * Fix one, delete its line. See SKY-11489.
 */
const KNOWN_ORPHANS: readonly string[] = [
  'AccountModal.css  --text-md',
  'AeonLaneView.css  --text-heading',
  'AeonLaneView.css  --text-md',
  'BlockEditor.css  --page-bg-radius',
  'DesktopShell.css  --accent-primary',
  'DesktopShell.css  --bg',
  'DesktopShell.css  --bg-control',
  'DesktopShell.css  --bg-control-hover',
  'DesktopShell.css  --bg-overlay',
  'DesktopShell.css  --bg-secondary',
  'DesktopShell.css  --muted-text',
  'DraftHistoryPanel.css  --background-primary',
  'DraftHistoryPanel.css  --background-secondary',
  'DraftHistoryPanel.css  --text-default',
  'EntriesPanel.css  --accent-fg',
  'EntriesQuickAdd.css  --color-surface-2',
  'FloatingPanelApp.css  --color-accent-faint',
  'FloatingPanelApp.css  --color-surface-2',
  'GlobalRightSidebar.css  --color-surface-raised',
  'GlobalSearchPanel.css  --panel-bg',
  'LayoutPicker.css  --color-surface-elevated',
  'MarginRuler.css  --color-focus',
  'MarginRuler.css  --color-surface-2',
  'MoveVaultWizard.css  --accent-color',
  'NoteViewer.css  --bg-secondary',
  'NoteViewer.css  --danger-bg',
  'NoteViewer.css  --danger-bg-hover',
  'NoteViewer.css  --danger-border',
  'NoteViewer.css  --danger-text',
  'NoteViewer.css  --font-mono',
  'OnboardingWizard.css  --font-mono',
  'PageChromeToolbar.css  --bg-control-hover',
  'SearchBar.css  --panel-bg',
  'SettingsPanel.css  --font-mono',
  'SplitEditorPane.css  --page-bg-radius',
  'SuggestionDetailPane.css  --accent-muted',
  'SyncConflictModal.css  --color-accent-muted',
  'SyncConflictModal.css  --color-warn',
  'TagInput.css  --panel-bg',
  'TemplatePicker.css  --text-md',
  'ThemeContrastSlider.css  --pct',
  'TimelinePicker.css  --color-surface-elevated',
  'TimelinePlotlines.css  --color-panel-bg',
  'TimelineRoot.css  --color-surface-elevated',
  'TimelineSpreadsheet.css  --color-bg',
  'VaultGraphView.css  --chip-color',
  'VaultGraphView.css  --font-mono',
  'VaultGraphView.css  --ln-graph-edge-cross-vault',
  'VaultGraphView.css  --text-accent',
  'WritingAssistantPanel.css  --bg-dark',
  'components/BrainstormCard/IdeaDetailDrawer.css  --weight-md',
  'components/BrainstormCard/ProposalCard.css  --entity-scene_card-bg',
  'components/BrainstormCard/ProposalCard.css  --entity-scene_card-text',
  'components/IconPicker/IconPicker.css  --color-accent-bg',
  'components/IconPicker/IconPicker.css  --color-bg',
  'components/IconPicker/IconPicker.css  --color-hover',
  'components/IconPicker/IconPicker.css  --color-muted',
  'components/ManuscriptStructure/SceneGrid.css  --color-surface-2',
  'components/MigrationBanner/MigrationBanner.css  --border-soft',
  'components/NoteTemplateDialog/NoteTemplateDialog.css  --color-input-bg',
  'components/PresetBrowser.css  --accent-soft-hover',
  'components/SceneHistoryPane/SceneHistoryPane.css  --border-soft',
  'components/SettingsPanel/sections/AddVaultDialog.css  --text-subtle',
  'components/TagPane/TagPane.css  --glass-bg',
  'components/TagPane/TagPane.css  --panel-bg',
  'components/VaultBrowser/VaultBrowser.css  --accent-primary',
  'components/VaultBrowser/VaultBrowser.css  --bg-secondary',
  'migration/MythosBootMigrationNotice.css  --font-mono',
];

/** Strip comments so a token named in prose isn't mistaken for a reference. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `--name` declared as a property in the given CSS text. */
function declaredIn(css: string): Set<string> {
  return new Set(Array.from(stripComments(css).matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]));
}

/** Every `--name` read through `var(--name, …)` in the given CSS text. */
function referencedIn(css: string): string[] {
  return Array.from(stripComments(css).matchAll(/var\(\s*(--[\w-]+)/g), (m) => m[1]);
}

const read = (relPath: string): string => readFileSync(resolve(SRC_ROOT, relPath), 'utf8');

/**
 * Every file under `frontend/src` with one of the given extensions, as a
 * `/`-joined relative path. Hand-rolled rather than pulled from a glob package
 * so the guard adds no dependency, and so the paths in KNOWN_ORPHANS read the
 * same on Linux and macOS.
 */
function walk(extensions: readonly string[], dir = '', out: string[] = []): string[] {
  for (const entry of readdirSync(resolve(SRC_ROOT, dir), { withFileTypes: true })) {
    const relPath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(extensions, relPath, out);
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(relPath);
  }
  return out.sort();
}

const cssFiles = walk(['.css']);
const tsFiles = walk(['.ts', '.tsx']);

/** (1) + (2): declared by any stylesheet in the bundle. */
const cssDeclared = new Set<string>();
for (const file of cssFiles) for (const name of declaredIn(read(file))) cssDeclared.add(name);

/**
 * (3): stamped by the theme engine. Applied twice — once with defaults, once
 * with every optional colour overridden — because `--btn-text`, `--wiki-c` and
 * the `--text-*` overrides are only emitted when the user customizes them.
 */
function engineStamped(): Set<string> {
  const stamped = new Set<string>();
  const collect = (el: HTMLElement) => {
    for (let i = 0; i < el.style.length; i += 1) stamped.add(el.style.item(i));
  };
  collect(applyToFreshElement(null));
  collect(
    applyToFreshElement({
      uiTextCol: '#ff00ff',
      uiBtnCol: '#00ff00',
      txtCfg: { ...LIQUID_NEON_V2_DEFAULTS.txtCfg, wiki: '#ffcc00' },
    }),
  );
  return stamped;
}

function applyToFreshElement(settings: Parameters<typeof applyLiquidNeonV2Tokens>[0]): HTMLElement {
  const el = document.createElement('div');
  applyLiquidNeonV2Tokens(settings, 'cosmic.png', el);
  return el;
}

/**
 * (4): set from a component. Matches `'--x': v`, `['--x' as string]: v`,
 * `setProperty('--x', v)`, and template-literal names, whose static prefix is
 * collected so `--ln-graph-node-${category}` covers `--ln-graph-node-scenes`.
 */
function componentDeclared(): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const file of tsFiles) {
    const src = read(file);
    // `'--x'` / `"--x"` / `` `--x` `` used as an object key, with an optional
    // `as T` cast and an optional computed-key bracket before the colon.
    for (const m of src.matchAll(/['"`](--[\w-]+)['"`](?:\s+as\s+[\w.<>[\]]+)?\s*\]?\s*:/g)) exact.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) exact.add(m[1]);
    // `--ln-graph-node-${category}` → prefix `--ln-graph-node-`.
    for (const m of src.matchAll(/(--[\w-]+?)\$\{/g)) prefixes.add(m[1]);
  }
  return { exact, prefixes: [...prefixes] };
}

describe('SKY-11482 — every stylesheet reads only custom properties something defines', () => {
  it('has stylesheets to check', () => {
    // Guards the glob itself: an empty sweep would pass vacuously forever.
    expect(cssFiles.length).toBeGreaterThan(100);
  });

  it('finds no orphaned custom properties outside the known baseline', () => {
    const stamped = engineStamped();
    const { exact: fromComponents, prefixes } = componentDeclared();

    const isDefined = (name: string, localDeclared: Set<string>): boolean =>
      localDeclared.has(name)
      || cssDeclared.has(name)
      || stamped.has(name)
      || fromComponents.has(name)
      || prefixes.some((p) => name.startsWith(p));

    const found: string[] = [];
    for (const file of cssFiles) {
      const css = read(file);
      const localDeclared = declaredIn(css);
      for (const name of [...new Set(referencedIn(css))].sort()) {
        if (!isDefined(name, localDeclared)) found.push(`${file}  ${name}`);
      }
    }

    const baseline = new Set(KNOWN_ORPHANS);
    const added = found.filter((entry) => !baseline.has(entry));
    const fixed = KNOWN_ORPHANS.filter((entry) => !found.includes(entry));

    expect(
      added,
      'These stylesheets read custom properties that nothing defines — not tokens.css, not another '
        + 'stylesheet, not liquidNeonEngine.ts, not a component. Each silently resolves to its var() '
        + 'fallback, so the surface paints a frozen literal and never repaints when the theme changes. '
        + 'Define the token, or point the rule at one that exists (--n1..--n6, --b1..--b6, --g1..--g6, '
        + '--gs1..--gs6, --bw, --glass-fill*, --blur-panel*, or a tokens.css alias).',
    ).toEqual([]);

    expect(
      fixed,
      'These entries in KNOWN_ORPHANS are no longer orphaned — the baseline only ratchets down. '
        + 'Delete these lines from KNOWN_ORPHANS so the fix stays fixed.',
    ).toEqual([]);
  });
});
