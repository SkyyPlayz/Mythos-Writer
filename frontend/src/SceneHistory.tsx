import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './SceneHistory.css';

interface Props {
  sceneId: string;
  scenePath: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function wcDelta(snapshotText: string, currentText: string): string {
  const a = countWords(snapshotText);
  const b = countWords(currentText);
  const diff = a - b;
  if (diff === 0) return `${a} words`;
  const sign = diff > 0 ? '+' : '−';
  return `${a} words (${sign}${Math.abs(diff)})`;
}

export default function SceneHistory({ sceneId, currentContent, onRestore, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<DraftSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Non-blocking, but a *thrown* failure must surface rather than vanish.
    try {
      const res = await window.api.draftsList(sceneId);
      setSnapshots(res.snapshots);
    } catch (err) {
      setError(`Couldn't load draft history: ${(err as Error).message}`);
    }
  }, [sceneId]);

  useEffect(() => { void load(); }, [load]);

  const handleSelect = async (id: string) => {
    if (selectedId === id) return;
    setSelectedId(id);
    setPreviewContent(null);
    setError(null);
    try {
      const res = await window.api.draftsPreview(id);
      setPreviewContent(res.content);
    } catch (err) {
      setError(`Couldn't load this draft's preview: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      // Only mutate local UI state *after* the delete resolves — a failed
      // delete must not look like it succeeded.
      await window.api.draftsDelete(id);
      if (selectedId === id) {
        setSelectedId(null);
        setPreviewContent(null);
      }
      await load();
    } catch (err) {
      setError(`Couldn't delete this draft: ${(err as Error).message}`);
    }
  };

  const handleConfirmRestore = async () => {
    if (!confirmId) return;
    setRestoring(true);
    setError(null);
    try {
      // Only close / notify the parent once the restore actually resolves;
      // a failed restore must leave the dialog open and the store untouched.
      const res = await window.api.draftsRestore(confirmId, sceneId, currentContent);
      onRestore(res.content);
      setConfirmId(null);
      onClose();
    } catch (err) {
      setError(`Couldn't restore this draft: ${(err as Error).message}`);
    } finally {
      setRestoring(false);
    }
  };

  const selected = snapshots.find((s) => s.id === selectedId) ?? null;

  const dialog = (
    <div className="history-overlay" role="dialog" aria-modal="true" aria-label="Draft history">
      <div className="history-panel">
        <header className="history-header">
          <h2>Draft History</h2>
          <button
            type="button"
            className="history-close"
            onClick={onClose}
            aria-label="Close draft history"
          >
            ×
          </button>
        </header>

        {error && (
          <div className="history-error" role="alert">
            <span className="history-error-text">{error}</span>
            <button
              type="button"
              className="history-error-dismiss"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <div className="history-body">
          <aside className="history-list" aria-label="Snapshot list">
            {snapshots.length === 0 ? (
              <p className="history-empty">No drafts yet. Save a snapshot to start tracking history.</p>
            ) : (
              snapshots.map((snap) => (
                <div
                  key={snap.id}
                  className={`history-item${selectedId === snap.id ? ' selected' : ''}`}
                >
                  <button
                    type="button"
                    className="history-item-btn"
                    onClick={() => void handleSelect(snap.id)}
                    aria-label={`Draft from ${formatDate(snap.createdAt)}${snap.label ? `, ${snap.label}` : ''}`}
                    aria-pressed={selectedId === snap.id}
                  >
                    {snap.label && <span className="history-label">{snap.label}</span>}
                    <span className="history-date">{formatDate(snap.createdAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="history-item-delete"
                    onClick={() => void handleDelete(snap.id)}
                    aria-label="Delete this draft"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </aside>

          <section className="history-preview" aria-label="Snapshot preview">
            {previewContent !== null ? (
              <>
                <div className="history-content-view">{previewContent || '(empty)'}</div>
                <div className="history-actions">
                  <span className="history-meta">
                    {selected ? wcDelta(previewContent, currentContent) : ''}
                  </span>
                  <button
                    type="button"
                    className="btn-restore"
                    onClick={() => setConfirmId(selectedId)}
                    aria-label={`Restore draft from ${selected ? formatDate(selected.createdAt) : 'selected snapshot'}`}
                  >
                    Restore
                  </button>
                </div>
              </>
            ) : (
              <p className="history-empty">Select a snapshot to preview.</p>
            )}
          </section>
        </div>
      </div>

      {confirmId && (
        <div className="history-confirm-overlay">
          <div
            className="history-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm restore"
          >
            <p>
              This will replace the current scene with the selected draft. A backup of your current
              text will be saved first so you can undo.
            </p>
            <div className="history-confirm-actions">
              <button type="button" onClick={() => setConfirmId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-restore"
                onClick={() => void handleConfirmRestore()}
                disabled={restoring}
                aria-label="Confirm restore"
              >
                {restoring ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(dialog, document.body);
}
