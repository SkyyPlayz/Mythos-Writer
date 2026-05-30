import { useState, useEffect, useCallback } from 'react';
import './SceneHistory.css';

interface Props {
  sceneId: string;
  scenePath: string;
  currentContent: string;
  onRestore: (content: string) => void;
  onClose: () => void;
}

type ViewMode = 'diff' | 'side-by-side' | 'view';

interface LineToken {
  type: 'same' | 'removed' | 'added';
  text: string;
}

interface WordToken {
  type: 'same' | 'changed';
  text: string;
}

interface DiffBlock {
  kind: 'same' | 'changed' | 'removed-only' | 'added-only';
  leftLines: string[];
  rightLines: string[];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** LCS-based line-level diff. */
function lineDiff(a: string, b: string): LineToken[] {
  const aL = a.split('\n'), bL = b.split('\n');
  const m = aL.length, n = bL.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aL[i] === bL[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: LineToken[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aL[i] === bL[j]) {
      result.push({ type: 'same', text: aL[i] }); i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'added', text: bL[j] }); j++;
    } else {
      result.push({ type: 'removed', text: aL[i] }); i++;
    }
  }
  return result;
}

/** Word-level diff for inline highlighting within a pair of changed lines. */
function wordDiff(a: string, b: string): { left: WordToken[]; right: WordToken[] } {
  const aW = a.split(/(\s+)/), bW = b.split(/(\s+)/);
  const m = aW.length, n = bW.length;
  if (m * n > 40000) {
    // Too long — treat whole lines as changed
    return { left: [{ type: 'changed', text: a }], right: [{ type: 'changed', text: b }] };
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aW[i] === bW[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left: WordToken[] = [], right: WordToken[] = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && aW[i] === bW[j]) {
      left.push({ type: 'same', text: aW[i] });
      right.push({ type: 'same', text: aW[j] });
      i++; j++;
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      right.push({ type: 'changed', text: bW[j] }); j++;
    } else {
      left.push({ type: 'changed', text: aW[i] }); i++;
    }
  }
  return { left, right };
}

/** Convert a line-level diff into side-by-side blocks. */
function toSideBySideBlocks(tokens: LineToken[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].type === 'same') {
      blocks.push({ kind: 'same', leftLines: [tokens[i].text], rightLines: [tokens[i].text] });
      i++;
    } else {
      // Collect contiguous removed and added
      const removed: string[] = [], added: string[] = [];
      while (i < tokens.length && tokens[i].type === 'removed') { removed.push(tokens[i].text); i++; }
      while (i < tokens.length && tokens[i].type === 'added') { added.push(tokens[i].text); i++; }
      if (removed.length > 0 && added.length > 0) {
        blocks.push({ kind: 'changed', leftLines: removed, rightLines: added });
      } else if (removed.length > 0) {
        blocks.push({ kind: 'removed-only', leftLines: removed, rightLines: [] });
      } else {
        blocks.push({ kind: 'added-only', leftLines: [], rightLines: added });
      }
    }
  }
  return blocks;
}

function WordSpan({ tokens }: { tokens: WordToken[] }) {
  return (
    <>
      {tokens.map((t, i) => (
        t.type === 'same'
          ? <span key={i}>{t.text}</span>
          : <mark key={i} className="diff-word-changed">{t.text}</mark>
      ))}
    </>
  );
}

