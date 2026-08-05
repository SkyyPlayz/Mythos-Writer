// M1 (SKY-9013) — canonical row 3: the depth-invariant title row.
// Prototype "doc header" (Liquid Neon :897-948): depth chip + scope title + ☆,
// then right-aligned status chip · word count · comment chip · Focus.
// Only the chip text and title change with depth — the row itself renders
// identically at book / part / chapter / scene (PLAN.md M1 chrome inventory).
// The Drafts control and ⋯ menu join this row when the legacy scene branch's
// snapshot toolbar is deleted (M1 spec #5 relocation).

import type { DraftState, Scene, Story } from '../types';
import {
  draftStateLabel,
  scopeTitle,
  titleChip,
  type ManuscriptCursor,
} from './manuscriptModel';
import './TitleRow.css';

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
}: TitleRowProps) {
  const chip = titleChip(cursor);
  const title = scopeTitle(story, cursor);
  const status: DraftState | undefined = scene?.draftState;

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
    </div>
  );
}
