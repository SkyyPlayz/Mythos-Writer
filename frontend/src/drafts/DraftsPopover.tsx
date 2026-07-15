// Beta 4 M10 — the doc-header Drafts popover, refreshed from Beta 3 M12 to
// the v2 prototype (Liquid Neon.dc.html 882–905, draftRows 6424–6427,
// keepN 7344–7346, autosaveSlider 6448) and re-based onto the M5 file store:
// numbered draft files served through the SKY-10 version IPC (useSceneDrafts
// upstream) instead of the SKY-1611 SQLite snapshots.
//
// Per-document version list (version label + delta chip + meta line,
// per-row Compare/Restore) over a footer with BOTH M10 settings:
//   · snapshot frequency — `editorPrefs.autosaveSeconds` (5–120s, the exact
//     field Settings → Editor's "Autosave snapshot every" slider manages);
//   · keep-count — `versions.maxPerScene` (the SKY-10/M5 store's retention
//     field, the one VersionHistorySection manages).
import { useCallback, useEffect, useRef, useState } from 'react';
import { countWords } from './diffSegments';
import type { SceneDraftEntry } from './useSceneDrafts';
import './DraftsPopover.css';

export interface DraftsPopoverProps {
  /** Human document label for the header, e.g. "Scene 4". */
  documentLabel: string;
  /** Stored drafts, newest first (from useSceneDrafts). */
  drafts: SceneDraftEntry[];
  /** Label of the live editor text, e.g. "Draft 7". */
  currentLabel: string;
  /** The editor's live text — the implicit newest "current" draft. */
  currentContent: string;
  /** Compare clicked: host opens the full diff against this draft. */
  onCompare: (draft: SceneDraftEntry) => void;
  /** Restore clicked: host runs the undoable load-draft flow. */
  onRestore: (draft: SceneDraftEntry) => void;
  /** Close request (outside click, Escape, or after a restore). */
  onClose: () => void;
  /** Toggle anchor excluded from outside-click closing (the "Draft N ▾" pill). */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

/** keep-N clamps match VersionHistorySection's input (min=1 max=500). */
const KEEP_MIN = 1;
const KEEP_MAX = 500;
const KEEP_DEFAULT = 100;
/** Frequency clamps match Settings → Editor's autosave slider (5–120s). */
const FREQ_MIN = 5;
const FREQ_MAX = 120;
const FREQ_STEP = 5;
const FREQ_DEFAULT = 30;

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
  documentLabel,
  drafts,
  currentLabel,
  currentContent,
  onCompare,
  onRestore,
  onClose,
  anchorRef,
}: DraftsPopoverProps) {
  const [keepN, setKeepN] = useState<number>(KEEP_DEFAULT);
  const [freqS, setFreqS] = useState<number>(FREQ_DEFAULT);
  const rootRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<AppSettings | null>(null);

  // Settings load: keep-N from versions.maxPerScene (the M5/SKY-10 store's
  // retention field), frequency from editorPrefs.autosaveSeconds.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const settings = await window.api.settingsGet();
        if (cancelled) return;
        settingsRef.current = settings;
        setKeepN(settings.versions?.maxPerScene ?? KEEP_DEFAULT);
        setFreqS(settings.editorPrefs?.autosaveSeconds ?? FREQ_DEFAULT);
      } catch { /* non-fatal — steppers start at the defaults */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Outside click + Escape close, same pattern as the title-bar popovers.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        if (anchorRef?.current && anchorRef.current.contains(target)) return;
        onClose();
      }
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
  }, [onClose, anchorRef]);

  const persistKeepN = useCallback((next: number) => {
    const clamped = Math.max(KEEP_MIN, Math.min(KEEP_MAX, next));
    setKeepN(clamped);
    const prev = settingsRef.current;
    if (!prev) return; // settings never loaded — nothing safe to write back
    const updated: AppSettings = {
      ...prev,
      versions: { maxAgeDays: prev.versions?.maxAgeDays ?? 0, maxPerScene: clamped },
    };
    settingsRef.current = updated;
    window.api.settingsSet(updated).catch(() => {});
  }, []);

  const persistFreq = useCallback((next: number) => {
    const clamped = Math.max(FREQ_MIN, Math.min(FREQ_MAX, next));
    setFreqS(clamped);
    const prev = settingsRef.current;
    if (!prev) return;
    const updated: AppSettings = {
      ...prev,
      editorPrefs: { ...prev.editorPrefs, autosaveSeconds: clamped },
    };
    settingsRef.current = updated;
    window.api.settingsSet(updated).catch(() => {});
  }, []);

  const currentWords = countWords(currentContent);

  return (
    <div
      ref={rootRef}
      className="ln-drafts-popover"
      role="dialog"
      aria-label={`Drafts and history — ${documentLabel}`}
      data-testid="ln-drafts-popover"
    >
      <div className="ln-drafts-heading">DRAFTS &amp; HISTORY</div>
      <div className="ln-drafts-scope">
        {documentLabel} <span className="ln-drafts-scope-hint">— drafts of what&apos;s open, nothing else</span>
      </div>

      <div className="ln-drafts-rows">
        {/* Synthetic top row: the live editor text is the current draft. */}
        <div className="ln-drafts-row" data-testid="ln-draft-row-current">
          <div className="ln-drafts-row-main">
            <div className="ln-drafts-row-title">
              {currentLabel}{' '}
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

        {drafts.map((draft, i) => {
          const words = countWords(draft.content);
          const newerContent = i === 0 ? currentContent : drafts[i - 1].content;
          const delta = formatDelta(countWords(newerContent), words);
          return (
            <div className="ln-drafts-row" key={draft.ts} data-testid={`ln-draft-row-${draft.ts}`}>
              <div className="ln-drafts-row-main">
                <div className="ln-drafts-row-title">
                  {draft.label}{' '}
                  <span className="ln-drafts-delta">{delta}</span>
                </div>
                <div className="ln-drafts-row-meta">
                  {words.toLocaleString()} words
                  {draft.savedAtMs !== null ? ` · ${relativeAge(draft.savedAtMs)}` : ''}
                </div>
              </div>
              <button
                type="button"
                className="ln-drafts-btn-compare"
                onClick={() => onCompare(draft)}
                aria-label={`Compare ${draft.label} with the current draft`}
              >
                Compare
              </button>
              <button
                type="button"
                className="ln-drafts-btn-restore"
                onClick={() => onRestore(draft)}
                aria-label={`Restore ${draft.label}`}
              >
                Restore
              </button>
            </div>
          );
        })}

        {drafts.length === 0 && (
          <div className="ln-drafts-empty">No snapshots yet — save to start collecting drafts.</div>
        )}
      </div>

      <div className="ln-drafts-footer">
        <span className="ln-drafts-footer-label">Snapshot every</span>
        <div className="ln-drafts-stepper">
          <button
            type="button"
            className="ln-drafts-step"
            onClick={() => persistFreq(freqS - FREQ_STEP)}
            aria-label="Snapshot less often"
          >
            −
          </button>
          <span className="ln-drafts-step-value" data-testid="ln-drafts-freq-s">{freqS}s</span>
          <button
            type="button"
            className="ln-drafts-step"
            onClick={() => persistFreq(freqS + FREQ_STEP)}
            aria-label="Snapshot more often"
          >
            +
          </button>
        </div>
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
