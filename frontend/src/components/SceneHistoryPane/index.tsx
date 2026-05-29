// SKY-10: SceneHistoryPane — per-scene version timeline with one-click rollback.
//
// Each row shows when the snapshot was taken, what intent it carried, and how
// much the content size differs from the current scene. Restoring asks for
// confirmation, then triggers a rollback that automatically snapshots the
// pre-rollback state so the action itself is reversible.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import './SceneHistoryPane.css';

export interface SceneHistoryPaneProps {
  sceneId: string | null;
  /** Length (chars) of the currently-on-screen scene prose. Used for delta. */
  currentLength: number;
  /** Called after a successful rollback so the editor can refresh from disk. */
  onRestored?: (restored: SceneVersion, preRollback: SceneVersion) => void;
  /** Optional close handler — when present, a "Close" button is rendered. */
  onClose?: () => void;
}

interface RowState {
  version: SceneVersion;
}

function relativeTimeFrom(iso: string, nowMs: number): string {
  // SKY-10 stamps look like "2026-05-28T22-31-04-123Z_00000001-9c2e1a07".
  // Strip the `_seq-hash` tail, then swap dashes back to `:`/`.` to recover
  // a parseable ISO string.
  const cleaned = iso.replace(/Z[_-].*$/, 'Z');
  const restored = cleaned.replace(/-(\d{2})-(\d{2})-(\d{3})Z/, ':$1:$2.$3Z');
  const t = Date.parse(restored);
  if (Number.isNaN(t)) return iso;
  const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86_400)}d ago`;
}

function intentChipLabel(intent: VersionIntent): string {
  switch (intent) {
    case 'save':
      return 'save';
    case 'auto':
      return 'auto';
    case 'agent-suggestion-applied':
      return 'agent';
    case 'pre-rollback':
      return 'pre-rollback';
    case 'migration':
      return 'migration';
    default:
      return intent;
  }
}

function deltaLabel(versionLength: number, currentLength: number): string {
  const delta = versionLength - currentLength;
  if (delta === 0) return 'same size';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta)} chars`;
}

export function SceneHistoryPane({
  sceneId,
  currentLength,
  onRestored,
  onClose,
}: SceneHistoryPaneProps): React.ReactElement {
  const [rows, setRows] = useState<RowState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<SceneVersion | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const nowMs = useMemo(() => new Date('2026-05-28T23:00:00Z').getTime(), []);
  // ^ memoized to keep relative-time labels stable inside a single render pass.

  const refresh = async () => {
    if (!sceneId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.versionList(sceneId);
      setRows(res.versions.map((version) => ({ version })));
      setActiveIndex(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  const handleRestoreClick = (version: SceneVersion) => {
    setPendingRestore(version);
  };

  const handleConfirmRestore = async () => {
    if (!sceneId || !pendingRestore) return;
    try {
      const res = await window.api.versionRollback(sceneId, pendingRestore.ts);
      setPendingRestore(null);
      onRestored?.(res.restoredVersion, res.preRollbackVersion);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setPendingRestore(null);
    }
  };

  const handleKeyNav = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      handleRestoreClick(rows[activeIndex].version);
    }
  };

  if (!sceneId) {
    return (
      <aside className="scene-history-pane" aria-label="Scene history">
        <header>
          <h2>History</h2>
        </header>
        <p className="scene-history-empty">Open a scene to see its history.</p>
      </aside>
    );
  }

  return (
    <aside
      className="scene-history-pane"
      aria-label="Scene history"
      data-scene-id={sceneId}
      data-testid="scene-history-pane"
    >
      <header>
        <h2>History</h2>
        {onClose ? (
          <button type="button" className="scene-history-close" onClick={onClose} aria-label="Close history">
            Close
          </button>
        ) : null}
      </header>

      {loading ? <p className="scene-history-loading">Loading…</p> : null}
      {error ? (
        <p role="alert" className="scene-history-error">
          {error}
        </p>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="scene-history-empty">No previous versions yet. Save the scene to start tracking history.</p>
      ) : null}

      {rows.length > 0 ? (
        <ul
          ref={listRef}
          className="scene-history-list"
          role="listbox"
          aria-label="Snapshot timeline"
          tabIndex={0}
          onKeyDown={handleKeyNav}
        >
          {rows.map((row, idx) => {
            const v = row.version;
            const tsIso = v.ts
              .replace(/Z[_-].*$/, 'Z')
              .replace(/-(\d{2})-(\d{2})-(\d{3})Z/, ':$1:$2.$3Z');
            return (
              <li
                key={v.ts}
                role="option"
                aria-selected={idx === activeIndex}
                aria-label={`Snapshot ${tsIso}, intent ${intentChipLabel(v.intent)}, ${deltaLabel(v.content.length, currentLength)}`}
                className={`scene-history-row${idx === activeIndex ? ' is-active' : ''}`}
                onClick={() => setActiveIndex(idx)}
                data-testid={`scene-history-row-${v.ts}`}
              >
                <span className="scene-history-time">{relativeTimeFrom(v.ts, nowMs)}</span>
                <span className={`scene-history-intent scene-history-intent--${v.intent}`}>{intentChipLabel(v.intent)}</span>
                <span className="scene-history-delta">{deltaLabel(v.content.length, currentLength)}</span>
                <button
                  type="button"
                  className="scene-history-restore"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRestoreClick(v);
                  }}
                  aria-label={`Restore snapshot from ${tsIso}`}
                >
                  Restore
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {pendingRestore ? (
        <div role="dialog" aria-modal="true" aria-label="Confirm restore" className="scene-history-confirm">
          <p>
            Restore this version? Your current text will be saved as a pre-rollback snapshot you can return to.
          </p>
          <div className="scene-history-confirm-actions">
            <button type="button" onClick={() => setPendingRestore(null)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={handleConfirmRestore}>
              Restore
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default SceneHistoryPane;
