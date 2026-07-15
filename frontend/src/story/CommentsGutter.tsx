// Beta 4 M9 — the margin comments gutter (v2 prototype gutter dock 1185–1204,
// gutterCards/gutterSt 6765–6776, kind colors kMeta2 6765).
//
// A 236px column docked to the right of the manuscript page. Cards are
// document-ordered (aligned to where their anchors appear); clicking a card
// opens it (prototype cOpen) — the card grows a compact action row (archive:
// "Edit notes" / "Suggest change", always "Resolve") and ManuscriptView shows
// the full CommentOpenCard over the page. Presentational — all mutations go
// through the callbacks so ManuscriptView owns store wiring + toasts.
//
// Beta 4 M11: the gutter also hosts the Reader card (readerSlot) above the
// comment cards — v2 prototype gutterOpen/gutterSt 6775–6776: the column
// top-docks its content while comments are visible and centers the Reader
// card vertically when they're hidden.

import { useEffect, useRef, type ReactNode } from 'react';
import {
  GUTTER_AGENT_ACTIONS,
  agentActionAvailability,
  clipAnchor,
  type AgentAction,
  type StoryComment,
} from '../comments';
import './CommentsGutter.css';

export interface CommentsGutterProps {
  /** Document-ordered comments (orderCommentsByDocument). */
  comments: readonly StoryComment[];
  /** Expanded card id (prototype cOpen), or null. */
  openId: string | null;
  onToggleOpen: (id: string) => void;
  onResolve: (comment: StoryComment) => void;
  onAgentAction: (comment: StoryComment, action: AgentAction) => void;
  /** M11: the Reader card, docked above the comment cards (prototype 1154). */
  readerSlot?: ReactNode;
}

function CommentCard({
  comment,
  open,
  onToggleOpen,
  onResolve,
  onAgentAction,
}: {
  comment: StoryComment;
  open: boolean;
  onToggleOpen: (id: string) => void;
  onResolve: (comment: StoryComment) => void;
  onAgentAction: (comment: StoryComment, action: AgentAction) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Anchor-click alignment: when this card opens, bring it into view.
  useEffect(() => {
    if (open && typeof ref.current?.scrollIntoView === 'function') {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  const availability = agentActionAvailability(comment);

  return (
    <div
      ref={ref}
      className={`msv-cmt msv-cmt--${comment.kind}${open ? ' msv-cmt--open' : ''}`}
      data-testid={`msv-cmt-${comment.id}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => onToggleOpen(comment.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleOpen(comment.id);
        }
      }}
    >
      <div className="msv-cmt-head">
        <span className={`msv-cmt-dot msv-cmt-dot--${comment.kind}`} aria-hidden="true" />
        <span className="msv-cmt-author">{comment.author}</span>
      </div>
      <div className="msv-cmt-anchor">on &ldquo;{clipAnchor(comment.anchor, 34)}&rdquo;</div>
      <div className="msv-cmt-text">{comment.text}</div>
      {open && (
        <div className="msv-cmt-actions">
          {availability !== 'none' &&
            GUTTER_AGENT_ACTIONS.map(({ action, label }) => (
              <button
                key={action}
                type="button"
                className={`msv-cmt-act msv-cmt-act--${action}`}
                data-testid={`msv-cmt-act-${action}-${comment.id}`}
                disabled={availability !== 'live'}
                title={
                  availability === 'live'
                    ? label
                    : 'Wired when the Archive Agent links a suggestion (continuity scan)'
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onAgentAction(comment, action);
                }}
              >
                {label}
              </button>
            ))}
          <button
            type="button"
            className="msv-cmt-resolve"
            data-testid={`msv-cmt-resolve-${comment.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onResolve(comment);
            }}
          >
            Resolve
          </button>
        </div>
      )}
    </div>
  );
}

export default function CommentsGutter({
  comments,
  openId,
  onToggleOpen,
  onResolve,
  onAgentAction,
  readerSlot,
}: CommentsGutterProps) {
  if (comments.length === 0 && !readerSlot) return null;
  return (
    <aside
      className={`msv-gutter${comments.length === 0 ? ' msv-gutter--center' : ''}`}
      data-testid="msv-gutter"
      aria-label="Manuscript margin"
    >
      {readerSlot}
      {comments.length > 0 && (
        <>
          <div className="msv-gutter-title">COMMENTS</div>
          {comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              open={openId === c.id}
              onToggleOpen={onToggleOpen}
              onResolve={onResolve}
              onAgentAction={onAgentAction}
            />
          ))}
          <div className="msv-gutter-hint">
            Docked by default — hidden in Focus mode. Select text in the page to add one.
          </div>
        </>
      )}
    </aside>
  );
}