export default function SceneHistory({ sceneId, scenePath, currentContent, onRestore, onClose }: Props) {
  const [snapshots, setSnapshots] = useState<SceneSnapshot[]>([]);
  const [selected, setSelected] = useState<SceneSnapshot | null>(null);
  const [compareWith, setCompareWith] = useState<SceneSnapshot | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('diff');
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  // Reset compare target when selected changes
  useEffect(() => { setCompareWith(null); }, [selected]);

  const handleRestore = async () => {
    if (!selected) return;
    setRestoring(true);
    setConfirmRestore(false);
    try {
      const result = await window.api.snapshotRestore(sceneId, selected.id, scenePath);
      onRestore(result.restored.content);
      await reload();
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async (snap: SceneSnapshot) => {
    setDeletingId(snap.id);
    try {
      await window.api.snapshotDelete(sceneId, snap.id);
      if (selected?.id === snap.id) setSelected(null);
      if (compareWith?.id === snap.id) setCompareWith(null);
      await reload();
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ── Diff computation ────────────────────────────────────
  const leftText = selected?.content ?? '';
  const rightText = viewMode === 'side-by-side' && compareWith ? compareWith.content : currentContent;

  const diffTokens = selected ? lineDiff(leftText, rightText) : [];
  const sideBlocks = viewMode === 'side-by-side' ? toSideBySideBlocks(diffTokens) : [];

  const currentWC = wordCount(currentContent);

  return (
    <div className="history-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="history-panel" role="dialog" aria-label="Scene History">
        <div className="history-header">
          <h2>Scene History</h2>
          <div className="history-view-tabs" role="tablist">
            {(['diff', 'side-by-side', 'view'] as ViewMode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={viewMode === m}
                className={`history-tab${viewMode === m ? ' active' : ''}`}
                onClick={() => setViewMode(m)}
              >
                {m === 'diff' ? 'Diff' : m === 'side-by-side' ? 'Side by Side' : 'View'}
              </button>
            ))}
          </div>
          <button className="history-close" onClick={onClose} aria-label="Close history">✕</button>
        </div>

        <div className="history-body">
          {/* Left: snapshot list */}
          <div className="history-list">
            {loading && <p className="history-empty">Loading…</p>}
            {!loading && snapshots.length === 0 && (
              <p className="history-empty">No snapshots yet. Start writing to create one.</p>
            )}
            {snapshots.map((snap, idx) => {
              const delta = snap.wordCount - (snapshots[idx + 1]?.wordCount ?? snap.wordCount);
              const deltaLabel = delta === 0 ? '' : delta > 0 ? `+${delta}w` : `${delta}w`;
              const isSelected = selected?.id === snap.id;
              const isCompare = compareWith?.id === snap.id;
              return (
                <div
                  key={snap.id}
                  className={`history-item${isSelected ? ' selected' : ''}${isCompare ? ' compare' : ''}`}
                >
                  <button
                    className="history-item-btn"
                    onClick={() => {
                      if (viewMode === 'side-by-side' && selected && !isSelected) {
                        setCompareWith(snap);
                      } else {
                        setSelected(isSelected ? null : snap);
                        setCompareWith(null);
                      }
                    }}
                  >
                    {snap.label && <span className="history-label">{snap.label}</span>}
                    <span className="history-date">{formatDate(snap.createdAt)}</span>
                    <span className="history-wc">
                      {snap.wordCount}w
                      {deltaLabel && <em className={delta > 0 ? 'pos' : 'neg'}>{deltaLabel}</em>}
                    </span>
                  </button>
                  <button
                    className="history-item-delete"
                    aria-label="Delete snapshot"
                    disabled={deletingId === snap.id}
                    onClick={() => handleDelete(snap)}
                    title="Delete snapshot"
                  >
                    {deletingId === snap.id ? '…' : '×'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right: preview / diff */}
          <div className="history-preview">
            {!selected && (
              <p className="history-empty">Select a snapshot to preview.</p>
            )}

            {selected && viewMode === 'view' && (
              <div className="history-content-view" aria-readonly="true">
                {selected.content || <span className="history-empty">Empty snapshot.</span>}
              </div>
            )}

            {selected && viewMode === 'diff' && (
              <div className="history-diff" role="region" aria-label="Snapshot diff">
                {diffTokens.map((line, i) => (
                  <div key={i} className={`diff-line diff-${line.type}`}>
                    <span className="diff-gutter">
                      {line.type === 'removed' ? '−' : line.type === 'added' ? '+' : ' '}
                    </span>
                    <span className="diff-text">{line.text || ' '}</span>
                  </div>
                ))}
              </div>
            )}

            {selected && viewMode === 'side-by-side' && (
              <div className="history-side-by-side">
                {!compareWith && (
                  <p className="history-compare-hint">Click a second snapshot to compare, or compare vs. current below.</p>
                )}
                <div className="history-side-headers">
                  <div className="history-side-label">
                    {selected.label ?? formatDate(selected.createdAt)}
                  </div>
                  <div className="history-side-label">
                    {compareWith ? (compareWith.label ?? formatDate(compareWith.createdAt)) : 'Current'}
                  </div>
                </div>
                <div className="history-side-panes">
                  <div className="history-side-pane history-side-left">
                    {sideBlocks.map((block, bi) => {
                      if (block.kind === 'same') {
                        return block.leftLines.map((ln, li) => (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-same">{ln || ' '}</div>
                        ));
                      }
                      if (block.kind === 'removed-only') {
                        return block.leftLines.map((ln, li) => (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-removed">{ln || ' '}</div>
                        ));
                      }
                      if (block.kind === 'added-only') {
                        return block.rightLines.map((_, li) => (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-empty"> </div>
                        ));
                      }
                      // changed — word-level diff
                      return block.leftLines.map((ln, li) => {
                        const rLine = block.rightLines[li] ?? '';
                        const { left } = wordDiff(ln, rLine);
                        return (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-changed">
                            <WordSpan tokens={left} />
                          </div>
                        );
                      });
                    })}
                  </div>
                  <div className="history-side-divider" />
                  <div className="history-side-pane history-side-right">
                    {sideBlocks.map((block, bi) => {
                      if (block.kind === 'same') {
                        return block.rightLines.map((ln, li) => (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-same">{ln || ' '}</div>
                        ));
                      }
                      if (block.kind === 'added-only') {
                        return block.rightLines.map((ln, li) => (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-added">{ln || ' '}</div>
                        ));
                      }
                      if (block.kind === 'removed-only') {
                        return block.leftLines.map((_, li) => (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-empty"> </div>
                        ));
                      }
                      // changed
                      return block.rightLines.map((ln, li) => {
                        const lLine = block.leftLines[li] ?? '';
                        const { right } = wordDiff(lLine, ln);
                        return (
                          <div key={`${bi}-${li}`} className="sbs-line sbs-changed">
                            <WordSpan tokens={right} />
                          </div>
                        );
                      });
                    })}
                  </div>
                </div>
              </div>
            )}

            {selected && (
              <div className="history-actions">
                <span className="history-meta">
                  {viewMode !== 'side-by-side'
                    ? `Snapshot: ${selected.wordCount}w · Current: ${currentWC}w`
                    : compareWith
                      ? `${selected.wordCount}w → ${compareWith.wordCount}w`
                      : `Snapshot: ${selected.wordCount}w · Current: ${currentWC}w`}
                </span>
                <button
                  className="btn-restore"
                  onClick={() => setConfirmRestore(true)}
                  disabled={restoring}
                >
                  {restoring ? 'Restoring…' : 'Restore this snapshot'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Restore confirmation dialog */}
      {confirmRestore && (
        <div className="history-confirm-overlay" onClick={() => setConfirmRestore(false)}>
          <div className="history-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>Replace current scene content with this snapshot? This cannot be undone (a pre-restore snapshot will be saved automatically).</p>
            <div className="history-confirm-actions">
              <button onClick={() => setConfirmRestore(false)}>Cancel</button>
              <button className="btn-restore" onClick={handleRestore}>Restore</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
