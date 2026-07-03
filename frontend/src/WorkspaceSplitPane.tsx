import type { ReactNode } from 'react';
import { TAB_KIND_META } from './workspaceTabKinds';
import './WorkspaceSplitPane.css';

// GH#643 split panes v1: the right-hand workspace pane. Purely presentational —
// DesktopShell owns the split state and provides the surface as children.
// Lives as a third flex child of .desktop-shell__body (nav rail | main col | this).

export interface WorkspaceSplitPaneProps {
  kind: WorkspaceTabKind;
  onClose: () => void;
  children: ReactNode;
}

export default function WorkspaceSplitPane({ kind, onClose, children }: WorkspaceSplitPaneProps) {
  const meta = TAB_KIND_META[kind];
  return (
    <section
      className="workspace-split-pane"
      aria-label={`Split pane: ${meta.title}`}
      data-testid="workspace-split-pane"
    >
      <header className="workspace-split-pane__header">
        <span className="workspace-split-pane__icon" aria-hidden="true">{meta.icon}</span>
        <span className="workspace-split-pane__title">{meta.title}</span>
        <button
          type="button"
          className="workspace-split-pane__close"
          data-testid="workspace-split-pane-close"
          aria-label="Close split pane"
          title="Close split pane"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="workspace-split-pane__body">{children}</div>
    </section>
  );
}
