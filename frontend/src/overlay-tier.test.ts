import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * SKY-11450 — the Liquid Neon overlay tier.
 *
 * SKY-11133 introduced `--glass-fill-overlay` / `--blur-panel-overlay` but only
 * six surfaces ever adopted them; every dialog and popover below was still
 * painting a flat opaque fill (or, worse, a light-theme literal). These tests
 * pin the shared chrome and its consumer list so the tier cannot quietly drift
 * apart again.
 */

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const OVERLAY_CSS = read('src/overlay-tier.css');
const TOKENS_CSS = read('src/tokens.css');

/** Floating surfaces that must render with the shared overlay chrome. */
const CONSUMERS: ReadonlyArray<readonly [file: string, localClass: string]> = [
  ['src/components/ui/Dialog.tsx', 'ln-dialog'],
  ['src/FocusModePrefsDialog.tsx', 'focus-prefs-dialog'],
  ['src/KeyboardShortcutsDialog.tsx', 'ksd-dialog'],
  ['src/LayoutManagerDialog.tsx', 'layout-manager-dialog'],
  ['src/PageSetupPopover.tsx', 'page-setup-popover'],
  ['src/TourModal.tsx', 'tour-modal'],
  ['src/components/NoteTemplateDialog/index.tsx', 'ntd-dialog'],
];

/** Stylesheets whose panel rule must no longer hand-roll its own glass. */
const CONSUMER_CSS = [
  'src/components/ui/Dialog.css',
  'src/FocusModePrefsDialog.css',
  'src/KeyboardShortcutsDialog.css',
  'src/LayoutManagerDialog.css',
  'src/PageSetupPopover.css',
  'src/TourModal.css',
  'src/components/NoteTemplateDialog/NoteTemplateDialog.css',
] as const;

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[},])\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[2] ?? '';
}

describe('overlay tier — shared chrome', () => {
  it('reads the SKY-11133 overlay-tier fill and blur, not a flat surface token', () => {
    const supports =
      /@supports \(backdrop-filter: blur\(1px\)\)\s*\{([\s\S]*?)\n\}/.exec(OVERLAY_CSS)?.[1] ?? '';
    const glass = ruleBody(supports, '.ln-overlay-surface');
    expect(glass).toContain('var(--glass-fill-overlay)');
    expect(glass).toContain('blur(var(--blur-panel-overlay))');
    expect(glass).toContain('-webkit-backdrop-filter');
  });

  it('falls back to the opaque fill when backdrop-filter is unsupported', () => {
    expect(ruleBody(OVERLAY_CSS, '.ln-overlay-surface')).toContain('var(--glass-fill-fallback)');
  });

  it('carries the mockup border + neon glow, retintable via custom properties', () => {
    const base = ruleBody(OVERLAY_CSS, '.ln-overlay-surface');
    expect(base).toContain('var(--ln-overlay-border,');
    expect(base).toContain('var(--ln-overlay-glow,');
    // 0 14px 40px depth + 0 0 22px -6px glow — the repeated mockup recipe.
    expect(base).toContain('0 14px 40px');
    expect(base).toContain('0 0 22px -6px');
  });

  it('drops glow, tint and blur under the app high-contrast toggle', () => {
    // SKY-11532: the K8 block in tokens.css now flattens the v2 slot tokens
    // (--b1/--g1) directly, so .ln-overlay-surface's border/box-shadow
    // (which read --b1/--g1) resolve correctly without a local override here.
    const k8 = ruleBody(TOKENS_CSS, ':root[data-contrast="high"] :where(*)');
    expect(k8).toContain('--b1: var(--border-strong)');
    expect(k8).toContain('--g1: none');
    // blur still goes to 0px via --blur-panel-overlay, flattened in the same block.
    expect(k8).toContain('--blur-panel-overlay: 0px');
  });

  it('mirrors the high-contrast degrade for the OS prefers-contrast path', () => {
    const osBlock = /@media \(prefers-contrast: more\)\s*\{([\s\S]*?)\n\}/.exec(OVERLAY_CSS)?.[1] ?? '';
    expect(osBlock).toContain('.ln-overlay-surface');
    expect(osBlock).toContain('box-shadow: none');
    // This path does not flatten the glass tokens at :root, so the fill is restated.
    expect(osBlock).toContain('var(--glass-fill-fallback)');
  });
});

describe('overlay tier — consumers', () => {
  it.each(CONSUMERS)('%s applies ln-overlay-surface alongside .%s', (file, localClass) => {
    const src = read(file);
    expect(src).toContain(localClass);
    expect(src).toContain('ln-overlay-surface');
  });

  it.each(CONSUMER_CSS)('%s no longer hand-rolls an off-tier panel fill', (file) => {
    const css = read(file);
    // The three token families this ticket found in use across dialog panels.
    // None may reappear as a *panel* background; inner wells/inputs are fine,
    // so only the ones that were on the dialog root are listed here.
    expect(css).not.toContain('var(--bg-elevated);\n  box-shadow: var(--elev-3)');
    expect(css).not.toContain('var(--color-surface-elevated');
    expect(css).not.toContain('var(--color-surface-raised');
    expect(css).not.toContain('var(--color-surface-2');
  });
});
