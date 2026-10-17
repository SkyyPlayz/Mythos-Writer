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
      className="workspace-split-pane workspace-split-pane--flush"
      aria-label={`Split pane: ${meta.title}`}
      data-testid="workspace-split-pane"
    >
      {/* PLAN-058 L6 (83:18): remove duplicate Editor/Notes/Brainstorm sub-header;
          the floated module owns its own chrome (Brainstorm back, etc.). */}
      <button
        type="button"
        className="workspace-split-pane__close-floating"
        data-testid="workspace-split-pane-close"
        aria-label="Close split pane"
        title="Close split pane"
        onClick={onClose}
      >
        ×
      </button>
      <div className="workspace-split-pane__body">{children}</div>
    </section>
  );
}
