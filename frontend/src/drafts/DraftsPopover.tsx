// Beta 3 "Liquid Neon" M12 — the doc-header Drafts popover (prototype
// 673–694, row data drafts/draftRows 3098–3103 + 4460–4463): per-document
// version list with version label + delta chip + meta line, per-row
// Compare/Restore, and a footer with the snapshot-cadence label and the
// keep-N stepper. Versions come from the existing SKY-1611 drafts IPC
// (draftsList/draftsPreview/draftsRestore — same flow as SceneHistory.tsx);
// keep-N persists to `settings.snapshots.maxPerScene`, the exact field
// SettingsPanel's SnapshotsSection manages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { countWords } from './diffSegments';
import './DraftsPopover.css';

export interface DraftCompareRequest {
  /** The snapshot picked for comparison (older side of the diff). */
  snapshot: DraftSnapshot;
  /** That snapshot's full text, already fetched via draftsPreview. */
  content: string;
  /** Display label for the snapshot, e.g. "Draft 6". */
  label: string;
}

export interface DraftsPopoverProps {
  /** Scene/document id the drafts belong to (draftsList key). */
  sceneId: string;
  /** Human document label for the header, e.g. "Scene 4". */
  documentLabel: string;
  /** The editor's live text — the implicit newest "current" draft. */
  currentContent: string;
  /** Compare clicked: host opens DraftDiffView with old = payload, new = current. */
  onCompare: (payload: DraftCompareRequest) => void;
  /** Restore resolved: host swaps the editor content (same contract as SceneHistory). */
  onRestore: (content: string) => void;
  /** Close request (outside click, Escape, or after a restore). */
  onClose: () => void;
  /**
   * Footer cadence label — "Snapshot every {label}". Display-only: the app
   * snapshots on every save and AppSettings has no interval field, so the
   * default reads "save". Hosts with a cadence can pass e.g. "30s".
   */
  autosaveIntervalLabel?: string;
}

/** keep-N clamps match SnapshotsSection's input (min=1 max=500). */
const KEEP_MIN = 1;
const KEEP_MAX = 500;
const KEEP_DEFAULT = 100;
const KEEP_AGE_DEFAULT = 30;

