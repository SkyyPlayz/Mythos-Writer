// M1 (SKY-9013) — canonical row 3: the depth-invariant title row.
// Prototype "doc header" (Liquid Neon :897-948): depth chip + scope title + ☆,
// then right-aligned status chip · word count · comment chip · Focus.
// Only the chip text and title change with depth — the row itself renders
// identically at book / part / chapter / scene (PLAN.md M1 chrome inventory).
// SKY-9404 (M1-S4): the Drafts control and ⋯ menu (Save snapshot now /
// History) join this row, relocated from the deleted legacy scene branch's
// snapshot toolbar (M1 spec #5). They render only when the host supplies
// `drafts` — i.e. only once a target scene resolves.

import { useEffect, useRef, useState } from 'react';
import type { DraftState, Scene, Story } from '../types';
import {
  draftStateLabel,
  scopeTitle,
  titleChip,
  type ManuscriptCursor,
} from './manuscriptModel';
import DraftsPopover from '../drafts/DraftsPopover';
import type { SceneDraftEntry } from '../drafts/useSceneDrafts';
import './TitleRow.css';

/** SKY-9404: the Drafts pill + popover data, formerly local scene-branch state. */
export interface TitleRowDraftsControls {
  drafts: SceneDraftEntry[];
  currentLabel: string;
  currentContent: string;
  documentLabel: string;
  popoverOpen: boolean;
  onTogglePopover: () => void;
  onClosePopover: () => void;
  onCompare: (draft: SceneDraftEntry) => void;
  onRestore: (draft: SceneDraftEntry) => void;
  /** "Drafts" compare-split toggle — the DraftsCompareSplit pane beside the page. */
  splitOpen: boolean;
  onToggleSplit: () => void;
}

export interface TitleRowProps {
  story: Story;
  cursor: ManuscriptCursor;
  /** The cursor's current scene — target of the status chip. Null on empty stories. */
  scene: Scene | null;
  /** Word count of the visible scope (book/part/chapter/scene). */
  wordCount: number;
  commentCount: number;
  commentsOpen: boolean;
  onToggleComments: () => void;
  /** Cycles the scene's draftState (Planned → Drafting → In review → Complete). */
  onCycleStatus: (sceneId: string) => void;
  focusActive: boolean;
  onToggleFocus?: () => void;
  /** SKY-9404: Drafts pill + popover — present only when a target scene resolves. */
  drafts?: TitleRowDraftsControls;
  /** SKY-9404: ⋯ menu — "Save snapshot now" / "History". */
  onManualSnapshot?: () => void;
  snapshotSavedAt?: string | null;
  onOpenSceneHistory?: () => void;
}

const COMMENT_ICON = (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="M21 12c0 4-4 7-9 7s-9-3-9-7 4-7 9-7 9 3 9 7z" />
  </svg>
);

export default function TitleRow({
  story,
  cursor,
  scene,
  wordCount,
  commentCount,
  commentsOpen,
  onToggleComments,
  onCycleStatus,
  focusActive,
  onToggleFocus,
  drafts,
  onManualSnapshot,
  snapshotSavedAt,
  onOpenSceneHistory,
}: TitleRowProps) {
  const chip = titleChip(cursor);
  const title = scopeTitle(story, cursor);
  const status: DraftState | undefined = scene?.draftState;

  const draftsPillRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const hasMenu = onManualSnapshot || onOpenSceneHistory;

  return (
    <div className="msv-title-row" data-testid="msv-title-row">
      {chip && (
        <span className="msv-depth-chip" data-testid="msv-depth-chip">
          {chip}
        </span>
      )}
      <h1 className="msv-scope-title" data-testid="msv-scope-title">
        {title}
      </h1>
      {/* Prototype ☆ (:902) — same inert affordance as the legacy DocHeader's;
          a favorites model does not exist yet (raised on the epic). */}
      <button className="msv-title-star" aria-label="Add to favorites" type="button" title="Add to favorites">
        ☆
      </button>
      <div className="msv-flex-spacer" />
      {scene && (
        <button
          type="button"
          className={`msv-status-chip msv-status-chip--${status ?? 'planned'}`}
          data-testid="msv-status-chip"
          title="Scene status — click to cycle"
          onClick={() => onCycleStatus(scene.id)}
        >
          {draftStateLabel(status)} ▾
        </button>
      )}
      <span className="msv-title-words" data-testid="msv-title-words">
        {wordCount.toLocaleString('en-US')} words
      </span>
      <button
        type="button"
        className={`msv-comments-chip${commentsOpen ? ' msv-comments-chip--on' : ''}`}
        data-testid="msv-comments-chip"
        title="Show / hide comments"
        aria-pressed={commentsOpen}
        onClick={onToggleComments}
      >
        {COMMENT_ICON}
        {commentCount}
      </button>
      {drafts && (
        <span className="scene-drafts-anchor">
          <button
            ref={draftsPillRef}
            type="button"
            className="scene-drafts-pill"
            onClick={drafts.onTogglePopover}
            aria-haspopup="dialog"
            aria-expanded={drafts.popoverOpen}
            data-testid="scene-drafts-pill"
          >
            {drafts.currentLabel} ▾
          </button>
          {drafts.popoverOpen && (
            <DraftsPopover
              documentLabel={drafts.documentLabel}
              drafts={drafts.drafts}
              currentLabel={drafts.currentLabel}
              currentContent={drafts.currentContent}
              onCompare={drafts.onCompare}
              onRestore={(draft) => {
                drafts.onClosePopover();
                drafts.onRestore(draft);
              }}
              onClose={drafts.onClosePopover}
              anchorRef={draftsPillRef}
            />
          )}
          <button
            type="button"
            className={`scene-drafts-compare-btn${drafts.splitOpen ? ' is-active' : ''}`}
            onClick={drafts.onToggleSplit}
            aria-pressed={drafts.splitOpen}
            title="Drafts — compare previous drafts side-by-side"
            data-testid="scene-drafts-compare-btn"
          >
            Drafts
          </button>
        </span>
      )}
      {onToggleFocus && (
        <button
          type="button"
          className={`msv-title-focus${focusActive ? ' msv-title-focus--on' : ''}`}
          data-testid="msv-title-focus"
          title="Focus mode — distraction-free writing"
          aria-pressed={focusActive}
          onClick={onToggleFocus}
        >
          Focus
        </button>
      )}
      {hasMenu && (
        <div className="msv-title-menu" ref={menuRef}>
          <button
            type="button"
            className="msv-title-menu-btn"
            data-testid="msv-title-menu-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="More"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="msv-title-menu-popover" role="menu" data-testid="msv-title-menu-popover">
              {onManualSnapshot && (
                <button
                  type="button"
                  role="menuitem"
                  className="msv-title-menu-item"
                  data-testid="msv-title-menu-snapshot"
                  onClick={() => {
                    setMenuOpen(false);
                    onManualSnapshot();
                  }}
                >
                  Save snapshot now
                </button>
              )}
              {snapshotSavedAt && (
                <div className="msv-title-menu-note" aria-live="polite">
                  Snapshot saved {snapshotSavedAt}
                </div>
              )}
              {onOpenSceneHistory && (
                <button
                  type="button"
                  role="menuitem"
                  className="msv-title-menu-item"
                  data-testid="msv-title-menu-history"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenSceneHistory();
                  }}
                >
                  History
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
