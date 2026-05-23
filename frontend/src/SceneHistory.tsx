import { useState, useEffect, useCallback } from 'react';
import './SceneHistory.css';

interface Props {
  sceneId: string;
  scenePath: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Minimal line-level diff — returns array of {type, text} tokens. */
function lineDiff(
  a: string,
  b: string
): Array<{ type: 'same' | 'removed' | 'added'; text: string }> {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const result: Array<{ type: 'same' | 'removed' | 'added'; text: string }> = [];

  // LCS-based simple diff (good enough for prose)
  const m = aLines.length;
  const n = bLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aLines[i] === bLines[j]) {
      result.push({ type: 'same', text: aLines[i] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'added', text: bLines[j] });
      j++;
    } else {
      result.push({ type: 'removed', text: aLines[i] });
      i++;
    }
  }
  return result;
}

export default function SceneHistory({ sceneId, scenePath, currentContent, onRestore, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<SceneSnapshot[]>([]);
  const [selected, setSelected] = useState<SceneSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [diffLines, setDiffLines] = useState<Array<{ type: 'same' | 'removed' | 'added'; text: string }>>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.snapshotList(sceneId);
      setSnapshots(result.snapshots);
    } finally {
      setLoading(false);
    }
  }, [sceneId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!selected) { setDiffLines([]); return; }
    setDiffLines(lineDiff(selected.content, currentContent));
  }, [selected, currentContent]);

  const handleRestoreClick = () => {
    if (!selected) return;
    setShowConfirm(true);
  };

  const confirmRestore = async () => {
    if (!selected) return;
    setShowConfirm(false);
    setRestoring(true);
    try {
      const result = await window.api.snapshotRestore(sceneId, selected.id, scenePath);
      onRestore(result.restored.content);
      await reload();
    } finally {
      setRestoring(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const currentWC = wordCount(currentContent);

  return (
    <div className="history-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="history-panel" role="dialog" aria-label="Scene History">
        {showConfirm && (
          <div className="history-confirm-overlay">
            <div className="history-confirm-dialog" role="alertdialog" aria-label="Confirm rollback">
              <p className="history-confirm-msg">Restore this snapshot? Your current content will be saved as a new snapshot first.</p>
              <div className="history-confirm-actions">
                <button className="btn-cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
                <button className="btn-restore" onClick={confirmRestore} disabled={restoring}>
                  {restoring ? 'Restoring…' : 'Yes, restore'}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="history-header">
          <h2>Scene History</h2>
          <button className="history-close" onClick={onClose} aria-label="Close history">✕</button>
        </div>

        <div className="history-body">
          <div className="history-list">
            {loading && <p className="history-empty">Loading…</p>}
            {!loading && snapshots.length === 0 && (
              <p className="history-empty">No snapshots yet. Start writing to create one.</p>
            )}
            {snapshots.map((snap, idx) => {
              const delta = snap.wordCount - (snapshots[idx + 1]?.wordCount ?? snap.wordCount);
              const deltaLabel = delta === 0 ? '' : delta > 0 ? `+${delta}w` : `${delta}w`;
              return (
                <button
                  key={snap.id}
                  className={`history-item${selected?.id === snap.id ? ' selected' : ''}`}
                  onClick={() => setSelected(snap)}
                >
                  <span className="history-date">{formatDate(snap.createdAt)}</span>
                  <span className="history-wc">{snap.wordCount}w {deltaLabel && <em className={delta > 0 ? 'pos' : 'neg'}>{deltaLabel}</em>}</span>
                </button>
              );
            })}
          </div>

          <div className="history-preview">
            {!selected && (
              <p className="history-empty">Select a snapshot to preview.</p>
            )}
            {selected && (
              <>
                <div className="history-diff">
                  {diffLines.map((line, i) => (
                    <div key={i} className={`diff-line diff-${line.type}`}>
                      <span className="diff-gutter">
                        {line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' '}
                      </span>
                      <span className="diff-text">{line.text || ' '}</span>
                    </div>
                  ))}
                </div>
                <div className="history-actions">
                  <span className="history-meta">
                    Snapshot: {selected.wordCount}w · Current: {currentWC}w
                  </span>
                  <button
                    className="btn-restore"
                    onClick={handleRestoreClick}
                    disabled={restoring}
                  >
                    {restoring ? 'Restoring…' : 'Restore this snapshot'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