/** Prototype-style compact age: "2m ago" · "yesterday" · "2 days ago". */
function relativeAge(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Delta chip vs the next-newer draft: "+51 words" / "−12 words" / "±0 words". */
function formatDelta(newerWords: number, thisWords: number): string {
  const diff = newerWords - thisWords;
  if (diff === 0) return '±0 words';
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} words`;
}

export default function DraftsPopover({
  sceneId,
  documentLabel,
  currentContent,
  onCompare,
  onRestore,
  onClose,
  autosaveIntervalLabel = 'save',
}: DraftsPopoverProps) {
  const [snapshots, setSnapshots] = useState<DraftSnapshot[]>([]);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [keepN, setKeepN] = useState<number>(KEEP_DEFAULT);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<AppSettings | null>(null);

  // Load the version list, then previews in parallel for word counts/deltas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.api.draftsList(sceneId);
        if (cancelled) return;
        setSnapshots(res.snapshots);
        const pairs = await Promise.all(
          res.snapshots.map(async (snap) => {
            try {
              const preview = await window.api.draftsPreview(snap.id);
              return [snap.id, preview.content] as const;
            } catch {
              return null; // meta stays pending for this row; actions still work
            }
          }),
        );
        if (cancelled) return;
        setContents(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)));
      } catch (err) {
        if (!cancelled) setError(`Couldn't load drafts: ${(err as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [sceneId]);

  // keep-N from the same settings field SnapshotsSection manages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await window.api.settingsGet();
        if (cancelled) return;
        settingsRef.current = settings;
        setKeepN(settings.snapshots?.maxPerScene ?? KEEP_DEFAULT);
      } catch { /* non-fatal — stepper starts at the default */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Outside click + Escape close, same pattern as the title-bar popovers.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const persistKeepN = useCallback((next: number) => {
    const clamped = Math.max(KEEP_MIN, Math.min(KEEP_MAX, next));
    setKeepN(clamped);
    const prev = settingsRef.current;
    if (!prev) return; // settings never loaded — nothing safe to write back
    const updated: AppSettings = {
      ...prev,
      snapshots: { maxAgeDays: prev.snapshots?.maxAgeDays ?? KEEP_AGE_DEFAULT, maxPerScene: clamped },
    };
    settingsRef.current = updated;
    window.api.settingsSet(updated).catch(() => {});
  }, []);

  const handleCompare = useCallback(async (snap: DraftSnapshot, label: string) => {
    setError(null);
    try {
      const content = contents[snap.id] ?? (await window.api.draftsPreview(snap.id)).content;
      onCompare({ snapshot: snap, content, label });
    } catch (err) {
      setError(`Couldn't load this draft: ${(err as Error).message}`);
    }
  }, [contents, onCompare]);

  const handleRestore = useCallback(async (snap: DraftSnapshot) => {
    setRestoringId(snap.id);
    setError(null);
    try {
      // Existing restore flow (SceneHistory/DraftHistoryPanel): the main
      // process snapshots the current text first, so nothing is ever lost.
      const res = await window.api.draftsRestore(snap.id, sceneId, currentContent);
      onRestore(res.content);
      onClose();
    } catch (err) {
      setError(`Couldn't restore this draft: ${(err as Error).message}`);
    } finally {
      setRestoringId(null);
    }
  }, [sceneId, currentContent, onRestore, onClose]);

  const currentWords = countWords(currentContent);

  return (
    <div
      ref={rootRef}
      className="ln-drafts-popover"
      role="dialog"
      aria-label={`Drafts and history — ${documentLabel}`}
      data-testid="ln-drafts-popover"
    >
      <div className="ln-drafts-heading">DRAFTS &amp; HISTORY — {documentLabel.toUpperCase()}</div>

      {error && (
        <div className="ln-drafts-error" role="alert">{error}</div>
      )}

      <div className="ln-drafts-rows">
        {/* Synthetic top row: the live editor text is the current draft. */}
        <div className="ln-drafts-row" data-testid="ln-draft-row-current">
          <div className="ln-drafts-row-main">
            <div className="ln-drafts-row-title">
              Draft {snapshots.length + 1}{' '}
              <span className="ln-drafts-delta is-current">current</span>
            </div>
            <div className="ln-drafts-row-meta">{currentWords.toLocaleString()} words · now</div>
          </div>
          <button type="button" className="ln-drafts-btn-compare" disabled title="Already the current draft">
            Compare
          </button>
          <button type="button" className="ln-drafts-btn-restore" disabled title="Already the current draft">
            Restore
          </button>
        </div>

        {snapshots.map((snap, i) => {
          const label = snap.label || `Draft ${snapshots.length - i}`;
          const content = contents[snap.id];
          const words = content !== undefined ? countWords(content) : null;
          const newerContent = i === 0 ? currentContent : contents[snapshots[i - 1].id];
          const delta =
            words !== null && newerContent !== undefined
              ? formatDelta(countWords(newerContent), words)
              : '';
          return (
            <div className="ln-drafts-row" key={snap.id} data-testid={`ln-draft-row-${snap.id}`}>
              <div className="ln-drafts-row-main">
                <div className="ln-drafts-row-title">
                  {label}{' '}
                  {delta && <span className="ln-drafts-delta">{delta}</span>}
                </div>
                <div className="ln-drafts-row-meta">
                  {words !== null ? `${words.toLocaleString()} words · ` : ''}
                  {relativeAge(snap.createdAt)}
                </div>
              </div>
              <button
                type="button"
                className="ln-drafts-btn-compare"
                onClick={() => void handleCompare(snap, label)}
                aria-label={`Compare ${label} with the current draft`}
              >
                Compare
              </button>
              <button
                type="button"
                className="ln-drafts-btn-restore"
                onClick={() => void handleRestore(snap)}
                disabled={restoringId !== null}
                aria-label={`Restore ${label}`}
              >
                {restoringId === snap.id ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          );
        })}

        {snapshots.length === 0 && (
          <div className="ln-drafts-empty">No snapshots yet — save to start collecting drafts.</div>
        )}
      </div>

      <div className="ln-drafts-footer">
        <span className="ln-drafts-footer-label">Snapshot every {autosaveIntervalLabel}</span>
        <span className="ln-drafts-footer-keep">Keep</span>
        <div className="ln-drafts-stepper">
          <button
            type="button"
            className="ln-drafts-step"
            onClick={() => persistKeepN(keepN - 1)}
            aria-label="Keep fewer snapshots"
          >
            −
          </button>
          <span className="ln-drafts-step-value" data-testid="ln-drafts-keep-n">{keepN}</span>
          <button
            type="button"
            className="ln-drafts-step"
            onClick={() => persistKeepN(keepN + 1)}
            aria-label="Keep more snapshots"
          >
            +
          </button>
        </div>
      </div>
      <div className="ln-drafts-hint">A snapshot is kept on every save — nothing is ever lost.</div>
    </div>
  );
}
