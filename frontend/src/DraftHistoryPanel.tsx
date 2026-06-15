import { useState, useEffect, useCallback } from 'react';
import './DraftHistoryPanel.css';

interface Props {
  sceneId: string;
  currentContent: string;
  onRestore: (content: string) => void;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DraftHistoryPanel({ sceneId, currentContent, onRestore }: Props) {
  const [snapshots, setSnapshots] = useState<DraftSnapshot[]>([]);
  const [open, setOpen] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelValue, setLabelValue] = useState('');
  const [restoring, setRestoring] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await window.api.draftsList(sceneId);
      setSnapshots(res.snapshots);
    } catch { /* non-fatal */ }
  }, [sceneId]);

  useEffect(() => { void reload(); }, [reload]);

  const handlePreviewToggle = async (id: string) => {
    if (previewId === id) {
      setPreviewId(null);
      setPreviewContent(null);
      return;
    }
    try {
      const res = await window.api.draftsPreview(id);
      setPreviewId(id);
      setPreviewContent(res.content);
    } catch { /* non-fatal */ }
  };

  const handleRestore = async () => {
    if (!confirmRestoreId) return;
    setRestoring(true);
    try {
      const res = await window.api.draftsRestore(confirmRestoreId, sceneId, currentContent);
      onRestore(res.content);
      setConfirmRestoreId(null);
      await reload();
    } catch { /* non-fatal */ } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await window.api.draftsDelete(id);
      if (previewId === id) {
        setPreviewId(null);
        setPreviewContent(null);
      }
      await reload();
    } catch { /* non-fatal */ }
  };

  const handleLabelSave = async (id: string) => {
    try {
      await window.api.draftsLabel(id, labelValue.trim());
      setEditingLabelId(null);
      await reload();
    } catch { /* non-fatal */ }
  };

  return (
    <section className="draft-history-panel" aria-label="Draft history">
      <button
        type="button"
        className={`draft-history-toggle${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Draft History {snapshots.length > 0 ? `(${snapshots.length})` : ''}
      </button>

      {open && (
        <div className="draft-history-body">
          {snapshots.length === 0 && (
            <p className="draft-history-empty">No drafts yet. Press Ctrl+S to save one.</p>
          )}

          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className={`draft-history-row${previewId === snap.id ? ' is-previewed' : ''}`}
            >
              <div className="draft-history-row-header">
                <button
                  type="button"
                  className="draft-history-date"
                  onClick={() => void handlePreviewToggle(snap.id)}
                  aria-expanded={previewId === snap.id}
                  aria-label={`Preview snapshot from ${formatTs(snap.createdAt)}`}
                >
                  {snap.label ? (
                    <>
                      <span className="draft-history-label">{snap.label}</span>
                      {' · '}
                      <span className="draft-history-ts">{formatTs(snap.createdAt)}</span>
                    </>
                  ) : (
                    formatTs(snap.createdAt)
                  )}
                </button>
                <div className="draft-history-row-actions">
                  <button
                    type="button"
                    className="draft-history-btn draft-history-btn--restore"
                    onClick={() => setConfirmRestoreId(snap.id)}
                    aria-label="Restore this draft"
                    title="Restore"
                  >
                    ↩
                  </button>
                  <button
                    type="button"
                    className="draft-history-btn draft-history-btn--label"
                    onClick={() => {
                      setEditingLabelId(snap.id);
                      setLabelValue(snap.label ?? '');
                    }}
                    aria-label="Edit label"
                    title="Label"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="draft-history-btn draft-history-btn--delete"
                    onClick={() => void handleDelete(snap.id)}
                    aria-label="Delete this draft"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>

              {editingLabelId === snap.id && (
                <div className="draft-history-label-edit">
                  <input
                    type="text"
                    value={labelValue}
                    onChange={(e) => setLabelValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleLabelSave(snap.id);
                      if (e.key === 'Escape') setEditingLabelId(null);
                    }}
                    placeholder="Label…"
                    autoFocus
                    aria-label="Draft label"
                  />
                  <button type="button" onClick={() => void handleLabelSave(snap.id)}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingLabelId(null)}>
                    Cancel
                  </button>
                </div>
              )}

              {previewId === snap.id && previewContent !== null && (
                <div className="draft-history-preview" role="region" aria-label="Snapshot preview">
                  <pre className="draft-history-preview-text">{previewContent || '(empty)'}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmRestoreId && (
        <div
          className="draft-history-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm restore"
        >
          <div className="draft-history-confirm">
            <p>This will replace the current scene. A backup of your current text will be saved first.</p>
            <div className="draft-history-confirm-actions">
              <button type="button" onClick={() => setConfirmRestoreId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void handleRestore()}
                disabled={restoring}
              >
                {restoring ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
