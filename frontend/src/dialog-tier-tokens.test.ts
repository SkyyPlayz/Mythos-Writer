import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * SKY-11493 — dialog chrome must come from a real tier, not a dead token.
 *
 * Two defects from the SKY-11480 gap list (OT-5 and OT-4):
 *
 *  - OT-5: six floating dialogs read `--bg-panel` / `--bg-surface`, which
 *    tokens.css flips to the 20%-alpha `--glass-fill` under `@supports
 *    (backdrop-filter)`, but the elements never declared a backdrop-filter of
 *    their own. They got the transparency and none of the frost — two of them
 *    are destructive-action confirmations. They now carry `.ln-overlay-surface`
 *    and own geometry only.
 *
 *  - OT-4: five custom properties (`--panel-bg`, `--color-surface-elevated`,
 *    `--color-surface-raised`, `--bg-secondary`, `--surface-1`) were defined
 *    nowhere, so every reader painted its hardcoded grey fallback and never
 *    followed the theme. Same class of defect as SKY-11449. They are gone;
 *    this test keeps them gone.
 */

const SRC = resolve(process.cwd(), 'src');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function walkCss(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkCss(p, out);
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|[}*/])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(stripComments(css));
  expect(m, `no rule for ${selector}`).not.toBeNull();
  return m![2];
}

/** Custom properties that no stylesheet, engine or component ever defines. */
const DEAD_TOKENS = [
  '--panel-bg',
  '--color-surface-elevated',
  '--color-surface-raised',
  '--bg-secondary',
  '--surface-1',
] as const;

/** OT-5: [tsx, css, dialog class]. The tsx must pair the class with the tier. */
const OVERLAY_DIALOGS: ReadonlyArray<readonly [tsx: string, css: string, cls: string]> = [
  ['SceneHistory.tsx', 'SceneHistory.css', 'history-confirm-dialog'],
  ['SplitEditorPane.tsx', 'SplitEditorPane.css', 'spe-scene-popover'],
  ['ProjectSwitcher.tsx', 'ProjectSwitcher.css', 'project-switcher-dropdown'],
  ['BrainstormPage.tsx', 'BrainstormPage.css', 'bs-delete-confirm-dialog'],
  ['components/BrainstormCard/IdeaDetailDrawer.tsx', 'components/BrainstormCard/IdeaDetailDrawer.css', 'idd-discard-dialog'],
  ['components/BrainstormCard/IdeaDetailDrawer.tsx', 'components/BrainstormCard/IdeaDetailDrawer.css', 'idd-entity-picker'],
  // ScenePicker reuses the entity-picker shell; it must carry the tier too or
  // it would lose its fill entirely now that the CSS rule owns geometry only.
  ['components/BrainstormCard/ScenePicker.tsx', 'components/BrainstormCard/IdeaDetailDrawer.css', 'idd-entity-picker'],
];

/** OT-4: [css, selector] — the eight surfaces that painted a fallback grey. */
const RETOKENED_SURFACES: ReadonlyArray<readonly [css: string, selector: string]> = [
  ['GlobalRightSidebar.css', '.grs-add-panel-picker'],
  ['NoteViewer.css', '.note-fidelity-dialog'],
  ['OutlinePlanningPanel.css', '.opl-link-picker'],
  ['LayoutPicker.css', '.layout-picker-dropdown'],
  ['TimelinePicker.css', '.tlpicker__dropdown'],
  ['GlobalSearchPanel.css', '.gsp-panel'],
  ['TagInput.css', '.tag-dropdown'],
  ['components/TagPane/TagPane.css', '.tp-merge-dialog'],
];

describe('SKY-11493 — OT-4: no stylesheet reads a custom property that nothing defines', () => {
  const tokensDeclared = new Set(
    Array.from(stripComments(read('tokens.css')).matchAll(/(--[\w-]+)\s*:/g), (m) => m[1]),
  );

  it.each(DEAD_TOKENS)('%s is still undefined in tokens.css (delete this row if you define it)', (name) => {
    expect(tokensDeclared.has(name)).toBe(false);
  });

  it('no CSS file under src/ references any of the five dead tokens', () => {
    const offenders: string[] = [];
    for (const file of walkCss(SRC)) {
      const css = stripComments(readFileSync(file, 'utf-8'));
      for (const name of DEAD_TOKENS) {
        if (new RegExp(`var\\(\\s*${name}[\\s,)]`).test(css)) offenders.push(`${file.slice(SRC.length + 1)} → ${name}`);
      }
    }
    expect(
      offenders,
      'These read a custom property that is defined nowhere, so the var() fallback paints '
        + 'and the surface never follows the theme. Use --bg-elevated (popovers), '
        + '--bg-inset (wells) or --bg-panel (docked panels), or put the surface on a tier.',
    ).toEqual([]);
  });

  it.each(RETOKENED_SURFACES)('%s %s paints --bg-elevated, not a hex fallback', (css, selector) => {
    const body = ruleBody(read(css), selector);
    expect(body).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(body).not.toMatch(/background:\s*#|background:\s*var\([^)]*,\s*#/);
  });
});

describe('SKY-11493 — OT-5: floating dialogs sit on the overlay tier', () => {
  it.each(OVERLAY_DIALOGS)('%s pairs .%s with ln-overlay-surface', (tsx, _css, cls) => {
    expect(read(tsx)).toContain(`"${cls} ln-overlay-surface"`);
  });

  it.each(OVERLAY_DIALOGS)('%s .%s owns geometry only — no local fill, border or shadow', (_tsx, css, cls) => {
    const body = ruleBody(read(css), `.${cls}`);
    expect(body).not.toMatch(/(^|\s)background\s*:/);
    expect(body).not.toMatch(/(^|\s)border\s*:/);
    expect(body).not.toMatch(/(^|\s)box-shadow\s*:/);
  });
});
