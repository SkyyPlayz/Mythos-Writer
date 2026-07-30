import './SceneEditorEmptyState.css';

export type SceneEditorEmptyVariant = 'select-scene' | 'loading' | 'no-scenes-yet';

interface Props {
  variant: SceneEditorEmptyVariant;
  /** SKY-8907: Obsidian-style pane action card — omitted actions are hidden. */
  onCreateNew?: () => void;
  onGoTo?: () => void;
  onClosePane?: () => void;
}

function DocumentIcon() {
  return (
    <svg
      className="se-empty-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      role="img"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <div className="se-empty-spinner" aria-hidden="true" />
  );
}

/** SKY-8907 (Obsidian empty-pane parity): Create new scene / Go to scene / Close. */
function PaneActionCard({ onCreateNew, onGoTo, onClosePane }: Omit<Props, 'variant'>) {
  if (!onCreateNew && !onGoTo && !onClosePane) return null;
  return (
    <div className="se-empty-actions" data-testid="scene-editor-empty-actions">
      {onCreateNew && (
        <button
          type="button"
          className="se-empty-action"
          onClick={onCreateNew}
          data-testid="se-empty-action-create"
        >
          <span className="se-empty-action-label">Create new scene</span>
          <span className="se-empty-action-shortcut">Ctrl+N</span>
        </button>
      )}
      {onGoTo && (
        <button
          type="button"
          className="se-empty-action"
          onClick={onGoTo}
          data-testid="se-empty-action-goto"
        >
          <span className="se-empty-action-label">Go to scene</span>
          <span className="se-empty-action-shortcut">Ctrl+O</span>
        </button>
      )}
      {onClosePane && (
        <button
          type="button"
          className="se-empty-action"
          onClick={onClosePane}
          data-testid="se-empty-action-close"
        >
          <span className="se-empty-action-label">Close</span>
        </button>
      )}
    </div>
  );
}

export function SceneEditorEmptyState({ variant, onCreateNew, onGoTo, onClosePane }: Props) {
  if (variant === 'loading') {
    return (
      <div
        className="se-empty-state se-empty-state--loading"
        data-testid="scene-editor-empty"
        data-variant="loading"
        role="status"
        aria-live="polite"
      >
        <LoadingSpinner />
        <p className="se-empty-body">Loading your scene…</p>
      </div>
    );
  }

  if (variant === 'no-scenes-yet') {
    return (
      <div
        className="se-empty-state se-empty-state--no-scenes"
        data-testid="scene-editor-empty"
        data-variant="no-scenes-yet"
      >
        <DocumentIcon />
        <p className="se-empty-body">
          Create your first scene to start writing. Use the&nbsp;+ button in your story outline.
        </p>
        <PaneActionCard onCreateNew={onCreateNew} onGoTo={onGoTo} onClosePane={onClosePane} />
      </div>
    );
  }

  return (
    <div
      className="se-empty-state se-empty-state--select"
      data-testid="scene-editor-empty"
      data-variant="select-scene"
    >
      <DocumentIcon />
      <p className="se-empty-body">Select a scene from your story to start writing.</p>
      <PaneActionCard onCreateNew={onCreateNew} onGoTo={onGoTo} onClosePane={onClosePane} />
    </div>
  );
}
