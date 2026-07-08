// Beta 3 M11 — the margin comments gutter (prototype gutter dock 944–963,
// gutterCards/gutterSt 4633–4645, kind colors kMeta 4515/4633).
//
// A 236px column docked to the right of the manuscript page. Cards are
// document-ordered (aligned to where their anchors appear); clicking a card
// expands it in place with the agent-action row (archive comments), Resolve,
// and the "Show in focus" override toggle. Presentational — all mutations go
// through the callbacks so ManuscriptView owns store wiring + toasts.

import { useEffect, useRef } from 'react';
import {
  AGENT_ACTIONS,
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
  /** Focus-mode override state + toggle ("Show in focus"). */
  commentsInFocus: boolean;
  onToggleCommentsInFocus: () => void;
}

function CommentCard({
  comment,
  open,
  onToggleOpen,
  onResolve,
  onAgentAction,
  commentsInFocus,
  onToggleCommentsInFocus,
}: {
  comment: StoryComment;
  open: boolean;
  onToggleOpen: (id: string) => void;
  onResolve: (comment: StoryComment) => void;
  onAgentAction: (comment: StoryComment, action: AgentAction) => void;
  commentsInFocus: boolean;
  onToggleCommentsInFocus: () => void;
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
        <>
          <div className="msv-cmt-actions">
            {availability !== 'none' &&
              AGENT_ACTIONS.map(({ action, label }) => (
                <button
                  key={action}
                  type="button"
                  className={`msv-cmt-act msv-cmt-act--${action}`}
                  data-testid={`msv-cmt-act-${action}-${comment.id}`}
                  disabled={availability !== 'live'}
                  title={
                    availability === 'live'
                      ? label
                      : 'Wired when the Archive Agent links a suggestion (arrives with M23)'
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
          <div
            className="msv-cmt-focusrow"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <span className="msv-cmt-focuslabel">Show in focus</span>
            <button
              type="button"
              className={`msv-cmt-pill${commentsInFocus ? ' msv-cmt-pill--on' : ''}`}
              data-testid="msv-cmt-focus-toggle"
              role="switch"
              aria-checked={commentsInFocus}
              aria-label="Show comments in Focus mode"
              onClick={onToggleCommentsInFocus}
            >
              <span className="msv-cmt-pill-knob" />
            </button>
          </div>
        </>
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
  commentsInFocus,
  onToggleCommentsInFocus,
}: CommentsGutterProps) {
  if (comments.length === 0) return null;
  return (
    <aside className="msv-gutter" data-testid="msv-gutter" aria-label="Manuscript comments">
      <div className="msv-gutter-title">COMMENTS</div>
      {comments.map((c) => (
        <CommentCard
          key={c.id}
          comment={c}
          open={openId === c.id}
          onToggleOpen={onToggleOpen}
          onResolve={onResolve}
          onAgentAction={onAgentAction}
          commentsInFocus={commentsInFocus}
          onToggleCommentsInFocus={onToggleCommentsInFocus}
        />
      ))}
      <div className="msv-gutter-hint">
        Docked by default — hidden in Focus mode. Select text in the page to add one.
      </div>
    </aside>
  );
}
