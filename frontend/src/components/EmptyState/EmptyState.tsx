import type { ReactNode } from 'react';
import './EmptyState.css';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  testId?: string;
}

interface Props {
  /** Glyph shown above the heading — an inline SVG or icon component. */
  icon: ReactNode;
  heading: string;
  hint?: ReactNode;
  /** Omit when this surface has no real next step to offer yet. */
  action?: EmptyStateAction;
  className?: string;
  testId?: string;
}

// SKY-9879: one shared glyph + hint + action shape for every empty state,
// instead of each surface reinventing its own markup (§2 standing rule).
export function EmptyState({ icon, heading, hint, action, className, testId }: Props) {
  return (
    <div className={`ui-empty-state${className ? ` ${className}` : ''}`} data-testid={testId}>
      <span className="ui-empty-state-icon" aria-hidden="true">{icon}</span>
      <h2 className="ui-empty-state-heading">{heading}</h2>
      {hint && <p className="ui-empty-state-hint">{hint}</p>}
      {action && (
        <button
          type="button"
          className="ui-empty-state-action"
          onClick={action.onClick}
          data-testid={action.testId}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
