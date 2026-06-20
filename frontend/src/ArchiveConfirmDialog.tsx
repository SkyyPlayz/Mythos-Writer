import { useState, useCallback, useId } from 'react';
import Dialog, { DialogHeader, DialogBody, DialogFooter } from './components/ui/Dialog';
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
  const titleId = useId();

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
    <Dialog open onClose={onClose} aria-labelledby={titleId}>
      <DialogHeader onClose={onClose}>
        <h2 id={titleId}>Continuity Issue Found</h2>
      </DialogHeader>

      <DialogBody className="acd-body">
        <p className="acd-rationale">{rationale}</p>
        {anchorText && (
          <blockquote className="acd-anchor">
            &ldquo;{anchorText}&rdquo;
          </blockquote>
        )}
        {error && (
          <p className="acd-error" role="alert">{error}</p>
        )}
      </DialogBody>

      <DialogFooter>
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
      </DialogFooter>
    </Dialog>
  );
}
