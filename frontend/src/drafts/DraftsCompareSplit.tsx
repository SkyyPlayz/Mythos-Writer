// Beta 4 M10 — the drafts compare split pane (v2 prototype "Liquid Neon"
// splitIsDrafts block, HTML 1221–1245 + 6876–7062).
//
// Renders beside the editor. Header row: `DRAFTS — <scope>` chip (scope is
// always the OPEN scene/chapter) · draft select · "Highlight changes" toggle
// (default ON) · "Full diff" (green/red dots) · gradient "Load draft" ·
// yellow "Undo" chip while a loaded draft can be rolled back · close.
// Body: read-only compare text of the selected draft — diff-highlighted when
// the toggle is on (prototype splitParas2/dSeg), plain paragraphs otherwise.
//
// Store/side effects stay with the host (DesktopShell): this component gets
// the newest-first draft list from useSceneDrafts and reports intents up.
import { useEffect, useMemo, useState } from 'react';
import DraftDiffView from './DraftDiffView';
import { countWords } from './diffSegments';
import type { SceneDraftEntry } from './useSceneDrafts';
import './DraftsCompareSplit.css';

export interface DraftsCompareSplitProps {
  /** Compare scope label — the OPEN scene/chapter, e.g. "Scene 4: The Gate". */
  scopeLabel: string;
  /** Stored drafts, newest first (from useSceneDrafts). */
  drafts: SceneDraftEntry[];
  /** Label of the live editor text, e.g. "Draft 7". */
  currentLabel: string;
  /** The live editor text (the diff's current side). */
  currentContent: string;
  /** ts of the draft shown on the compare side; null → newest. */
  selectedTs: string | null;
  onSelectTs: (ts: string) => void;
  /** "Full diff" clicked — host opens the side-by-side DraftDiffView. */
  onFullDiff: () => void;
  /** "Load draft" clicked with the selected draft. */
  onLoadDraft: (draft: SceneDraftEntry) => void;
  /** Label of the loaded draft while undo is available, else null. */
  undoLabel: string | null;
  /** Yellow Undo chip clicked — host restores the exact pre-load state. */
  onUndo: () => void;
  onClose: () => void;
  /** Store fetch error from the host hook, surfaced inline. */
  error?: string | null;
}

export default function DraftsCompareSplit({
  scopeLabel,
  drafts,
  currentLabel,
  currentContent,
  selectedTs,
  onSelectTs,
  onFullDiff,
  onLoadDraft,
  undoLabel,
  onUndo,
  onClose,
  error = null,
}: DraftsCompareSplitProps) {
  // "Highlight changes" defaults ON (prototype splitHlOn: true).
  const [highlightOn, setHighlightOn] = useState(true);

  const selected = useMemo(
    () => drafts.find((d) => d.ts === selectedTs) ?? drafts[0] ?? null,
    [drafts, selectedTs],
  );

  // Keep the host's selection in sync when it points at a pruned draft.
  useEffect(() => {
    if (selectedTs !== null && selected && selected.ts !== selectedTs) {
      onSelectTs(selected.ts);
    }
  }, [selectedTs, selected, onSelectTs]);

  const plainParagraphs = useMemo(
    () => (selected ? selected.content.split(/\n\s*\n/).filter((p) => p.trim()) : []),
    [selected],
  );

  return (
    <aside
      className="ln-drafts-split"
      role="complementary"
      aria-label={`Drafts — ${scopeLabel}`}
      data-testid="ln-drafts-split"
    >
      <div className="ln-drafts-split-bar">
        <span className="ln-drafts-split-scope" title={`Drafts of what's open — ${scopeLabel}`}>
          DRAFTS — {scopeLabel}
        </span>
        <select
          className="ln-drafts-split-select"
          value={selected?.ts ?? ''}
          onChange={(e) => onSelectTs(e.target.value)}
          aria-label="Draft to compare"
          disabled={drafts.length === 0}
        >
          {drafts.map((d, i) => (
            <option value={d.ts} key={d.ts}>
              {d.label}
              {i === 0 ? ' (previous)' : ''}
            </option>
          ))}
        </select>
        <div className="ln-drafts-split-hl">
          <span className="ln-drafts-split-hl-label" id="ln-drafts-hl-label">Highlight changes</span>
          <button
            type="button"
            role="switch"
            aria-checked={highlightOn}
            aria-labelledby="ln-drafts-hl-label"
            className={`ln-drafts-split-toggle${highlightOn ? ' is-on' : ''}`}
            onClick={() => setHighlightOn((v) => !v)}
            data-testid="ln-drafts-hl-toggle"
          >
            <span className="ln-drafts-split-toggle-knob" />
          </button>
        </div>
        <button
          type="button"
          className="ln-drafts-split-fulldiff"
          onClick={onFullDiff}
          disabled={!selected}
          title="Open full side-by-side diff"
        >
          <span className="ln-drafts-dot ln-drafts-dot-green" aria-hidden="true" />
          <span className="ln-drafts-dot ln-drafts-dot-red" aria-hidden="true" />
          Full diff
        </button>
        <button
          type="button"
          className="ln-drafts-split-load"
          onClick={() => selected && onLoadDraft(selected)}
          disabled={!selected}
          title="Replace your current draft with the selected one"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden="true" focusable="false">
            <path d="M12 4v11M7 10l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
          Load draft
        </button>
        {undoLabel !== null && (
          <button
            type="button"
            className="ln-drafts-split-undo"
            onClick={onUndo}
            title="Put your current draft back"
            aria-label={`Undo loading ${undoLabel}`}
            data-testid="ln-drafts-undo-chip"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" aria-hidden="true" focusable="false">
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
            Undo
          </button>
        )}
        <div className="ln-drafts-split-spacer" />
        <button
          type="button"
          className="ln-drafts-split-close"
          onClick={onClose}
          aria-label="Close drafts compare"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>

      {error && <div className="ln-drafts-split-error" role="alert">{error}</div>}

      <div className="ln-drafts-split-body">
        {selected ? (
          <>
            <div className="ln-drafts-split-title">
              {selected.label}
              <span className="ln-drafts-split-meta">
                {' '}· {countWords(selected.content).toLocaleString()} words · read-only
              </span>
            </div>
            {highlightOn ? (
              <DraftDiffView
                variant="highlight"
                documentLabel={scopeLabel}
                currentLabel={currentLabel}
                previousLabel={selected.label}
                currentText={currentContent}
                previousText={selected.content}
              />
            ) : (
              <div className="ln-drafts-split-plain" data-testid="ln-drafts-split-plain">
                {plainParagraphs.map((p, i) => (
                  <p className="ln-diff-para" key={i}>{p}</p>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="ln-drafts-split-empty">
            No drafts yet — save a snapshot and it appears here.
          </div>
        )}
      </div>
    </aside>
  );
}
