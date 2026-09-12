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
 *
 * Nine entries were added by SKY-11636, which stopped the class name
 * `` `cvb-card--s${slot}` `` from registering `--s` as a token prefix. That one
 * character had been covering every `--s…` token in the repo. Three of the nine
 * are read with no fallback at all (`--state-error`, `--state-danger-border`,
 * `--state-success-border`), so those declarations are invalid at computed-value
 * time and the property falls back to `unset` rather than to a literal.
 */
const KNOWN_ORPHANS: readonly string[] = [
  'AccountModal.css  --text-md',
  'AeonLaneView.css  --surface-subtle',
  'AeonLaneView.css  --text-heading',
  'AeonLaneView.css  --text-md',
  'AgentHubPanel.css  --sp-2',
  'AgentHubPanel.css  --sp-3',
  'BlockEditor.css  --page-bg-radius',
  'BrainstormPage.css  --state-error',
  'ContinuityPanel.css  --severity-critical-border',
  'DesktopShell.css  --accent-primary',
  'DesktopShell.css  --bg',
  'DesktopShell.css  --bg-control',
  'DesktopShell.css  --bg-control-hover',
  'DesktopShell.css  --bg-overlay',
  'DesktopShell.css  --muted-text',
  'DraftHistoryPanel.css  --background-primary',
  'DraftHistoryPanel.css  --background-secondary',
  'DraftHistoryPanel.css  --text-default',
  'EntriesPanel.css  --accent-fg',
  'MoveVaultWizard.css  --accent-color',
  'NoteViewer.css  --danger-bg',
  'NoteViewer.css  --danger-bg-hover',
  'NoteViewer.css  --danger-border',
  'NoteViewer.css  --danger-text',
  'NoteViewer.css  --font-mono',
  'OnboardingWizard.css  --font-mono',
  'PageChromeToolbar.css  --bg-control-hover',
  'SettingsPanel.css  --font-mono',
  'SplitEditorPane.css  --page-bg-radius',
  'SuggestionDetailPane.css  --accent-muted',
  'TemplatePicker.css  --state-error',
  'TemplatePicker.css  --text-md',
  'ThemeContrastSlider.css  --pct',
  'ThemeContrastSlider.css  --state-danger-border',
  'ThemeContrastSlider.css  --state-success-border',
  'VaultGraphView.css  --chip-color',
  'VaultGraphView.css  --font-mono',
  'VaultGraphView.css  --ln-graph-edge-cross-vault',
  'VaultGraphView.css  --shadow-panel',
  'VaultGraphView.css  --text-accent',
  'WritingAssistantPanel.css  --bg-dark',
  'components/BrainstormCard/IdeaDetailDrawer.css  --weight-md',
  'components/BrainstormCard/ProposalCard.css  --entity-scene_card-bg',
  'components/BrainstormCard/ProposalCard.css  --entity-scene_card-text',
  'components/MigrationBanner/MigrationBanner.css  --border-soft',
  'components/PresetBrowser.css  --accent-soft-hover',
  'components/SceneHistoryPane/SceneHistoryPane.css  --border-soft',
  'components/SettingsPanel/sections/AddVaultDialog.css  --text-subtle',
  'components/TagPane/TagPane.css  --glass-bg',
  'components/VaultBrowser/VaultBrowser.css  --accent-primary',
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

/**
 * Only shipped modules can define a token for a real surface, so specs are
 * excluded — including this one, whose fixtures name tokens on purpose and
 * would otherwise declare them for the whole repo.
 */
const isSpec = (relPath: string): boolean => /\.(test|spec)\.tsx?$/.test(relPath);
const tsFiles = walk(['.ts', '.tsx']).filter((relPath) => !isSpec(relPath));

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
 * SKY-11636 — the three syntactic positions where a template literal really is
 * a custom-property name. Each is anchored on both sides, because an
 * unanchored `--x${` also matches a BEM class-name modifier: the className
 * `` `fmt-btn--bold${isBold ? …}` `` would otherwise register `--bold` as a
 * token prefix, and `` `cvb-card--s${slot}` `` would register `--s` and cover
 * every token in the repo that starts with an s.
 */
const DYNAMIC_PREFIX_PATTERNS: readonly RegExp[] = [
  /var\(\s*(--[\w-]*?)\$\{/g, //                                   var(--x-${…})
  /setProperty\(\s*['"`](--[\w-]*?)\$\{/g, //          setProperty(`--x-${…}`, v)
  /`(--[\w-]*?)\$\{[^`]*`(?:\s+as\s+[\w.<>[\]]+)?\s*\]?\s*:/g, // [`--x-${…}`]: v
];

/**
 * The shortest static prefix trusted to stand in for a whole token family: a
 * namespace segment plus its trailing `-`.
 *
 * Without a floor the cover is vacuous. The now-deleted TimelineLanes.tsx read
 * `var(--n${j.slot})`, registering the one-character prefix `--n`, which
 * satisfied every token starting with an n — including the genuine orphans
 * `--neon-green` and `--neon-pink` in OnboardingWizard.css. The guard stayed
 * green for as long as that dead file existed and only went red when it was
 * deleted (SKY-11619). Requiring the `-` boundary also stops `--ln-graph` from
 * swallowing `--ln-graphics`.
 */
const MIN_SAFE_PREFIX_LENGTH = 6;
const isSafePrefix = (prefix: string): boolean =>
  prefix.endsWith('-') && prefix.length >= MIN_SAFE_PREFIX_LENGTH;

/** Static prefixes of every template-literal custom-property name in one file. */
function dynamicPrefixesIn(src: string): string[] {
  const found = new Set<string>();
  for (const pattern of DYNAMIC_PREFIX_PATTERNS) {
    for (const m of src.matchAll(pattern)) found.add(m[1]);
  }
  return [...found];
}

/**
 * (4): set from a component. Matches `'--x': v`, `['--x' as string]: v`,
 * `setProperty('--x', v)`, and template-literal names, whose static prefix is
 * collected so `--ln-graph-node-${category}` covers `--ln-graph-node-scenes`.
 *
 * A prefix too short to be a namespace covers nothing and is reported instead,
 * so the author renames the token rather than blanket-covering a family.
 */
function componentDeclared(): { exact: Set<string>; prefixes: string[]; unsafePrefixes: string[] } {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  const unsafePrefixes: string[] = [];
  for (const file of tsFiles) {
    const src = read(file);
    // `'--x'` / `"--x"` / `` `--x` `` used as an object key, with an optional
    // `as T` cast and an optional computed-key bracket before the colon.
    for (const m of src.matchAll(/['"`](--[\w-]+)['"`](?:\s+as\s+[\w.<>[\]]+)?\s*\]?\s*:/g)) exact.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)) exact.add(m[1]);
    // `--ln-graph-node-${category}` → prefix `--ln-graph-node-`.
    for (const prefix of dynamicPrefixesIn(src)) {
      if (isSafePrefix(prefix)) prefixes.add(prefix);
      else unsafePrefixes.push(`${file}  ${prefix}\${…}`);
    }
  }
  return { exact, prefixes: [...prefixes], unsafePrefixes: unsafePrefixes.sort() };
}

const components = componentDeclared();

describe('SKY-11482 — every stylesheet reads only custom properties something defines', () => {
  it('has stylesheets to check', () => {
    // Guards the glob itself: an empty sweep would pass vacuously forever.
    expect(cssFiles.length).toBeGreaterThan(100);
  });

  it('collects no dynamic token prefix too short to be a namespace', () => {
    expect(
      components.unsafePrefixes,
      'These components build a custom-property name from a template literal whose static prefix is '
        + 'too short to be a safe namespace, so it would cover every token that happens to start with '
        + `those characters (needs a trailing "-" and at least ${MIN_SAFE_PREFIX_LENGTH} characters). `
        + 'Rename the token to a real namespace — `--ln-lane-3`, not `--n3` — so this guard keeps '
        + 'checking the rest of that family. See SKY-11636.',
    ).toEqual([]);
  });

  it('finds no orphaned custom properties outside the known baseline', () => {
    const stamped = engineStamped();
    const { exact: fromComponents, prefixes } = components;

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

describe('SKY-11636 — a dynamic token prefix covers a family only when it names one', () => {
  it('collects the namespace prefix of a template-literal custom property', () => {
    expect(dynamicPrefixesIn('return `var(--ln-graph-node-${category})`;')).toEqual(['--ln-graph-node-']);
    expect(dynamicPrefixesIn('el.style.setProperty(`--beat-tint-${id}`, colour);')).toEqual(['--beat-tint-']);
    expect(dynamicPrefixesIn('<div style={{ [`--lane-slot-${i}`]: colour }} />')).toEqual(['--lane-slot-']);
  });

  it('ignores BEM class-name modifiers, which are not custom properties at all', () => {
    expect(dynamicPrefixesIn('className={`fmt-btn fmt-btn--bold${isBold ? " is-active" : ""}`}')).toEqual([]);
    expect(dynamicPrefixesIn('return `cvb-card--s${slot + 1}`;')).toEqual([]);
    expect(dynamicPrefixesIn('const cls = `nav-rail__item--slot-${slot}`;')).toEqual([]);
  });

  it('does not let the one-character `--n${…}` prefix cover `--neon-green`', () => {
    // The exact SKY-11619 regression: TimelineLanes.tsx read `var(--n${j.slot})`
    // and that vacuously satisfied the OnboardingWizard.css orphans.
    const collected = dynamicPrefixesIn('background: `var(--n${j.slot}, #0f1321)`');
    expect(collected).toEqual(['--n']);
    expect(collected.filter(isSafePrefix)).toEqual([]);
    expect(collected.filter(isSafePrefix).some((p) => '--neon-green'.startsWith(p))).toBe(false);
  });

  it('requires the trailing `-` so a prefix cannot straddle a token boundary', () => {
    expect(isSafePrefix('--ln-graph-node-')).toBe(true);
    expect(isSafePrefix('--ln-graph')).toBe(false); //   would swallow --ln-graphics
    expect(isSafePrefix('--ln-')).toBe(false); //         a namespace, but far too broad
    expect(isSafePrefix('--')).toBe(false); //            `var(--${name})` covers everything
  });
});
