/**
 * F4#6 / F4#7 — structural breadcrumb trail.
 * Truncation priority: shrink middle/leaf crumbs first; root (first) crumb last.
 * Active crumb uses a full outline (not underline).
 *
 * Live story crumbs in ManuscriptView remain F1-owned for path data (book ›
 * part › chapter › scene). This component is the F4-owned presentation surface
 * for any host that supplies the crumb labels.
 */
import { type ReactElement } from 'react';
import './StructuralBreadcrumb.css';

export interface StructuralBreadcrumbProps {
  crumbs: string[];
  /** Index of the current (active) crumb; defaults to last. */
  currentIndex?: number;
  'aria-label'?: string;
}

export default function StructuralBreadcrumb({
  crumbs,
  currentIndex,
  'aria-label': ariaLabel = 'Document breadcrumb',
}: StructuralBreadcrumbProps): ReactElement | null {
  if (crumbs.length === 0) return null;
  const active = currentIndex ?? crumbs.length - 1;

  return (
    <nav className="struct-breadcrumb" aria-label={ariaLabel} data-testid="struct-breadcrumb">
      {crumbs.map((crumb, i) => {
        const isRoot = i === 0;
        const isCurrent = i === active;
        // flex-shrink: root tiny (truncate last); middle/leaf shrink first.
        const shrink = isRoot ? 0.01 : i === crumbs.length - 1 ? 2 : 1;
        return (
          <span
            key={`${i}-${crumb}`}
            className={
              'struct-breadcrumb__item' +
              (isRoot ? ' struct-breadcrumb__item--root' : '') +
              (isCurrent ? ' struct-breadcrumb__item--current' : '')
            }
            style={{ flexShrink: shrink }}
            data-testid={isRoot ? 'struct-breadcrumb-root' : `struct-breadcrumb-item-${i}`}
            aria-current={isCurrent ? 'location' : undefined}
            title={crumb}
          >
            {i > 0 && (
              <span className="struct-breadcrumb__sep" aria-hidden="true">
                {' '}
                ›{' '}
              </span>
            )}
            <span className="struct-breadcrumb__label">{crumb}</span>
          </span>
        );
      })}
    </nav>
  );
}
