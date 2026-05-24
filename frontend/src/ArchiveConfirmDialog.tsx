import { useState, useCallback } from 'react';
import './ArchiveConfirmDialog.css';

export type ArchiveConfirmAction = 'match_archive' | 'suggest_story_change' | 'ignore';

export interface ArchiveConfirmDialogProps {
  suggestionId: string;
  rationale: string;
  anchorText: string;
  onClose: () => void;
  onResolved: (action: ArchiveConfirmAction) => void;
}

export default function ArchiveConfirmDialog({
  suggestionId,
  rationale,
  anchorText,
  onClose,
  onResolved,
}: ArchiveConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = useCallback(async (action: ArchiveConfirmAction) => {
    setBusy(true);
    setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (window as any).api;
      if (typeof api?.archiveConfirm === 'function') {
        const result = await api.archiveConfirm(suggestionId, action);
        if (result?.error) throw new Error(result.error);
      }
      onResolved(action);
    } catch (err) {
      setError((err as Error).message ?? 'An unexpected error occurred.');
      setBusy(false);
    }
  }, [suggestionId, onResolved]);

  return (
    <div
      className="acd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Archive continuity issue"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="acd-dialog">
        <header className="acd-header">
          <h2 className="acd-title">Continuity Issue Found</h2>
          <button
            className="acd-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close dialog"
          >
            ✕
          </button>
        </header>

        <div className="acd-body">
          <p className="acd-rationale">{rationale}</p>
          {anchorText && (
            <blockquote className="acd-anchor">
              &ldquo;{anchorText}&rdquo;
            </blockquote>
          )}

          {error && (
            <p className="acd-error" role="alert">{error}</p>
          )}
        </div>

        <footer className="acd-footer">
          <div className="acd-actions">
            <button
              className="acd-btn acd-btn-match"
              onClick={() => handleAction('match_archive')}
              disabled={busy}
              aria-label="Update vault to match manuscript"
              title="Update the vault entity to reflect what the manuscript says"
            >
              Match Archive to Story
            </button>
            <button
              className="acd-btn acd-btn-suggest"
              onClick={() => handleAction('suggest_story_change')}
              disabled={busy}
              aria-label="Create suggestion to revise manuscript"
              title="Leave the vault unchanged and create a revision suggestion for the manuscript"
            >
              Suggest Story Change
            </button>
            <button
              className="acd-btn acd-btn-ignore"
              onClick={() => handleAction('ignore')}
              disabled={busy}
              aria-label="Ignore this finding"
              title="Silence this finding so it does not re-surface"
            >
              Ignore
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
