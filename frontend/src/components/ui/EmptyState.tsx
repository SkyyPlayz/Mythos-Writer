import type { ReactNode } from 'react';
import './EmptyState.css';

/**
 * SKY-9879 (M10-S4): shared structural scaffold for empty states.
 *
 * The three empty-state surfaces (SceneEditorEmptyState, BrainstormEmptyState,
 * ContinuityEmptyState) each hand-rolled the same "glyph + optional title +
 * hint copy + optional actions" wrapper div with its own attribute wiring
 * (data-testid, role, aria-live, aria-label). This component unifies that
 * composition so there's one place that owns the shape.
 *
 * The *contents* of glyph/title/hint/actions — and all their visual styling —
 * stay fully owned by each caller, because they genuinely differ per surface
 * (SVG icon vs. spinner vs. unicode glyph; a keyboard-shortcut action list vs.
 * a CTA prompt list vs. no actions at all). Forcing those into one shared
 * shape would be exactly the kind of "diverge to make it fit" duplication
 * this refactor is meant to remove, not add.
 */
export interface EmptyStateProps {
  /** Decorative glyph/icon rendered above the copy (svg, spinner, unicode char, etc). */
  glyph?: ReactNode;
  /** Optional heading rendered between the glyph and the hint copy. */
  title?: ReactNode;
  /** Primary hint/body copy — every empty state has one. */
  hint: ReactNode;
  /** Optional actionable content (buttons/links) rendered below the hint. */
  actions?: ReactNode;
  /** Caller-owned wrapper class — carries that surface's existing visual styling. */
  className: string;
  testId?: string;
  /** Rendered as the wrapper's `data-variant` attribute, when a surface has variants. */
  dataVariant?: string;
  role?: string;
  ariaLive?: 'polite' | 'off';
  ariaLabel?: string;
}

export function EmptyState({
  glyph,
  title,
  hint,
  actions,
  className,
  testId,
  dataVariant,
  role,
  ariaLive,
  ariaLabel,
}: EmptyStateProps) {
  return (
    <div
      className={className}
      data-testid={testId}
      data-variant={dataVariant}
      role={role}
      aria-live={ariaLive}
      aria-label={ariaLabel}
    >
      {glyph}
      {title}
      {hint}
      {actions}
    </div>
  );
}
